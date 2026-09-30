// Game bootstrap and main loop.

import { Renderer } from './render/renderer.js';
import { World } from './world/world.js';
import { BIOME_NAMES } from './world/generator.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';
import { Particles } from './particles.js';
import { Fluids } from './fluids.js';
import { PrimedTNT, explode, explosionEffects } from './entities.js';
import { Connection, serverURL } from './net/client.js';
import { RemotePlayers, AVATAR_TEXTURES } from './net/players.js';
import { F_FLYING, F_SNEAKING, NAME_RE, NAME_RULES, SERVER_COMMANDS } from './net/protocol.js';
import { buildHand } from './hand.js';
import { raycast, blockBounds } from './raycast.js';
import { environment, lightBrightness, timeLabel } from './sky.js';
import { buildTextureArray } from './textures.js';
import { makeIcons, textureDataURL } from './icons.js';
import { B, BLOCKS, SOLID, LIQUID, REPLACEABLE, NEEDS_SUPPORT, allTextureNames, resolveTextures } from './blocks.js';
import { forwardVector, clamp } from './math.js';
import { DAY_LENGTH_SECONDS, WORLD_HEIGHT } from './constants.js';
import * as store from './storage.js';

const DEFAULT_HOTBAR = [B.grass, B.dirt, B.stone, B.cobblestone, B.oak_planks, B.oak_log, B.glass, B.torch, B.tnt];
const REACH = 6;
const AUTOSAVE_SECONDS = 30;
const PANORAMA_SEED = 1337;
const NO_INPUT = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
const LEAVES = new Set([B.oak_leaves, B.birch_leaves, B.spruce_leaves]);
const LOGS = new Set([B.oak_log, B.birch_log, B.spruce_log, B.cactus]);

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = store.loadSettings();
    this.sound = new Sound();
    this.ui = new UI(this);
    this.world = null;
    this.state = 'title';
    this.hotbar = [...DEFAULT_HOTBAR];
    this.selected = 0;
    this.net = null; // multiplayer connection once joined
    this.pendingNet = null; // ... while joining
    this.remote = null; // other players
    window.game = this; // handy from the dev console

    try {
      this.renderer = new Renderer(this.canvas);
    } catch (err) {
      console.error(err);
      this.ui.showError(`${err.message} Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled.`);
      return;
    }

    const tex = buildTextureArray([...allTextureNames(), ...AVATAR_TEXTURES]);
    resolveTextures((name) => tex.layers.get(name));
    this.texLayers = tex.layers;
    this.renderer.setTextures(tex);
    this.icons = makeIcons(tex);
    this.ui.setBackground(textureDataURL(tex, 'dirt'));
    this.ui.setInventoryIcons();
    this.ui.updateHotbar(this.hotbar, this.selected);

    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.touch = new TouchControls(this);
    if (isTouchDevice() && !localStorage.getItem('blockcraft:settings')) this.settings.renderDistance = 5;
    this.applySettings();
    this.ui.reset('title');

    this.clock = 0;
    this.last = performance.now();
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.debug = false;
    this.hudVisible = true;
    this.debugTimer = 0;

    window.addEventListener('beforeunload', (e) => {
      if (!this.world) return;
      this.save();
      if (this.state === 'playing') {
        // Guards against Ctrl+W while sprinting.
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.world) this.save();
    });
    this.startPanorama();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ title panorama

  // A live world slowly spinning behind the title screen.
  startPanorama() {
    if (this.pano || !this.renderer) return;
    const renderer = this.renderer;
    const world = new World(PANORAMA_SEED, {
      onMeshed: (c, mesh) => renderer.uploadChunk(c, mesh),
      onUnloaded: (c) => renderer.deleteChunk(c),
    });
    world.setRenderDistance(Math.min(6, this.settings.renderDistance));
    const sp = world.findSpawnColumn();
    this.pano = { world, x: sp.x, z: sp.z, y: null, yaw: 0.6 };
  }

  stopPanorama() {
    if (!this.pano) return;
    this.pano.world.dispose();
    this.pano = null;
  }

  renderPanorama(dt) {
    const pn = this.pano, w = pn.world;
    w.update(pn.x, pn.z, 8);
    if (pn.y === null && w.isReady(Math.floor(pn.x / 16), Math.floor(pn.z / 16))) pn.y = w.surfaceY(pn.x, pn.z) + 9;
    pn.yaw += dt * 0.035;
    this.renderer.worldSprites.clear();
    this.renderer.handSprites.clear();
    this.renderer.render({
      cam: { x: pn.x, y: pn.y ?? 90, z: pn.z, yaw: pn.yaw, pitch: 0.08, fov: 80 },
      env: environment(0.07),
      time: this.clock,
      chunks: w.chunks.values(),
      renderDistance: w.renderDistance,
      selection: null,
      underwater: false,
      inLava: false,
      clouds: this.settings.clouds,
    });
  }

  // ------------------------------------------------------------ settings

  applySettings() {
    const s = this.settings;
    if (this.renderer) this.renderer.renderScale = s.renderScale / 100;
    if (this.world && this.world.renderDistance !== s.renderDistance) this.world.setRenderDistance(s.renderDistance);
    this.sound.setVolume(s.volume / 100);
    if (!s.showFps) this.ui.setFps(null);
  }

  saveSettings() {
    store.saveSettings(this.settings);
    this.applySettings();
  }

  // ------------------------------------------------------------ world lifecycle

  createWorld(name, seedText) {
    const seed = store.parseSeed(seedText);
    const meta = store.createWorldMeta(name, seed);
    this.startWorld(meta);
  }

  playWorld(id) {
    const meta = store.listWorlds().find((w) => w.id === id);
    if (meta) this.startWorld(meta);
  }

  startWorld(meta) {
    this.stopWorld();
    this.stopPanorama();
    this.meta = meta;
    meta.lastPlayed = Date.now();
    store.updateWorldMeta(meta);
    const data = store.loadWorldData(meta.id);
    const renderer = this.renderer;
    this.world = new World(meta.seed, {
      edits: World.deserializeEdits(data?.edits),
      onMeshed: (c, mesh) => renderer.uploadChunk(c, mesh),
      onUnloaded: (c) => renderer.deleteChunk(c),
    });
    this.world.setRenderDistance(this.settings.renderDistance);
    this.fluids = new Fluids(this.world);
    this.player = new Player();
    const p = this.player;
    if (data?.player) {
      p.pos = [...data.player.pos];
      p.yaw = data.player.yaw;
      p.pitch = data.player.pitch;
      p.flying = !!data.player.flying;
      this.spawnPoint = data.spawn || { x: p.pos[0], y: p.pos[1], z: p.pos[2] };
      this.needsSpawn = false;
    } else {
      const sp = this.world.findSpawnColumn();
      p.pos = [sp.x, 100, sp.z];
      p.yaw = Math.PI * 0.75;
      this.spawnPoint = null;
      this.needsSpawn = true;
    }
    this.time = data?.time ?? 0.03;
    this.dayCycle = data?.dayCycle ?? true;
    this.hotbar = data?.hotbar?.length === 9 ? data.hotbar.map((id) => (BLOCKS[id] ? id : 0)) : [...DEFAULT_HOTBAR];
    this.selected = data?.selected ?? 0;
    this.beginSession();
  }

  // State shared by singleplayer and multiplayer sessions; ends on the loading screen.
  beginSession() {
    this.entities = [];
    this.particles = new Particles();
    this.target = null;
    this.swing = 1;
    this.equip = 1;
    this.breakCooldown = 0;
    this.placeCooldown = 0;
    this.sprintLatch = false;
    this.shake = 0;
    this.fovScale = 1;
    this.saveTimer = 0;
    this.state = 'loading';
    this.ui.setLoading(0, '');
    this.ui.setLoadingTitle(this.net ? `Joining ${this.meta.name}…` : 'Generating terrain…', !!this.net);
    this.ui.reset('loading');
    this.ui.updateHotbar(this.hotbar, this.selected);
  }

  stopWorld() {
    this.closeConnection();
    if (!this.world) return;
    this.save();
    this.world.dispose();
    this.world = null;
    this.remote?.clear();
    this.remote = null;
    this.renderer.worldSprites.clear();
    this.renderer.handSprites.clear();
  }

  // ------------------------------------------------------------ multiplayer

  joinServer(address, name) {
    let url;
    try {
      url = serverURL(address);
    } catch (err) {
      this.ui.setMpStatus(err.message);
      return;
    }
    if (!NAME_RE.test(name)) {
      this.ui.setMpStatus(NAME_RULES);
      return;
    }
    store.saveMultiplayer({ ...store.loadMultiplayer(), address, name });
    this.lastServer = { address, name };
    this.stopWorld();
    this.ui.setLoading(0, address);
    this.ui.setLoadingTitle('Connecting to the server…', true);
    this.ui.reset('loading');
    const conn = new Connection(url, name, {
      onMessage: (m) => this.onNetMessage(conn, m),
      onClose: (reason) => this.onNetClose(conn, reason),
    });
    this.pendingNet = conn;
  }

  reconnect() {
    if (this.lastServer) this.joinServer(this.lastServer.address, this.lastServer.name);
    else this.ui.reset('title');
  }

  closeConnection() {
    this.pendingNet?.close();
    this.pendingNet = null;
    this.net?.close();
    this.net = null;
  }

  onNetClose(conn, reason) {
    if (conn !== this.net && conn !== this.pendingNet) return;
    const joined = conn === this.net;
    if (joined) this.net = null;
    else this.pendingNet = null;
    this.leaveGame();
    this.ui.showDisconnected(joined ? 'Disconnected' : 'Could not join the server', reason);
  }

  startRemoteWorld(conn, msg) {
    this.pendingNet = null;
    this.net = conn;
    this.stopPanorama();
    this.meta = { name: String(msg.server || 'Server'), seed: msg.seed | 0, remote: true };
    this.welcome = msg;
    const renderer = this.renderer;
    this.world = new World(msg.seed, {
      onMeshed: (c, mesh) => renderer.uploadChunk(c, mesh),
      onUnloaded: (c) => renderer.deleteChunk(c),
      remote: { request: (cx, cz) => conn.subscribe(cx, cz), drop: (cx, cz) => conn.unsubscribe(cx, cz) },
    });
    this.world.setRenderDistance(this.settings.renderDistance);
    this.fluids = null; // the server runs liquids
    this.player = new Player();
    const p = this.player, sp = msg.spawn, you = msg.you;
    this.spawnPoint = { x: sp[0], y: sp[1], z: sp[2] };
    this.needsSpawn = false;
    if (you) {
      p.pos = [...you.pos];
      p.yaw = you.yaw;
      p.pitch = you.pitch;
      p.flying = !!you.flying;
    } else {
      p.pos = [...sp];
      p.yaw = Math.PI * 0.75;
    }
    this.time = msg.time;
    this.dayCycle = !!msg.cycle;
    const saved = store.loadMultiplayer();
    this.hotbar = saved.hotbar?.length === 9 ? saved.hotbar.map((id) => (BLOCKS[id] ? id : 0)) : [...DEFAULT_HOTBAR];
    this.selected = 0;
    this.remote = new RemotePlayers(this.texLayers, document.getElementById('nametags'));
    for (const o of msg.players) this.remote.add(o.id, o.name);
    this.lastSent = null;
    this.netTimer = 0;
    this.beginSession();
  }

  onNetMessage(conn, m) {
    if (m.t === 'welcome' && conn === this.pendingNet) return this.startRemoteWorld(conn, m);
    if (conn !== this.net || !this.world) return;
    const w = this.world;
    switch (m.t) {
      case 'blocks':
        w.applyRemoteBlocks(m.b);
        break;
      case 'chunk':
        w.receiveEdits(m.cx, m.cz, m.e);
        break;
      case 'players':
        this.remote.setStates(m.s);
        break;
      case 'join':
        this.remote.add(m.id, m.name);
        this.ui.log(`${m.name} joined the game`);
        break;
      case 'leave':
        this.remote.remove(m.id);
        this.ui.log(`${m.name} left the game`);
        break;
      case 'chat':
        this.ui.log(String(m.m));
        break;
      case 'time':
        this.time = m.v;
        this.dayCycle = !!m.c;
        break;
      case 'swing':
        this.remote.swing(m.id);
        break;
      case 'tnt': {
        const e = new PrimedTNT(m.x, m.y, m.z, m.f);
        e.remote = true; // the server decides when and how it explodes
        this.entities.push(e);
        if (this.near(m.x, m.y, m.z, 24)) this.sound.fuse();
        break;
      }
      case 'boom':
        this.onBoom(m);
        break;
      case 'fx': {
        const b = BLOCKS[m.id];
        if (!b || !this.near(m.x, m.y, m.z, 32)) break;
        if (m.k === 'break') {
          this.particles.blockBreak(m.x, m.y, m.z, m.id);
          this.sound.blockBreak(b.sound);
        } else this.sound.blockPlace(b.sound);
        break;
      }
    }
  }

  onBoom(m) {
    let best = -1, bestD = 2.5;
    this.entities.forEach((e, i) => {
      const d = Math.hypot(e.x - m.x, e.y + 0.5 - m.y, e.z - m.z);
      if (e.remote && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) this.entities.splice(best, 1);
    const debris = [];
    for (let i = 0; i + 3 < m.d.length; i += 4) if (BLOCKS[m.d[i + 3]]) debris.push(m.d.slice(i, i + 4));
    explosionEffects(this, m.x, m.y, m.z, m.r, debris);
  }

  near(x, y, z, r) {
    const p = this.player.pos;
    return (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2 < r * r;
  }

  // Tell the server where we are, ~20 times a second while anything changes.
  sendState(dt) {
    this.netTimer += dt;
    if (this.netTimer < 0.05) return;
    const p = this.player;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const s = [r3(p.pos[0]), r3(p.pos[1]), r3(p.pos[2]), r3(p.yaw), r3(p.pitch), (p.flying ? F_FLYING : 0) | (p.sneaking ? F_SNEAKING : 0)];
    const last = this.lastSent;
    if (last && this.netTimer < 1 && s.every((v, i) => v === last[i])) return;
    this.netTimer = 0;
    this.lastSent = s;
    this.net.send({ t: 'pos', p: s.slice(0, 3), r: s.slice(3, 5), f: s[5], ms: Math.round(performance.now()) });
  }

  save() {
    if (this.meta?.remote && this.world) {
      store.saveMultiplayer({ ...store.loadMultiplayer(), hotbar: this.hotbar });
      return;
    }
    if (!this.world || !this.meta || this.state === 'loading') return;
    const p = this.player;
    const ok = store.saveWorldData(this.meta.id, {
      version: 1,
      player: { pos: p.pos.map((v) => Math.round(v * 1000) / 1000), yaw: p.yaw, pitch: p.pitch, flying: p.flying },
      spawn: this.spawnPoint,
      time: this.time,
      dayCycle: this.dayCycle,
      hotbar: this.hotbar,
      selected: this.selected,
      edits: this.world.serializeEdits(),
    });
    if (!ok) this.ui.toast('Could not save: browser storage is full');
    this.meta.lastPlayed = Date.now();
    store.updateWorldMeta(this.meta);
    this.saveTimer = 0;
  }

  quitToTitle() {
    this.leaveGame();
    this.ui.reset('title');
  }

  leaveGame() {
    this.stopWorld();
    this.input.exitLock();
    this.input.enabled = false;
    this.touch.show(false);
    this.state = 'title';
    this.ui.closeInventory();
    this.ui.closeChat();
    this.ui.showHud(false);
    this.startPanorama();
  }

  finishLoading() {
    const w = this.world, p = this.player;
    if (this.needsSpawn) {
      p.pos = this.findSafeSpawn(p.pos[0], p.pos[2]);
      this.spawnPoint = { x: p.pos[0], y: p.pos[1], z: p.pos[2] };
      this.needsSpawn = false;
    } else {
      // Make sure we're not stuck inside a block.
      let guard = 0;
      while (guard++ < WORLD_HEIGHT && w.isSolid(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 0.5), Math.floor(p.pos[2]))) p.pos[1] += 1;
    }
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.reset(null);
    this.ui.showHud(true);
    this.ui.setClickToPlay(!this.touch.enabled);
    this.touch.show(true);
    this.ui.log(
      this.touch.enabled
        ? `Welcome to ${this.meta.name}! Drag to look, tap to place, hold to break. Double-tap ↑ to fly.`
        : `Welcome to ${this.meta.name}! Press E for blocks, T for chat, /help for commands.`,
    );
    if (this.net) {
      const w = this.welcome;
      if (w.motd) this.ui.log(String(w.motd));
      const others = this.remote.names();
      this.ui.log(others.length ? `Also online: ${others.join(', ')}` : 'Nobody else is online yet.');
    }
  }

  findSafeSpawn(x0, z0) {
    const w = this.world;
    const cx = Math.floor(x0), cz = Math.floor(z0);
    for (let r = 0; r <= 8; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx, z = cz + dz;
          for (let y = WORLD_HEIGHT - 2; y > 0; y--) {
            const b = w.getBlock(x, y, z);
            if (b === 0 || (!SOLID[b] && !LIQUID[b])) continue;
            if (SOLID[b] && !LEAVES.has(b) && !LOGS.has(b)) return [x + 0.5, y + 1, z + 0.5];
            break;
          }
        }
    return [x0, w.surfaceY(x0, z0), z0];
  }

  // ------------------------------------------------------------ state changes

  onLockChange(locked) {
    if (locked) {
      this.sound.ensure();
      if (this.state === 'playing') this.ui.setClickToPlay(false);
    } else if (this.state === 'playing') {
      this.pause();
    }
  }

  pause() {
    this.state = 'paused';
    this.touch.show(false);
    this.ui.setClickToPlay(false);
    this.ui.setQuitLabel(this.net ? 'Disconnect' : 'Save and Quit to Title');
    this.ui.reset('pause');
    this.save();
  }

  resume() {
    if (!this.world || this.state === 'loading' || this.state === 'title') return;
    this.state = 'playing';
    this.ui.reset(null);
    this.ui.closeInventory();
    this.ui.showHud(true);
    if (this.touch.enabled) {
      this.touch.show(true);
      return;
    }
    this.ui.setClickToPlay(!this.input.locked);
    this.input.requestLock();
  }

  openInventory() {
    this.state = 'inventory';
    this.touch.show(false);
    this.input.exitLock();
    this.ui.openInventory();
  }

  closeInventory() {
    if (this.state !== 'inventory') return;
    this.resume();
  }

  openChat(prefix) {
    this.state = 'chat';
    this.touch.show(false);
    this.input.exitLock();
    this.ui.openChat(prefix);
  }

  toggleFly() {
    const p = this.player;
    if (!p) return;
    p.flying = !p.flying;
    if (p.flying) p.vel[1] = 0;
    this.ui.toast(p.flying ? 'Flying' : 'Walking', 900);
  }

  selectSlot(i) {
    this.selected = ((i % 9) + 9) % 9;
    this.equip = 0;
    this.ui.updateHotbar(this.hotbar, this.selected);
    const id = this.hotbar[this.selected];
    if (id) this.ui.showItemName(BLOCKS[id].name);
  }

  setHotbarSlot(i, id) {
    this.hotbar[i] = id;
    this.equip = i === this.selected ? 0 : this.equip;
    this.ui.updateHotbar(this.hotbar, this.selected);
    if (i === this.selected && id) this.ui.showItemName(BLOCKS[id].name);
  }

  // ------------------------------------------------------------ main loop

  frame(t) {
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.clock += dt;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    try {
      if (this.world) this.tick(dt);
      else if (this.pano) this.renderPanorama(dt);
    } catch (err) {
      console.error(err);
      this.ui.showError(`The game crashed: ${err.message}`);
      this.input.exitLock();
      return;
    }
    this.input.endFrame();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  tick(dt) {
    const w = this.world, p = this.player, input = this.input;

    if (this.state === 'loading') {
      w.update(p.pos[0], p.pos[2], 40);
      const r = 2;
      let ready = 0, total = 0;
      const pcx = Math.floor(p.pos[0] / 16), pcz = Math.floor(p.pos[2] / 16);
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          total++;
          if (w.isReady(pcx + dx, pcz + dz)) ready++;
        }
      const center = w.getChunk(pcx, pcz);
      const meshed = !!(center && center.mesh);
      this.ui.setLoading((ready + (meshed ? 1 : 0)) / (total + 1), `Building terrain… ${w.chunks.size} chunks`);
      this.net?.flush();
      if (ready === total && meshed) this.finishLoading();
      return;
    }

    // A server world keeps going while the menu is open.
    const online = !!this.net;
    const active = this.state !== 'paused' || online;
    const playing = this.state === 'playing' && (input.locked || this.touch.active);
    input.enabled = this.state === 'playing';

    if (playing) this.handleInput(dt);
    else if (this.state === 'inventory') this.handleInventoryKeys();

    if (active) {
      const events = p.update(dt, playing ? this.moveInput() : NO_INPUT, w);
      this.playerSounds(events);
      if (this.dayCycle) this.time = (this.time + dt / DAY_LENGTH_SECONDS) % 1;
      this.fluids?.update(dt);
      for (let i = this.entities.length - 1; i >= 0; i--) {
        const e = this.entities[i];
        if (e.update(dt, w)) {
          this.entities.splice(i, 1);
          if (!e.remote) explode(this, e.x, e.y + 0.5, e.z, 4);
        }
      }
      this.particles.update(dt, w);
      this.swing = Math.min(1, this.swing + dt * 4);
      this.equip = Math.min(1, this.equip + dt * 5);
      this.shake = Math.max(0, this.shake - dt * 1.5);
      this.saveTimer += dt;
      if (this.saveTimer > AUTOSAVE_SECONDS) this.save();
    }
    if (online) {
      this.remote.update(dt);
      this.sendState(dt);
    }

    w.update(p.pos[0], p.pos[2], 6);
    this.updateTarget();
    this.render();
    this.updateHud(dt);
    this.net?.flush();
  }

  moveInput() {
    const k = (c) => this.input.down(c);
    if (!k('KeyW') && !k('ArrowUp')) this.sprintLatch = false;
    const t = this.touch;
    return {
      forward: k('KeyW') || k('ArrowUp') || t.moveZ < -0.25,
      back: k('KeyS') || k('ArrowDown'),
      left: k('KeyA') || k('ArrowLeft'),
      right: k('KeyD') || k('ArrowRight'),
      jump: k('Space') || t.jump,
      sneak: k('ShiftLeft') || k('ShiftRight') || t.sneak,
      sprint: k('ControlLeft') || k('ControlRight') || k('KeyR') || this.sprintLatch || Math.hypot(t.moveX, t.moveZ) > 0.97,
      // Analog joystick (overrides the digital keys when non-zero).
      ax: t.moveX,
      az: t.moveZ,
    };
  }

  handleInput(dt) {
    const input = this.input, p = this.player, s = this.settings;
    const sens = (s.sensitivity / 100) * 0.0022;
    const [tdx, tdy] = this.touch.consumeLook();
    const dx = input.mouseDX + tdx * 1.6, dy = input.mouseDY + tdy * 1.6;
    p.yaw -= dx * sens;
    p.pitch -= dy * sens * (s.invertY ? -1 : 1);
    if (this.touch.active) this.touch.update();
    p.pitch = clamp(p.pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
    p.yaw = ((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    if (input.wheel) this.selectSlot(this.selected + Math.sign(input.wheel));
    for (let i = 1; i <= 9; i++) if (input.wasPressed(`Digit${i}`)) this.selectSlot(i - 1);

    if (input.wasDoubleTapped('Space')) this.toggleFly();
    if (input.wasDoubleTapped('KeyW')) this.sprintLatch = true;
    if (input.wasPressed('F3')) this.debug = !this.debug;
    if (input.wasPressed('F1')) {
      this.hudVisible = !this.hudVisible;
      this.ui.setHudVisible(this.hudVisible);
    }
    if (input.wasPressed('KeyE')) return this.openInventory();
    if (input.wasPressed('KeyT')) return this.openChat('');
    if (input.wasPressed('Slash')) return this.openChat('/');

    this.breakCooldown -= dt;
    this.placeCooldown -= dt;
    if (input.clicked[0] || (input.buttons[0] && this.breakCooldown <= 0)) {
      this.breakBlock();
      this.breakCooldown = 0.25;
    }
    if (input.clicked[2] || (input.buttons[2] && this.placeCooldown <= 0)) {
      this.useBlock();
      this.placeCooldown = 0.22;
    }
    if (input.clicked[1]) this.pickBlock();
  }

  handleInventoryKeys() {
    const input = this.input;
    if (input.wasPressed('KeyE') || input.wasPressed('Escape')) return this.closeInventory();
    for (let i = 1; i <= 9; i++) {
      if (!input.wasPressed(`Digit${i}`)) continue;
      if (this.ui.hoveredBlock) this.setHotbarSlot(i - 1, this.ui.hoveredBlock);
      else this.selectSlot(i - 1);
    }
  }

  updateTarget() {
    const p = this.player;
    if (this.state !== 'playing') {
      this.target = null;
      return;
    }
    const eye = p.eye;
    const d = forwardVector(p.yaw, p.pitch);
    this.target = raycast(this.world, eye[0], eye[1], eye[2], d[0], d[1], d[2], REACH);
  }

  // ------------------------------------------------------------ interaction

  // In multiplayer, edits show immediately and are sent to the server, which confirms
  // them by broadcasting the change or corrects them by sending the real block back.
  breakBlock() {
    this.swing = 0;
    this.net?.send({ t: 'swing' });
    const t = this.target;
    if (!t) return;
    const id = t.block;
    this.world.setBlock(t.x, t.y, t.z, 0);
    if (this.net) this.net.send({ t: 'set', x: t.x, y: t.y, z: t.z, id: 0 });
    else this.fluids.notifyRemoved(t.x, t.y, t.z);
    this.particles.blockBreak(t.x, t.y, t.z, id);
    this.sound.blockBreak(BLOCKS[id].sound);
    this.world.flushNear(t.x, t.z);
  }

  useBlock() {
    const t = this.target;
    if (!t) return;
    const w = this.world, p = this.player;
    if (t.block === B.tnt && !p.sneaking) {
      w.setBlock(t.x, t.y, t.z, 0);
      if (this.net) {
        this.net.send({ t: 'ignite', x: t.x, y: t.y, z: t.z });
        this.net.send({ t: 'swing' });
      } else {
        this.entities.push(new PrimedTNT(t.x, t.y, t.z, 4));
        this.sound.fuse();
      }
      this.swing = 0;
      w.flushNear(t.x, t.z);
      return;
    }
    const id = this.hotbar[this.selected];
    if (!id) return;
    let x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    if (REPLACEABLE[t.block] && !LIQUID[t.block] && t.block !== id) {
      x = t.x;
      y = t.y;
      z = t.z;
    }
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cur = w.getBlock(x, y, z);
    if (cur !== 0 && !REPLACEABLE[cur]) return;
    if (SOLID[id] && (p.intersectsBlock(x, y, z) || this.remote?.intersectsBlock(x, y, z))) return;
    if (NEEDS_SUPPORT[id]) {
      const below = w.getBlock(x, y - 1, z);
      const supported = SOLID[below] || (id === B.sugar_cane && below === B.sugar_cane);
      if (!supported && !(id === B.torch && t.ny === 0)) return;
    }
    w.setBlock(x, y, z, id);
    if (this.net) {
      this.net.send({ t: 'set', x, y, z, id });
      this.net.send({ t: 'swing' });
    }
    this.sound.blockPlace(BLOCKS[id].sound);
    this.swing = 0;
    w.flushNear(x, z);
  }

  pickBlock() {
    const t = this.target;
    if (!t || !BLOCKS[t.block].inventory) return;
    const i = this.hotbar.indexOf(t.block);
    if (i >= 0) this.selectSlot(i);
    else this.setHotbarSlot(this.selected, t.block);
  }

  playerSounds(events) {
    if (!events.length) return;
    const under = BLOCKS[this.player.blockUnderFeet(this.world)];
    for (const e of events) {
      if (e === 'step' || e === 'land') under && under.id && this.sound.step(under.sound);
      else if (e === 'splash') this.sound.splash();
      else if (e === 'swim') this.sound.swim();
    }
  }

  // ------------------------------------------------------------ rendering

  render() {
    const p = this.player, w = this.world, s = this.settings;
    const env = environment(this.time);
    const eye = p.eye;
    let ex = eye[0], ey = eye[1], ez = eye[2];
    if (s.viewBobbing && p.bobAmount > 0) {
      const b = p.bobAmount;
      const side = Math.sin(p.bobPhase * Math.PI) * 0.05 * b;
      ex += Math.cos(p.yaw) * side;
      ez -= Math.sin(p.yaw) * side;
      ey += -Math.abs(Math.cos(p.bobPhase * Math.PI)) * 0.07 * b + 0.035 * b;
    }
    if (this.shake > 0) {
      const k = this.shake * this.shake * 0.35;
      ex += (Math.random() - 0.5) * k;
      ey += (Math.random() - 0.5) * k;
      ez += (Math.random() - 0.5) * k;
    }
    const targetFov = p.sprinting ? 1.12 : 1;
    this.fovScale += (targetFov - this.fovScale) * 0.15;
    const cam = { x: ex, y: ey, z: ez, yaw: p.yaw, pitch: p.pitch, fov: s.fov * this.fovScale };

    const ws = this.renderer.worldSprites;
    ws.clear();
    for (const e of this.entities) e.draw(ws, cam, w, env.sunlight);
    this.remote?.draw(ws, cam, w, env.sunlight, (w.renderDistance + 1) * 16);
    this.particles.build(ws, cam, w, env.sunlight);

    const hs = this.renderer.handSprites;
    hs.clear();
    if (this.hudVisible && this.state !== 'paused') {
      const light = lightBrightness(w.getLight(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2])), env.sunlight);
      buildHand(hs, this.hotbar[this.selected], {
        swing: this.swing,
        bobPhase: s.viewBobbing ? p.bobPhase : 0,
        bobAmount: s.viewBobbing ? p.bobAmount : 0,
        light,
        equip: this.equip,
      });
    }

    let selection = null;
    if (this.target && this.hudVisible) {
      const t = this.target;
      const bb = blockBounds(t.block);
      selection = { min: [t.x + bb[0], t.y + bb[1], t.z + bb[2]], max: [t.x + bb[3], t.y + bb[4], t.z + bb[5]] };
    }

    this.renderer.render({
      cam,
      env,
      time: this.clock,
      chunks: w.chunks.values(),
      renderDistance: w.renderDistance,
      selection,
      underwater: p.headInWater,
      inLava: p.headInLava,
      clouds: s.clouds,
    });
    this.remote?.updateTags(this.renderer.viewProj, cam, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  updateHud(dt) {
    const p = this.player;
    this.ui.setUnderwater(p.headInLava ? 'lava' : p.headInWater ? 'water' : null);
    this.debugTimer -= dt;
    if (this.debugTimer > 0) return;
    this.debugTimer = 0.25;
    if (this.settings.showFps && !this.debug) this.ui.setFps(`${this.fps} fps`);
    else this.ui.setFps(null);
    if (!this.debug) {
      this.ui.setDebug(null);
      return;
    }
    const w = this.world;
    const x = p.pos[0], y = p.pos[1], z = p.pos[2];
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const f = forwardVector(p.yaw, 0);
    const facing = Math.abs(f[0]) > Math.abs(f[2]) ? (f[0] > 0 ? 'east (+X)' : 'west (-X)') : f[2] > 0 ? 'south (+Z)' : 'north (-Z)';
    const light = w.getLight(bx, Math.floor(y + 0.5), bz);
    const biome = w.getBiome(bx, bz);
    let meshed = 0;
    for (const c of w.chunks.values()) if (c.mesh) meshed++;
    const t = this.target;
    const lines = [
      `Blockcraft — ${this.fps} fps`,
      `XYZ: ${x.toFixed(3)} / ${y.toFixed(3)} / ${z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}   Chunk: ${bx >> 4} ${bz >> 4}`,
      `Facing: ${facing}  (${((p.yaw * 180) / Math.PI).toFixed(1)} / ${((p.pitch * 180) / Math.PI).toFixed(1)})`,
      `Biome: ${BIOME_NAMES[biome] ?? '?'}`,
      `Light: sky ${light >> 4}, block ${light & 15}`,
      `Time: ${timeLabel(this.time)}${this.dayCycle ? '' : ' (frozen)'}`,
      `Chunks: ${w.chunks.size} loaded, ${meshed} meshed, ${this.renderer.stats.chunksDrawn} drawn, ${(this.renderer.stats.quads / 1000).toFixed(1)}k quads`,
      `Mode: ${p.flying ? 'flying' : p.inWater ? 'swimming' : p.onGround ? 'on ground' : 'airborne'}${p.sprinting ? ', sprinting' : ''}${p.sneaking ? ', sneaking' : ''}`,
      t ? `Target: ${BLOCKS[t.block].name} @ ${t.x} ${t.y} ${t.z}` : 'Target: —',
      `Seed: ${w.seed}`,
    ];
    if (this.net) lines.push(`Server: ${this.meta.name}, ${this.remote.size + 1} online`);
    this.ui.setDebug(lines.join('\n'));
  }

  // ------------------------------------------------------------ chat commands

  runChat(text) {
    const command = text.startsWith('/');
    const [cmdRaw, ...args] = command ? text.slice(1).split(/\s+/) : [];
    const cmd = (cmdRaw || '').toLowerCase();
    // Online, chat and world-wide commands (time, player list) go to the server.
    if (this.net && (!command || SERVER_COMMANDS.has(cmd))) {
      this.net.send({ t: 'chat', m: text });
      return;
    }
    if (!command) {
      this.ui.log(`<Player> ${text}`);
      return;
    }
    const p = this.player;
    const log = (m) => this.ui.log(m);
    switch (cmd) {
      case 'help':
        log(
          'Commands: /time set <day|noon|sunset|night|midnight|0-24000>, /daycycle <on|off>, /tp <x> <y> <z>, /spawn, /fly, /seed, /rd <2-16>, /give <block>' +
            (this.net ? ', /list' : ''),
        );
        break;
      case 'time': {
        if (args[0] === 'set' && args[1] !== undefined) {
          const named = { day: 0.02, sunrise: 0.98, morning: 0.05, noon: 0.25, sunset: 0.48, night: 0.55, midnight: 0.75 };
          const v = named[args[1]] ?? Number(args[1]) / 24000;
          if (Number.isFinite(v)) {
            this.time = ((v % 1) + 1) % 1;
            log(`Time set to ${timeLabel(this.time)}`);
          } else log('Usage: /time set <day|night|noon|midnight|0-24000>');
        } else log(`It is ${timeLabel(this.time)}`);
        break;
      }
      case 'daycycle':
        this.dayCycle = args[0] ? args[0] !== 'off' && args[0] !== 'false' : !this.dayCycle;
        log(`Day/night cycle ${this.dayCycle ? 'on' : 'off'}`);
        break;
      case 'tp': {
        const rel = (a, base) => (a?.startsWith('~') ? base + (Number(a.slice(1)) || 0) : Number(a));
        const x = rel(args[0], p.pos[0]), y = rel(args[1], p.pos[1]), z = rel(args[2], p.pos[2]);
        if ([x, y, z].every(Number.isFinite)) {
          p.pos = [x, clamp(y, 0, WORLD_HEIGHT + 20), z];
          p.vel = [0, 0, 0];
          log(`Teleported to ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`);
        } else log('Usage: /tp <x> <y> <z>  (~ for relative)');
        break;
      }
      case 'spawn':
        if (this.spawnPoint) {
          p.pos = [this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z];
          p.vel = [0, 0, 0];
          log('Teleported to spawn');
        }
        break;
      case 'fly':
        p.flying = !p.flying;
        log(p.flying ? 'Flying enabled' : 'Flying disabled');
        break;
      case 'seed':
        log(`Seed: ${this.world.seed}`);
        break;
      case 'rd':
      case 'renderdistance': {
        const n = clamp(Math.round(Number(args[0])), 2, 16);
        if (Number.isFinite(n)) {
          this.settings.renderDistance = n;
          this.saveSettings();
          log(`Render distance set to ${n}`);
        }
        break;
      }
      case 'give': {
        const q = args.join('_').toLowerCase();
        const b = BLOCKS.find((bl) => bl.inventory && (bl.key === q || bl.name.toLowerCase().replace(/\s+/g, '_') === q));
        if (b) {
          this.setHotbarSlot(this.selected, b.id);
          log(`Gave ${b.name}`);
        } else log(`Unknown block "${args.join(' ')}"`);
        break;
      }
      default:
        log(`Unknown command /${cmd}. Try /help`);
    }
  }
}

new Game();
