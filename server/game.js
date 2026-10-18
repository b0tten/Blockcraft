// The multiplayer game: player sessions, block edits (the server has the final say),
// flowing liquids, TNT, time of day and chat. Runs a fixed 20 Hz tick.
//
// Movement is trusted from clients (like most block games), but every block change is
// checked and applied here first, then broadcast in order, so all clients agree.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ServerWorld } from './world.js';
import { saveWorld } from './storage.js';
import { Fluids } from '../src/fluids.js';
import { Redstone } from '../src/redstone.js';
import { MobManager, MOB_KINDS, standsIn } from '../src/mobs.js';
import { PrimedTNT, blast } from '../src/entities.js';
import { B, BLOCKS, SOLID, LIQUID, COLLIDE, FULL_BOX } from '../src/blocks.js';
import { placeChanges, useChanges, linkedRemoval, isSign, cleanSignLines } from '../src/world/rules.js';
import { WORLD_HEIGHT, DAY_LENGTH_SECONDS, GEN_VERSION, chunkKey } from '../src/constants.js';
import { editsToArray, signsToArray } from '../src/world/edits.js';
import { timeLabel } from '../src/sky.js';
import { clamp } from '../src/math.js';
import { PROTOCOL_VERSION, TICK_RATE, REACH, MAX_CHAT, NAME_RE, NAME_RULES, F_FLYING, F_SNEAKING } from '../src/net/protocol.js';

const DT = 1 / TICK_RATE;
const MAX_COORD = 500000; // chunk keys cover ±524288 blocks
const MAX_CHUNK = MAX_COORD >> 4;
const MAX_SUBS = 4096;
const EYE = 1.62;
const HALF_W = 0.3;
const HEIGHT = 1.8;
const OP_GRACE_MS = 5 * 60 * 1000;
const sha256 = (s) => createHash('sha256').update(String(s)).digest();
const OP_HELP = 'Operator commands: /summon <pig|cow|sheep|chicken> [count], /kick <name> [reason], /ban <name> [name|includes_name|browser|both] [30m|2h|7d] [reason], /unban <name or word>, /banlist, /tp <name>, /say <message>, /op <name>, /deop [name], /tnt [on|off], /save';
const OP_COMMANDS = new Set(['summon', 'ophelp', 'kick', 'tp', 'say', 'op', 'deop', 'save', 'ban', 'unban', 'banlist', 'tnt']);
const BID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DURATION = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
// "30m", "2h", "7d" -> milliseconds, or null.
const parseDuration = (s) => {
  const m = /^(\d+)([smhdw])$/i.exec(String(s || ''));
  return m ? Number(m[1]) * DURATION[m[2].toLowerCase()] : null;
};
const NAMED_TIMES = { day: 0.02, sunrise: 0.98, morning: 0.05, noon: 0.25, sunset: 0.48, night: 0.55, midnight: 0.75 };

const isInt = Number.isInteger;
const formatSpan = (ms) => {
  const units = [['w', 604800000], ['d', 86400000], ['h', 3600000], ['m', 60000]];
  for (const [u, n] of units) if (ms >= n * 0.98) return `${Math.round(ms / n)}${u}`;
  return `${Math.max(1, Math.round(ms / 1000))}s`;
};
// What a ban covers: a name, any name containing a word, the browser a player is using right
// now, or the name plus every browser it has been used from (the default).
export const BAN_TYPES = ['name', 'includes_name', 'browser', 'both'];
const BAN_USAGE = 'Usage: /ban <name> [name|includes_name|browser|both] [30m|2h|7d] [reason]';
const MIN_BAN_WORD = 3;
const TNT_OFF = 'TNT is turned off on this server.';
const banMessage = (e) => `You are banned from this server${e.until ? ` for another ${formatSpan(e.until - Date.now())}` : ''}${e.reason ? `: ${e.reason}` : '.'}`;
const isNum = Number.isFinite;
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
const cleanText = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT);

// Token bucket for rate limits.
class Bucket {
  constructor(perSecond, burst) {
    this.rate = perSecond;
    this.burst = burst;
    this.tokens = burst;
    this.last = Date.now();
  }
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const banCovers = (e, key, hash) => {
  if ((e.type === 'name' || e.type === 'both') && e.name.toLowerCase() === key) return true;
  if (e.type === 'includes_name' && key.includes(e.word)) return true;
  return (e.type === 'browser' || e.type === 'both') && !!hash && e.browsers.includes(hash);
};
const describeBan = (e) => `${e.type === 'includes_name' ? `*${e.word}*` : e.name} [${e.type}] (${e.until ? `${formatSpan(e.until - Date.now())} left` : 'permanent'})`;

// bans.json: { list: { id: ban }, seen: { name: [browser hashes] } }. Files from before ban
// types copied a ban onto every name a banned browser tried and every browser that then used
// that name; only each original ban is kept, with the browsers its own name was seen on.
export function migrateBans(saved) {
  const seen = saved?.seen || {};
  if (saved?.list) return { list: saved.list, seen };
  const list = {};
  for (const [key, e] of Object.entries(saved?.names || {})) {
    if (!e || String(e.name).toLowerCase() !== key) continue;
    const browsers = Object.entries(saved.browsers || {})
      .filter(([h, b]) => b && String(b.name).toLowerCase() === key && (seen[key] || []).includes(h))
      .map(([h]) => h);
    const id = randomBytes(6).toString('hex');
    list[id] = { id, type: 'both', name: e.name, by: e.by, reason: e.reason, until: e.until ?? null, at: e.at, browsers };
  }
  return { list, seen };
}

export class GameServer {
  constructor({ dir, meta, edits, signs, players, bans, config, log }) {
    this.dir = dir;
    this.config = config; // { name, motd, maxPlayers }
    this.meta = meta; // { name, seed, spawn, time, dayCycle, created, tnt? (false: TNT disabled) }
    this.newWorld(meta.seed, edits, signs);
    this.saved = players; // lower-case name -> { name, pos, yaw, pitch, flying }
    // Bans (see BAN_TYPES) and `seen`: which browsers (hashes of their random IDs) each name
    // used, so a ban can cover them. Kept across world resets.
    this.bans = migrateBans(bans);
    this.clients = new Set();
    this.byId = new Map(); // joined players
    // Temporary operators: lower-case name -> { keyHash, until }. A grant survives a disconnect
    // for a few minutes, but only a rejoin that presents the key given to that browser keeps it.
    this.ops = new Map();
    this.nextId = 1;
    this.ticks = 0;
    this.log = log;
    this.saving = null;
    if (!meta.spawn) meta.spawn = this.world.findSpawn();
    this.warned = new Set();
  }

  newWorld(seed, edits, signs) {
    this.world = new ServerWorld(seed, edits, signs, this.meta.gen ?? 1);
    this.world.allow = (x, z) => this.inBorder(x, z);
    this.fluids = new Fluids(this.world);
    this.redstone = new Redstone(this.world, (x, y, z, id) => this.occupied(x, y, z, id, null), {
      occupied: (x, y, z) => this.standingIn(x, y, z),
      ignite: (x, y, z) => {
        if (!this.tntAllowed) return; // the block stays as it is
        this.world.setBlock(x, y, z, 0);
        this.spawnTnt(x, y, z, 4);
      },
    });
    this.world.onChange = (x, y, z) => this.redstone.notify(x, y, z);
    this.mobs = new MobManager(this.world, { spawning: this.config.mobs !== false });
    this.tnts = [];
    this.events = [];
  }

  // Operators can switch TNT off: then it can't be placed or lit (by hand, redstone or other
  // explosions), but TNT already in the world stays where it is.
  get tntAllowed() {
    return this.meta.tnt !== false;
  }

  setTnt(on, by) {
    this.meta.tnt = on;
    this.broadcast({ t: 'rules', tnt: on });
    this.announce(`${by} turned TNT ${on ? 'on' : 'off'}`);
  }

  // The world border: a square of config.border chunks each way around spawn (0 = none).
  inBorder(x, z) {
    const b = this.config.border * 16, s = this.meta.spawn;
    if (!b || !s) return true;
    return Math.abs(Math.floor(x) - Math.floor(s[0])) < b && Math.abs(Math.floor(z) - Math.floor(s[2])) < b;
  }

  // ------------------------------------------------------------ scheduled resets

  get nextReset() {
    return this.config.resetDays > 0 ? this.meta.created + this.config.resetDays * 86400000 : null;
  }

  checkReset() {
    const at = this.nextReset;
    if (at === null) return;
    const left = at - Date.now();
    // Announce only the nearest of these, once each.
    const due = [[10000, '10 seconds'], [60000, '1 minute'], [600000, '10 minutes'], [3600000, '1 hour']].find(([ms]) => left > 0 && left <= ms);
    if (due && !this.warned.has(due[0])) {
      this.warned.add(due[0]);
      this.announce(`The world will be reset in ${due[1]}.`);
    }
    if (left <= 0) this.resetWorld();
  }

  // Start over with fresh terrain: everyone is disconnected and all edits and positions go.
  async resetWorld() {
    if (this.resetting) return;
    this.resetting = true;
    for (const c of [...this.clients]) this.kick(c, 'The world is being reset. Join again in a moment!');
    const seed = this.config.seed ?? Math.floor(Math.random() * 2147483647);
    this.meta = { ...this.meta, seed, gen: GEN_VERSION, created: Date.now(), time: 0.03, dayCycle: true, spawn: null };
    this.newWorld(seed, new Map(), new Map());
    this.saved = {};
    this.meta.spawn = this.world.findSpawn();
    this.warned = new Set();
    await this.saving;
    await this.save();
    this.log(`World reset (new seed ${seed})`);
    this.resetting = false;
  }

  start() {
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.log(`Tick failed: ${err.stack || err}`);
      }
    }, 1000 / TICK_RATE);
  }

  async stop(reason = 'Server closed') {
    clearInterval(this.timer);
    for (const c of [...this.clients]) this.kick(c, reason);
    await this.saving;
    await this.save();
  }

  info() {
    return { game: 'blockcraft', protocol: PROTOCOL_VERSION, name: this.config.name, motd: this.config.motd, players: this.byId.size, max: this.config.maxPlayers };
  }

  // ------------------------------------------------------------ connections

  connect(ws, ip) {
    const c = {
      ws, ip, id: 0, name: '',
      subs: new Set(),
      pos: null, yaw: 0, pitch: 0, flags: 0, moved: false, needsFull: true,
      msgs: new Bucket(120, 400),
      edits: new Bucket(25, 60),
      chats: new Bucket(1, 6),
    };
    this.clients.add(c);
    c.helloTimer = setTimeout(() => c.id || this.kick(c, 'No hello received'), 10000);
    ws.on('message', (text) => {
      try {
        this.onMessage(c, text);
      } catch (err) {
        this.log(`Error handling a message from ${c.name || ip}: ${err.stack || err}`);
        this.kick(c, 'Server error');
      }
    });
    ws.on('close', () => this.disconnect(c));
  }

  send(c, msg) {
    c.ws.send(JSON.stringify(msg));
  }

  broadcast(msg, except = null) {
    const s = JSON.stringify(msg);
    for (const c of this.byId.values()) if (c !== except) c.ws.send(s);
  }

  kick(c, reason) {
    this.send(c, { t: 'bye', reason });
    c.ws.close(4000, reason);
    this.disconnect(c);
  }

  disconnect(c) {
    if (!this.clients.delete(c)) return;
    clearTimeout(c.helloTimer);
    if (!c.id) return;
    const grant = c.op && this.ops.get(c.name.toLowerCase());
    if (grant) grant.until = Date.now() + (this.config.opGraceMs ?? OP_GRACE_MS);
    this.byId.delete(c.id);
    this.remember(c);
    this.broadcast({ t: 'leave', id: c.id, name: c.name });
    this.log(`${c.name} left the game`);
  }

  remember(c) {
    if (!c.pos) return;
    this.saved[c.name.toLowerCase()] = {
      name: c.name,
      pos: c.pos.map(round3),
      yaw: round3(c.yaw),
      pitch: round3(c.pitch),
      flying: !!(c.flags & F_FLYING),
    };
  }

  onMessage(c, text) {
    if (!c.msgs.take()) return this.kick(c, 'Too many messages');
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return this.kick(c, 'Malformed message');
    }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return this.kick(c, 'Malformed message');
    if (!c.id) return m.t === 'hello' ? this.hello(c, m) : this.kick(c, 'Expected hello');
    switch (m.t) {
      case 'pos': return this.onPos(c, m);
      case 'sub': return this.onSub(c, m);
      case 'unsub': return this.onUnsub(c, m);
      case 'set': return this.onSet(c, m);
      case 'ignite': return this.onIgnite(c, m);
      case 'use': return this.onUse(c, m);
      case 'sign': return this.onSign(c, m);
      case 'swing': return this.broadcast({ t: 'swing', id: c.id }, c);
      case 'hit': return this.onHit(c, m);
      case 'chat': return this.onChat(c, m);
      default: // unknown types are ignored so newer clients can add optional messages
    }
  }

  hello(c, m) {
    clearTimeout(c.helloTimer);
    if (m.v !== PROTOCOL_VERSION) {
      return this.kick(c, isNum(m.v) && m.v < PROTOCOL_VERSION ? 'Your game is out of date: reload the page' : 'This server runs an older version of Blockcraft');
    }
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    if (!NAME_RE.test(name)) return this.kick(c, `Invalid name. ${NAME_RULES}`);
    if (typeof m.bid !== 'string' || !BID_RE.test(m.bid)) return this.kick(c, 'Your game is out of date: reload the page');
    c.browser = sha256(m.bid).toString('hex').slice(0, 32);
    const ban = this.banFor(name, c.browser);
    if (ban) {
      this.log(`${name} was refused: banned (${c.ip})`);
      return this.kick(c, banMessage(ban));
    }
    if (this.byId.size >= this.config.maxPlayers) return this.kick(c, `The server is full (${this.config.maxPlayers} players)`);
    for (const o of this.byId.values()) if (o.name.toLowerCase() === name.toLowerCase()) return this.kick(c, `${o.name} is already playing on this server`);

    c.id = this.nextId++;
    c.name = name;
    this.noteBrowser(name, c.browser);
    const saved = this.saved[name.toLowerCase()] || null;
    if (saved) {
      c.pos = [...saved.pos];
      c.yaw = saved.yaw;
      c.pitch = saved.pitch;
      c.flags = saved.flying ? F_FLYING : 0;
    }
    const others = [...this.byId.values()].map((o) => ({ id: o.id, name: o.name }));
    this.byId.set(c.id, c);
    this.send(c, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      id: c.id,
      name,
      server: this.config.name,
      motd: this.config.motd,
      seed: this.meta.seed,
      gen: this.meta.gen ?? 1,
      time: this.meta.time,
      cycle: this.meta.dayCycle,
      tnt: this.tntAllowed,
      spawn: this.meta.spawn,
      you: saved && { pos: saved.pos, yaw: saved.yaw, pitch: saved.pitch, flying: saved.flying },
      players: others,
    });
    this.broadcast({ t: 'join', id: c.id, name }, c);
    this.log(`${name} joined the game (${c.ip})`);
    this.restoreOp(c, m.opKey);
  }

  // ------------------------------------------------------------ player messages

  onPos(c, m) {
    const p = m.p, r = m.r;
    if (!Array.isArray(p) || p.length !== 3 || !p.every(isNum) || !Array.isArray(r) || r.length !== 2 || !r.every(isNum)) return;
    c.pos = [clamp(p[0], -MAX_COORD, MAX_COORD), clamp(p[1], -64, 512), clamp(p[2], -MAX_COORD, MAX_COORD)];
    c.yaw = r[0] % (Math.PI * 2);
    c.pitch = clamp(r[1], -Math.PI / 2, Math.PI / 2);
    c.flags = isInt(m.f) ? m.f & (F_FLYING | F_SNEAKING) : 0;
    c.ms = isNum(m.ms) ? Math.round(m.ms) : null;
    c.moved = true;
    if (!this.inBorder(c.pos[0], c.pos[2])) {
      c.pos = [...this.meta.spawn];
      this.send(c, { t: 'tp', p: c.pos });
      this.send(c, { t: 'chat', m: 'You reached the world border and were sent back to spawn.' });
    }
  }

  chunkList(c, m) {
    const list = m.c;
    if (!Array.isArray(list) || list.length > 2048 || list.length % 2) {
      this.kick(c, 'Malformed message');
      return null;
    }
    const out = [];
    for (let i = 0; i < list.length; i += 2) {
      const cx = list[i], cz = list[i + 1];
      if (isInt(cx) && isInt(cz) && Math.abs(cx) <= MAX_CHUNK && Math.abs(cz) <= MAX_CHUNK) out.push([cx, cz, chunkKey(cx, cz)]);
    }
    return out;
  }

  onSub(c, m) {
    const list = this.chunkList(c, m);
    if (!list) return;
    for (const [cx, cz, key] of list) {
      if (c.subs.has(key)) continue;
      if (c.subs.size >= MAX_SUBS) return this.kick(c, 'Too many chunks requested');
      c.subs.add(key);
      this.send(c, { t: 'chunk', cx, cz, e: editsToArray(this.world.edits.get(key)), s: signsToArray(this.world.signs.get(key)) });
    }
  }

  onUnsub(c, m) {
    const list = this.chunkList(c, m);
    if (list) for (const [, , key] of list) c.subs.delete(key);
  }

  inReach(c, x, y, z) {
    if (!c.pos) return false;
    const dx = x + 0.5 - c.pos[0], dy = y + 0.5 - (c.pos[1] + EYE), dz = z + 0.5 - c.pos[2];
    const r = REACH + 2; // slack for latency
    return dx * dx + dy * dy + dz * dz <= r * r;
  }

  near(c, x, z, r) {
    return !!c.pos && (x + 0.5 - c.pos[0]) ** 2 + (z + 0.5 - c.pos[2]) ** 2 <= r * r;
  }

  // Is a player or mob standing in block (x, y, z) (on a pressure plate there)?
  standingIn(x, y, z) {
    for (const o of this.byId.values()) {
      const p = o.pos;
      if (p && p[0] + HALF_W > x && p[0] - HALF_W < x + 1 && p[2] + HALF_W > z && p[2] - HALF_W < z + 1 && p[1] < y + 0.25 && p[1] + HEIGHT > y) return true;
    }
    for (const m of this.mobs.mobs.values()) if (standsIn(m, x, y, z)) return true;
    return false;
  }

  // Would a solid block at (x, y, z) overlap a player other than `except`?
  // Would block `id` at (x, y, z) overlap a player other than `except`?
  occupied(x, y, z, id, except) {
    const boxes = SOLID[id] ? FULL_BOX : COLLIDE[id];
    if (!boxes) return false;
    for (const o of this.byId.values()) {
      if (o === except || !o.pos) continue;
      const p = o.pos;
      for (const b of boxes)
        if (p[0] + HALF_W > x + b[0] && p[0] - HALF_W < x + b[3] && p[1] + HEIGHT > y + b[1] && p[1] < y + b[4] && p[2] + HALF_W > z + b[2] && p[2] - HALF_W < z + b[5]) return true;
    }
    return false;
  }

  // Tell a client the real blocks where it guessed wrong (the column above too, since the
  // client may also have removed plants that lost their support). For requests far from the
  // player, only answer from terrain in memory, so bogus requests can't make us generate chunks.
  // `extra` lists other cells the client may have changed too (the other half of a door...).
  correct(c, x, y, z, cachedOnly = false, extra = []) {
    if (cachedOnly && !this.world.chunks.has(chunkKey(x >> 4, z >> 4))) return;
    const b = [];
    for (let yy = y; yy < Math.min(WORLD_HEIGHT, y + 5); yy++) b.push(x, yy, z, this.world.getBlock(x, yy, z));
    for (const [ex, ey, ez] of extra) if (ey >= 0 && ey < WORLD_HEIGHT) b.push(ex, ey, ez, this.world.getBlock(ex, ey, ez));
    this.send(c, { t: 'blocks', b });
  }

  validPos(x, y, z) {
    return isInt(x) && isInt(y) && isInt(z) && y >= 0 && y < WORLD_HEIGHT && Math.abs(x) <= MAX_COORD && Math.abs(z) <= MAX_COORD;
  }

  onSet(c, m) {
    const { x, y, z, id } = m;
    if (!this.validPos(x, y, z) || !isInt(id)) return;
    if (!this.inReach(c, x, y, z)) return this.correct(c, x, y, z, !this.near(c, x, z, 32));
    if (!this.inBorder(x, z)) return this.correct(c, x, y, z);
    const w = this.world;
    const cur = w.getBlock(x, y, z);
    const partner = linkedRemoval(w, cur, 0, x, y, z);
    const extra = partner ? [partner] : [];
    const block = BLOCKS[id];
    if (!block || (id !== 0 && !block.inventory) || !c.edits.take()) return this.correct(c, x, y, z, false, extra);
    if (id === B.tnt && !this.tntAllowed) {
      this.send(c, { t: 'chat', m: TNT_OFF });
      return this.correct(c, x, y, z, false, extra);
    }
    if (id === 0) {
      if (cur === 0) return;
      if (LIQUID[cur]) return this.correct(c, x, y, z, false, extra);
      w.setBlock(x, y, z, 0);
      this.fluids.notifyRemoved(x, y, z);
      this.event(x, z, { t: 'fx', k: 'break', x, y, z, id: cur }, c);
      return;
    }
    // Placing goes through the same rules as in the client (doors and beds take two blocks).
    const changes = placeChanges(w, x, y, z, id, isInt(m.r) ? m.r : 0, isInt(m.f) ? m.f : 2);
    const cells = changes || [[x, y, z]];
    if (!changes || changes.some(([cx, cy, cz, cid]) => !this.inBorder(cx, cz) || this.occupied(cx, cy, cz, cid, c))) {
      return this.correct(c, x, y, z, false, cells.concat(this.neighbours(x, y, z)));
    }
    w.setBlocks(changes);
    this.event(x, z, { t: 'fx', k: 'place', x, y, z, id: changes[0][3] }, c);
  }

  // Cells a two-block item could have taken next to (x, y, z), for corrections.
  neighbours(x, y, z) {
    return [[x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1]];
  }

  onUse(c, m) {
    const { x, y, z } = m;
    const held = isInt(m.id) && BLOCKS[m.id] && (m.id === 0 || BLOCKS[m.id].inventory) ? m.id : 0;
    if (!this.validPos(x, y, z)) return;
    if (!this.inReach(c, x, y, z)) return this.correct(c, x, y, z, !this.near(c, x, z, 32));
    const extra = [[x, y - 1, z]];
    if (!this.inBorder(x, z) || !c.edits.take()) return this.correct(c, x, y, z, false, extra);
    const changes = useChanges(this.world, x, y, z, held);
    if (!changes) return this.correct(c, x, y, z, false, extra);
    this.world.setBlocks(changes);
    this.event(x, z, { t: 'fx', k: 'place', x, y, z, id: changes[0][3] }, c);
  }

  onSign(c, m) {
    const { x, y, z } = m;
    const lines = cleanSignLines(m.l);
    if (!this.validPos(x, y, z) || !lines || !this.inReach(c, x, y, z) || !c.edits.take()) return;
    if (!isSign(this.world.getBlock(x, y, z))) return;
    this.world.setSign(x, y, z, lines);
    this.event(x, z, { t: 'sign', x, y, z, l: lines }, c);
  }

  // A player punches a mob: knockback, and it's gone after two hits.
  onHit(c, m) {
    const mob = isInt(m.id) ? this.mobs.mobs.get(m.id) : null;
    if (!mob || !c.pos || !c.edits.take()) return;
    const ex = c.pos[0], ey = c.pos[1] + 1.6, ez = c.pos[2];
    if (Math.hypot(mob.x - ex, mob.y + mob.info.h / 2 - ey, mob.z - ez) > REACH + 1.5) return;
    this.mobs.hit(mob.id, c.pos[0], c.pos[2]);
  }

  onIgnite(c, m) {
    const { x, y, z } = m;
    if (!this.validPos(x, y, z)) return;
    if (!this.inReach(c, x, y, z)) return this.correct(c, x, y, z, !this.near(c, x, z, 32));
    if (!this.inBorder(x, z)) return this.correct(c, x, y, z);
    if (!c.edits.take() || this.world.getBlock(x, y, z) !== B.tnt) return this.correct(c, x, y, z);
    if (!this.tntAllowed) {
      this.send(c, { t: 'chat', m: TNT_OFF });
      return this.correct(c, x, y, z);
    }
    this.world.setBlock(x, y, z, 0);
    this.spawnTnt(x, y, z, 4);
  }

  onChat(c, m) {
    if (typeof m.m !== 'string') return;
    if (!c.chats.take()) return this.send(c, { t: 'chat', m: 'You are sending messages too quickly.' });
    const text = cleanText(m.m);
    if (!text) return;
    if (text.startsWith('/')) return this.command(c, text);
    this.broadcast({ t: 'chat', m: `<${c.name}> ${text}` });
    this.log(`<${c.name}> ${text}`);
  }

  // Commands from players (c) or the server console (c = null).
  command(c, text) {
    const [cmdRaw, ...args] = text.replace(/^\//, '').split(/\s+/);
    const cmd = (cmdRaw || '').toLowerCase();
    const reply = (m) => (c ? this.send(c, { t: 'chat', m }) : this.log(m));
    const who = c ? c.name : 'The server';
    switch (cmd) {
      case 'time': {
        if (args[0] !== 'set' || args[1] === undefined) return reply(`It is ${timeLabel(this.meta.time)}`);
        const v = NAMED_TIMES[args[1]] ?? Number(args[1]) / 24000;
        if (!isNum(v)) return reply('Usage: /time set <day|noon|sunset|night|midnight|0-24000>');
        this.meta.time = ((v % 1) + 1) % 1;
        this.sendTime();
        this.announce(`${who} set the time to ${timeLabel(this.meta.time)}`);
        return;
      }
      case 'daycycle':
        this.meta.dayCycle = args[0] ? args[0] !== 'off' && args[0] !== 'false' : !this.meta.dayCycle;
        this.sendTime();
        this.announce(`${who} turned the day/night cycle ${this.meta.dayCycle ? 'on' : 'off'}`);
        return;
      case 'list':
      case 'who': {
        const names = [...this.byId.values()].map((o) => (o.op ? `*${o.name}` : o.name));
        return reply(`Online (${names.length}/${this.config.maxPlayers}): ${names.join(', ') || 'nobody'}`);
      }
      default:
        if (OP_COMMANDS.has(cmd)) {
          if (c && !c.op) return reply('You need to be an operator to do that.');
          if (this.opCommand(c, cmd, args, reply)) {
            if (c) this.log(`${c.name} ran /${cmd} ${args.join(' ')}`.trim());
            return;
          }
        }
        return reply(`Unknown command /${cmd}. Try /help`);
    }
  }

  // ------------------------------------------------------------ operators

  findOnline(name) {
    const n = String(name || '').toLowerCase();
    return [...this.byId.values()].find((o) => o.name.toLowerCase() === n) || null;
  }

  grantOp(c, by) {
    const key = randomBytes(24).toString('base64url');
    this.ops.set(c.name.toLowerCase(), { keyHash: sha256(key), until: null });
    c.op = true;
    this.send(c, { t: 'op', on: true, key });
    this.send(c, { t: 'chat', m: 'You are now an operator. /ophelp lists the commands; /deop gives it up.' });
    this.log(`${by} made ${c.name} an operator`);
  }

  revokeOp(name, by) {
    const had = this.ops.delete(String(name).toLowerCase());
    const c = this.findOnline(name);
    if (c?.op) {
      c.op = false;
      this.send(c, { t: 'op', on: false });
      this.send(c, { t: 'chat', m: 'You are no longer an operator.' });
    }
    if (had || c) this.log(`${by} removed operator status from ${c?.name || name}`);
    return had;
  }

  // A rejoin keeps operator status only within the grace time and with the browser's key.
  restoreOp(c, opKey) {
    const name = c.name.toLowerCase();
    const grant = this.ops.get(name);
    if (!grant) return;
    if (grant.until !== null && Date.now() > grant.until) {
      this.ops.delete(name);
      return;
    }
    const given = typeof opKey === 'string' ? sha256(opKey) : null;
    if (!given || !timingSafeEqual(given, grant.keyHash)) {
      this.ops.delete(name);
      this.log(`${c.name} joined without the operator key: operator status removed`);
      return;
    }
    grant.until = null;
    c.op = true;
    this.send(c, { t: 'op', on: true, key: opKey });
    this.send(c, { t: 'chat', m: 'You are still an operator.' });
  }

  expireOps() {
    const now = Date.now();
    for (const [name, g] of this.ops) if (g.until !== null && now > g.until) this.ops.delete(name);
  }

  // Operator-only commands; returns true if `cmd` was one of them.
  opCommand(c, cmd, args, reply) {
    const by = c ? c.name : 'The console';
    switch (cmd) {
      case 'ophelp':
        reply(OP_HELP);
        return true;
      case 'summon': {
        const kind = (args[0] || '').toLowerCase();
        if (!MOB_KINDS.includes(kind)) return reply(`Usage: /summon <${MOB_KINDS.join('|')}> [count]`), true;
        if (!c?.pos) return reply('Use /summon in game: animals appear in front of you'), true;
        const n = clamp(Math.round(Number(args[1] ?? 1)) || 1, 1, 10);
        const fx = -Math.sin(c.yaw || 0), fz = -Math.cos(c.yaw || 0);
        const made = this.mobs.summon(kind, c.pos[0] + fx * 2, c.pos[1] + 0.2, c.pos[2] + fz * 2, n);
        reply(`Summoned ${made.length} ${kind}${made.length === 1 ? '' : 's'}`);
        return true;
      }
      case 'kick': {
        const t = this.findOnline(args[0]);
        if (!t) return reply(`No player called "${args[0] ?? ''}" is online`), true;
        this.kick(t, args.slice(1).join(' ') || `Kicked by ${by}`);
        this.announce(`${by} kicked ${t.name}`);
        return true;
      }
      case 'tp': {
        const t = this.findOnline(args[0]);
        if (!c) return reply('Only players can teleport'), true;
        if (!t || !t.pos) return reply(`No player called "${args[0] ?? ''}" is online`), true;
        c.pos = [...t.pos];
        this.send(c, { t: 'tp', p: c.pos });
        this.log(`${by} teleported to ${t.name}`);
        return true;
      }
      case 'say':
        if (args.length) this.announce(`[${by}] ${args.join(' ')}`);
        return true;
      case 'op': {
        const t = this.findOnline(args[0]);
        if (!t) return reply(`No player called "${args[0] ?? ''}" is online`), true;
        if (t.op) return reply(`${t.name} is already an operator`), true;
        this.grantOp(t, by);
        reply(`${t.name} is now an operator`);
        return true;
      }
      case 'deop': {
        const name = args[0] || c?.name;
        if (!name) return reply('Usage: deop <name>'), true;
        if (!this.revokeOp(name, by)) reply(`${name} is not an operator`);
        else if (c && name.toLowerCase() !== c.name.toLowerCase()) reply(`${name} is no longer an operator`);
        return true;
      }
      case 'save':
        this.save().then(() => reply('World saved'));
        return true;
      case 'tnt': {
        const a = (args[0] || '').toLowerCase();
        if (a && !['on', 'off', 'true', 'false'].includes(a)) return reply('Usage: /tnt [on|off]'), true;
        const on = a ? a === 'on' || a === 'true' : !this.tntAllowed;
        if (on === this.tntAllowed) return reply(`TNT is already ${on ? 'on' : 'off'}`), true;
        this.setTnt(on, by);
        return true;
      }
      case 'ban': {
        const target = args[0];
        if (!target || !NAME_RE.test(target)) return reply(BAN_USAGE), true;
        let i = 1;
        const type = BAN_TYPES.includes(args[1]?.toLowerCase()) ? args[i++].toLowerCase() : 'both';
        const ms = parseDuration(args[i]);
        if (ms) i++;
        const reason = args.slice(i).join(' ').slice(0, 100);
        const err = this.ban(target, type, ms, reason, by, c);
        if (err) reply(err);
        return true;
      }
      case 'unban': {
        if (!args[0]) return reply('Usage: /unban <name or word>'), true;
        const n = this.unban(args[0]);
        reply(n ? `${args[0]} is no longer banned${n > 1 ? ` (${n} bans lifted)` : ''}` : `${args[0]} is not banned`);
        if (n) this.log(`${by} unbanned ${args[0]}`);
        return true;
      }
      case 'banlist': {
        const list = this.activeBans();
        reply(list.length ? `Banned: ${list.map(describeBan).join(', ')}` : 'Nobody is banned');
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ bans

  noteBrowser(name, hash) {
    const key = name.toLowerCase();
    const list = (this.bans.seen[key] || []).filter((h) => h !== hash);
    list.unshift(hash);
    this.bans.seen[key] = list.slice(0, 8);
  }

  activeBans() {
    const now = Date.now();
    for (const [id, e] of Object.entries(this.bans.list)) if (e.until !== null && e.until <= now) delete this.bans.list[id];
    return Object.values(this.bans.list);
  }

  // The ban that keeps this name or browser out, if any. Bans never spread: a banned browser
  // is refused under any name, but that doesn't ban the name it tried (or anyone else).
  banFor(name, hash) {
    const key = name.toLowerCase();
    return this.activeBans().find((e) => banCovers(e, key, hash)) || null;
  }

  // Returns an error message, or null when the ban was made.
  ban(target, type, ms, reason, by, issuer) {
    const key = target.toLowerCase();
    const me = issuer?.name.toLowerCase();
    const online = this.findOnline(target);
    const entry = { id: randomBytes(6).toString('hex'), type, name: online?.name || this.saved[key]?.name || target, by, reason, until: ms ? Date.now() + ms : null, at: Date.now() };
    if (type === 'includes_name') {
      if (key.length < MIN_BAN_WORD) return `The word must be at least ${MIN_BAN_WORD} characters`;
      if (me?.includes(key)) return 'That word is in your own name';
      entry.word = key;
      entry.name = key;
    } else if (key === me) return "You can't ban yourself";
    if (type === 'browser') {
      if (!online) return `${target} isn't online: a browser ban needs the player to be playing`;
      if (issuer && online.browser === issuer.browser) return "That's your own browser";
      entry.browsers = [online.browser];
    } else if (type === 'both') {
      const browsers = new Set(this.bans.seen[key] || []);
      if (online) browsers.add(online.browser);
      if (issuer) browsers.delete(issuer.browser);
      entry.browsers = [...browsers];
    }
    this.bans.list[entry.id] = entry;
    for (const o of [...this.byId.values()]) {
      if (!banCovers(entry, o.name.toLowerCase(), o.browser)) continue;
      this.revokeOp(o.name, by);
      this.kick(o, banMessage(entry));
    }
    const what = type === 'includes_name' ? `every name containing "${key}"` : type === 'browser' ? `${entry.name}'s browser` : type === 'name' ? `the name ${entry.name}` : entry.name;
    this.announce(`${by} banned ${what}${ms ? ` for ${formatSpan(ms)}` : ''}${reason ? `: ${reason}` : ''}`);
    this.save();
    if (type === 'both' && !entry.browsers.length) return `Note: ${entry.name} hasn't been seen here, so only the name is banned`;
    return null;
  }

  // Lifts every ban made against this name (any type), or for this word. Returns how many.
  unban(arg) {
    const key = String(arg).toLowerCase();
    let n = 0;
    for (const [id, e] of Object.entries(this.bans.list))
      if (e.name.toLowerCase() === key || e.word === key) {
        delete this.bans.list[id];
        n++;
      }
    if (n) this.save();
    return n;
  }


  announce(text) {
    this.broadcast({ t: 'chat', m: text });
    this.log(text);
  }

  sendTime() {
    this.broadcast({ t: 'time', v: Math.round(this.meta.time * 1e5) / 1e5, c: this.meta.dayCycle });
  }

  // ------------------------------------------------------------ simulation

  // Queue a message for everyone who has chunk (x >> 4, z >> 4) loaded.
  event(x, z, msg, except = null) {
    this.events.push({ key: chunkKey(x >> 4, z >> 4), msg, except });
  }

  spawnTnt(x, y, z, fuse) {
    this.tnts.push(new PrimedTNT(x, y, z, fuse));
    this.event(x, z, { t: 'tnt', x, y, z, f: round3(fuse) });
  }

  explode(x, y, z, radius) {
    let { list, chain, debris } = blast(this.world, x, y, z, radius);
    if (!this.tntAllowed) {
      // TNT that was already lit still goes off, but leaves other TNT in place.
      list = list.filter(([bx, by, bz]) => this.world.getBlock(bx, by, bz) !== B.tnt);
      chain = [];
    }
    this.world.setBlocks(list);
    for (const [bx, by, bz] of list) this.fluids.notifyRemoved(bx, by, bz);
    for (const [bx, by, bz] of chain) this.spawnTnt(bx, by, bz, 0.4 + Math.random() * 0.9);
    this.event(Math.floor(x), Math.floor(z), { t: 'boom', x: round3(x), y: round3(y), z: round3(z), r: radius, d: debris.flat() });
  }

  tick() {
    this.ticks++;
    const w = this.world;
    w.clock += DT;
    if (this.meta.dayCycle) this.meta.time = (this.meta.time + DT / DAY_LENGTH_SECONDS) % 1;
    this.fluids.update(DT);
    this.redstone.update(DT);
    this.mobs.update(DT, [...this.byId.values()].filter((c) => c.pos).map((c) => c.pos));
    // Pressure plates under players and animals.
    for (const c of this.byId.values()) if (c.pos) this.redstone.stepOn(Math.floor(c.pos[0]), Math.floor(c.pos[1] + 0.01), Math.floor(c.pos[2]));
    for (const m of this.mobs.mobs.values()) this.redstone.stepOn(Math.floor(m.x), Math.floor(m.y + 0.01), Math.floor(m.z));
    for (let i = this.tnts.length - 1; i >= 0; i--) {
      const e = this.tnts[i];
      if (e.update(DT, w)) {
        this.tnts.splice(i, 1);
        this.explode(e.x, e.y + 0.5, e.z, 4);
      }
    }
    this.flushBlocks();
    this.flushEvents();
    this.sendPlayers();
    if (this.ticks % 2 === 0) this.sendMobs();

    const every = (s) => this.ticks % Math.round(TICK_RATE * s) === 0;
    if (every(10)) this.sendTime();
    if (every(15)) for (const c of this.clients) c.ws.ping();
    if (every(10)) this.expireOps();
    if (every(30)) {
      const keep = new Set();
      for (const c of this.byId.values()) for (const k of c.subs) keep.add(k);
      w.evict(keep, 60);
    }
    if (every(60)) this.save();
    if (every(1)) this.checkReset();
  }

  // Mobs in each client's loaded chunks, 10 times a second: new and moved ones in `mobs`,
  // removed ones (or ones that walked out of view) in `mobgone`.
  sendMobs() {
    const removed = this.mobs.takeRemoved();
    if (!this.byId.size) return;
    const states = new Map();
    for (const m of this.mobs.mobs.values()) {
      const s = [m.id, MOB_KINDS.indexOf(m.kind), round2(m.x), round2(m.y), round2(m.z), round2(m.yaw), m.hurt > 0 ? 1 : 0];
      const moved = !m.sent || s.some((v, i) => v !== m.sent[i]);
      m.sent = s;
      states.set(m.id, { s, moved, key: chunkKey(Math.floor(m.x) >> 4, Math.floor(m.z) >> 4) });
    }
    for (const c of this.byId.values()) {
      const known = (c.mobs ||= new Set());
      const list = [], gone = [];
      for (const [id, st] of states) {
        if (c.subs.has(st.key)) {
          if (st.moved || !known.has(id)) list.push(st.s);
          known.add(id);
        } else if (known.delete(id)) gone.push([id, 0]);
      }
      for (const [id, puff] of removed) if (known.delete(id)) gone.push([id, puff ? 1 : 0]);
      if (list.length) this.send(c, { t: 'mobs', s: list });
      if (gone.length) this.send(c, { t: 'mobgone', g: gone });
    }
  }

  // Send each client the block changes in chunks it has loaded, in order.
  flushBlocks() {
    const ch = this.world.takeChanges();
    if (!ch.length || !this.byId.size) return;
    const out = new Map();
    for (let i = 0; i < ch.length; i += 4) {
      const key = chunkKey(ch[i] >> 4, ch[i + 2] >> 4);
      for (const c of this.byId.values()) {
        if (!c.subs.has(key)) continue;
        let b = out.get(c);
        if (!b) out.set(c, (b = []));
        b.push(ch[i], ch[i + 1], ch[i + 2], ch[i + 3]);
      }
    }
    for (const [c, b] of out) this.send(c, { t: 'blocks', b });
  }

  flushEvents() {
    const events = this.events;
    this.events = [];
    for (const { key, msg, except } of events) {
      const s = JSON.stringify(msg);
      for (const c of this.byId.values()) if (c !== except && c.subs.has(key)) c.ws.send(s);
    }
  }

  // Players that moved go to everyone else; newcomers get everybody once.
  sendPlayers() {
    const all = [], moved = [];
    for (const c of this.byId.values()) {
      if (!c.pos) continue;
      const s = [c.id, round3(c.pos[0]), round3(c.pos[1]), round3(c.pos[2]), round3(c.yaw), round3(c.pitch), c.flags, c.ms ?? null];
      all.push(s);
      if (c.moved) moved.push(s);
      c.moved = false;
    }
    for (const c of this.byId.values()) {
      const list = (c.needsFull ? all : moved).filter((s) => s[0] !== c.id);
      c.needsFull = false;
      if (list.length) this.send(c, { t: 'players', s: list });
    }
  }

  // ------------------------------------------------------------ persistence

  save() {
    if (!this.saving) {
      for (const c of this.byId.values()) this.remember(c);
      this.saving = saveWorld(this.dir, { meta: this.meta, edits: this.world.edits, signs: this.world.signs, players: this.saved, bans: this.bans })
        .catch((err) => this.log(`Saving failed: ${err.message}`))
        .finally(() => (this.saving = null));
    }
    return this.saving;
  }
}
