// Passive mobs (pig, cow, sheep, chicken): wandering AI, physics, spawning and hits.
//
// Shared by singleplayer (run in the browser) and the server (run there, streamed to clients).
// `world` needs getBlock(), boxesAt() and optionally isReady(cx, cz).

import { B, SOLID, LIQUID } from './blocks.js';
import { WORLD_HEIGHT as H } from './constants.js';
import { sweepAxis, boxHits } from './physics.js';

export const MOB_KINDS = ['pig', 'cow', 'sheep', 'chicken'];
// hw: half width of the collision box (covers the body), h: height, front: how far the head
// reaches ahead of the centre (so it stops before poking into walls), speed in blocks/s,
// hp: hits to remove.
export const MOB_INFO = {
  pig: { hw: 0.45, h: 1.0, front: 0.9, speed: 1.5, hp: 2, puff: 'pink_wool' },
  cow: { hw: 0.48, h: 1.5, front: 0.95, speed: 1.3, hp: 2, puff: 'brown_wool' },
  sheep: { hw: 0.45, h: 1.3, front: 0.85, speed: 1.3, hp: 2, puff: 'white_wool' },
  chicken: { hw: 0.25, h: 0.7, front: 0.5, speed: 1.2, hp: 2, puff: 'white_wool' },
};

const GRAVITY = 28;
const JUMP = 9.2; // clears a full block even at the server's 20 ticks a second
const HURT_TIME = 0.4;
const KNOCKBACK = 7;
const SPAWN_EVERY = 2; // seconds
const NEAR_CAP = 10; // mobs within NEAR of a player before spawning stops there
const NEAR = 48;
const DESPAWN = 96;
const MAX_MOBS = 150;
const DROP_LIMIT = 3; // won't walk off a ledge higher than this

export class Mob {
  constructor(id, kind, x, y, z, rng = Math.random) {
    this.id = id;
    this.kind = kind;
    this.info = MOB_INFO[kind];
    this.pos = [x, y, z];
    this.vel = [0, 0, 0];
    this.yaw = rng() * Math.PI * 2;
    this.onGround = false;
    this.hp = this.info.hp;
    this.hurt = 0; // seconds of red flash left
    this.knock = 0; // seconds during which knockback, not the AI, moves it
    this.timer = rng() * 3;
    this.target = null; // [x, z] it walks towards
    this.walking = false;
    this.rng = rng;
  }

  get x() { return this.pos[0]; }
  get y() { return this.pos[1]; }
  get z() { return this.pos[2]; }

  update(dt, world) {
    const p = this.pos, v = this.vel, { hw, h, speed } = this.info;
    if (world.isReady && !world.isReady(Math.floor(p[0] / 16), Math.floor(p[2] / 16))) return;
    if (this.hurt > 0) this.hurt -= dt;
    if (this.knock > 0) this.knock -= dt;
    const feet = world.getBlock(Math.floor(p[0]), Math.floor(p[1] + 0.2), Math.floor(p[2]));
    const inWater = LIQUID[feet] === 1;

    // Decide what to do next.
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.rng() < 0.6) {
        const a = this.rng() * Math.PI * 2, d = 3 + this.rng() * 5;
        this.target = [p[0] + Math.cos(a) * d, p[2] + Math.sin(a) * d];
        this.timer = 4 + this.rng() * 4;
      } else {
        this.target = null;
        this.timer = 2 + this.rng() * 4;
      }
    }

    let mx = 0, mz = 0;
    this.walking = false;
    if (this.target && this.knock <= 0) {
      const dx = this.target[0] - p[0], dz = this.target[1] - p[2];
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5) this.target = null;
      else {
        // Turn towards the target, then walk where it faces (it faces -Z at yaw 0, like players).
        const want = Math.atan2(-dx, -dz);
        let d = want - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += Math.sign(d) * Math.min(Math.abs(d), dt * 5);
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const reach = Math.max(this.info.front, hw) + 0.15;
        const ahead = this.ahead(world, p[0] + fx * reach, p[1], p[2] + fz * reach, inWater);
        if (ahead === 'step') {
          // Hop up before the head reaches the block.
          if (this.onGround || inWater) v[1] = JUMP;
        }
        if (ahead !== 'blocked' && (ahead === 'step' || this.safeAhead(world, p[0] + fx * (hw + 0.4), p[1], p[2] + fz * (hw + 0.4)))) {
          mx = fx * speed;
          mz = fz * speed;
          this.walking = true;
        } else this.target = null;
      }
    }

    if (this.knock <= 0) {
      v[0] = mx;
      v[2] = mz;
    } else if (this.onGround) {
      v[0] *= Math.max(0, 1 - dt * 6);
      v[2] *= Math.max(0, 1 - dt * 6);
    }
    if (inWater) v[1] = Math.min(v[1] + 20 * dt, 2.2); // swim up
    else v[1] -= GRAVITY * dt;
    if (this.kind === 'chicken' && v[1] < -3) v[1] = -3; // flaps on the way down
    if (v[1] < -40) v[1] = -40;

    const hitX = sweepAxis(world, p, hw, h, 0, v[0] * dt);
    const hitZ = sweepAxis(world, p, hw, h, 2, v[2] * dt);
    const stopY = sweepAxis(world, p, hw, h, 1, v[1] * dt);
    if (stopY) {
      this.onGround = v[1] < 0;
      v[1] = 0;
    } else this.onGround = false;
    // Hop up a one-block step when walking into it.
    if ((hitX || hitZ) && this.walking && (this.onGround || inWater) && !boxHits(world, p[0] - hw, p[1] + 1.05, p[2] - hw, p[0] + hw, p[1] + 1.05 + h, p[2] + hw)) v[1] = JUMP;
    if (p[1] < -20) p[1] = H; // fell out of the world: shouldn't happen, but don't fall forever
  }

  // What's in front at (x, z): 'clear', a one-block 'step' it can hop onto, or 'blocked'
  // (a wall it would poke its head into).
  ahead(world, x, y, z, inWater) {
    const bx = Math.floor(x), bz = Math.floor(z), by = Math.floor(y + 0.01);
    const { hw, h } = this.info;
    const tall = Math.ceil(h);
    let feet = false;
    for (let k = 0; k < tall; k++) {
      if (!world.boxesAt(bx, by + k, bz)) continue;
      if (k > 0) return 'blocked';
      feet = true;
    }
    if (!feet) return 'clear';
    for (let k = 1; k <= tall; k++) if (world.boxesAt(bx, by + k, bz)) return 'blocked';
    const p = this.pos;
    // Room above its own head to jump into?
    if (boxHits(world, p[0] - hw, p[1] + 1.05, p[2] - hw, p[0] + hw, p[1] + 1.05 + h, p[2] + hw)) return 'blocked';
    return inWater || this.onGround || this.vel[1] > 0 ? 'step' : 'clear';
  }

  // Is the ground in front firm, dry and not a cliff?
  safeAhead(world, x, y, z) {
    const bx = Math.floor(x), bz = Math.floor(z), by = Math.floor(y + 0.01);
    for (let d = 0; d <= DROP_LIMIT; d++) {
      const id = world.getBlock(bx, by - d, bz);
      if (LIQUID[id]) return false;
      if (SOLID[id] || world.boxesAt(bx, by - d, bz)) return true;
    }
    return false;
  }

  hitBy(fromX, fromZ) {
    const dx = this.pos[0] - fromX, dz = this.pos[2] - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vel[0] = (dx / d) * KNOCKBACK;
    this.vel[2] = (dz / d) * KNOCKBACK;
    this.vel[1] = 5;
    this.knock = 0.5;
    this.hurt = HURT_TIME;
    this.target = null;
    return --this.hp <= 0;
  }
}

// Leg swing for drawing, from how far a mob moved this frame.
export function animateWalk(e, dt, moved) {
  if (dt <= 0) return;
  const speed = moved / dt;
  e.walkAmount = (e.walkAmount || 0) + ((speed > 0.3 ? 1 : 0) - (e.walkAmount || 0)) * Math.min(1, dt * 8);
  e.walkPhase = (e.walkPhase || 0) + dt * speed * 6;
}

export class MobManager {
  constructor(world, { spawning = true, rng = Math.random } = {}) {
    this.world = world;
    this.spawning = spawning;
    this.rng = rng;
    this.mobs = new Map();
    this.nextId = 1;
    this.spawnTimer = 1;
    this.removed = []; // [id, puff] since the last takeRemoved()
  }

  // `players`: positions [x, y, z] the mobs live around.
  update(dt, players) {
    for (const m of this.mobs.values()) {
      const ox = m.pos[0], oz = m.pos[2];
      m.update(dt, this.world);
      animateWalk(m, dt, Math.hypot(m.pos[0] - ox, m.pos[2] - oz));
      const far = players.every((p) => Math.hypot(p[0] - m.pos[0], p[2] - m.pos[2]) > DESPAWN);
      if (far) this.remove(m.id, false);
    }
    if (!this.spawning) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = SPAWN_EVERY;
    for (const p of players) {
      if (this.mobs.size >= MAX_MOBS) break;
      let near = 0;
      for (const m of this.mobs.values()) if (Math.hypot(p[0] - m.pos[0], p[2] - m.pos[2]) < NEAR) near++;
      if (near >= NEAR_CAP) continue;
      const a = this.rng() * Math.PI * 2, d = 24 + this.rng() * (NEAR - 24);
      this.spawnHerd(Math.floor(p[0] + Math.cos(a) * d), Math.floor(p[1]), Math.floor(p[2] + Math.sin(a) * d));
    }
  }

  // A few animals of one kind on open grass around (x, z), if there is some.
  spawnHerd(x, y, z) {
    const w = this.world;
    if (w.isReady && !w.isReady(Math.floor(x / 16), Math.floor(z / 16))) return 0;
    const kind = MOB_KINDS[Math.floor(this.rng() * MOB_KINDS.length)];
    const n = 2 + Math.floor(this.rng() * 3);
    let made = 0;
    for (let i = 0; i < n * 2 && made < n; i++) {
      const sx = x + Math.floor((this.rng() - 0.5) * 6), sz = z + Math.floor((this.rng() - 0.5) * 6);
      const gy = this.grassAt(sx, y, sz);
      if (gy === null) continue;
      if (this.add(kind, sx + 0.5, gy + 1, sz + 0.5)) made++;
    }
    return made;
  }

  // Height of sky-lit grass near y in column (x, z), or null.
  grassAt(x, y, z) {
    const w = this.world;
    for (let yy = Math.min(H - 3, y + 24); yy > Math.max(1, y - 64); yy--) {
      const id = w.getBlock(x, yy, z);
      if (id === 0 || (!SOLID[id] && !LIQUID[id])) continue;
      if (id !== B.grass) return null;
      if (SOLID[w.getBlock(x, yy + 1, z)] || SOLID[w.getBlock(x, yy + 2, z)]) return null;
      // Open sky above: no spawning in caves or under roofs.
      for (let k = yy + 3; k < Math.min(H, yy + 40); k++) if (SOLID[w.getBlock(x, k, z)]) return null;
      return yy;
    }
    return null;
  }

  // A new mob, nudged up out of any block it would overlap; null if there's no room.
  add(kind, x, y, z) {
    const { hw, h } = MOB_INFO[kind];
    let k = 0;
    while (boxHits(this.world, x - hw, y + k, z - hw, x + hw, y + k + h, z + hw)) if (++k > 3) return null;
    y += k;
    const m = new Mob(this.nextId++, kind, x, y, z, this.rng);
    this.mobs.set(m.id, m);
    return m;
  }

  summon(kind, x, y, z, count = 1) {
    const out = [];
    for (let i = 0; i < count && this.mobs.size < MAX_MOBS; i++) {
      const m = this.add(kind, x + (this.rng() - 0.5) * 0.6, y, z + (this.rng() - 0.5) * 0.6) || this.add(kind, x, y, z);
      if (m) out.push(m);
    }
    return out;
  }

  // A player at (fromX, fromZ) hits mob `id`. Returns 'gone', 'hit' or null (no such mob).
  hit(id, fromX, fromZ) {
    const m = this.mobs.get(id);
    if (!m) return null;
    if (m.hitBy(fromX, fromZ)) {
      this.remove(id, true);
      return 'gone';
    }
    return 'hit';
  }

  remove(id, puff) {
    if (!this.mobs.delete(id)) return;
    this.removed.push([id, puff]);
  }

  takeRemoved() {
    const r = this.removed;
    this.removed = [];
    return r;
  }

  clear() {
    this.mobs.clear();
    this.removed = [];
  }
}

// Nearest mob a ray (origin o, unit direction d) hits within maxDist: { mob, dist } or null.
export function pickMob(mobs, o, d, maxDist) {
  let best = null;
  for (const m of mobs) {
    const { hw, h } = MOB_INFO[m.kind];
    const lo = [m.x - hw, m.y, m.z - hw], hi = [m.x + hw, m.y + h, m.z + hw];
    let t0 = 0, t1 = maxDist;
    for (let a = 0; a < 3 && t0 <= t1; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < lo[a] || o[a] > hi[a]) t0 = Infinity;
        continue;
      }
      let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t0 <= t1 && (!best || t0 < best.dist)) best = { mob: m, dist: t0 };
  }
  return best;
}
