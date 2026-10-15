// Redstone: lamps, levers, buttons, dust, repeaters and pistons.
//
// Shared by singleplayer and the server (the multiplayer client just receives the resulting
// block changes). All state lives in block ids (power level, on/off, extended), so the
// simulation keeps no per-block data except pending timers, and saves need nothing extra.
//
// Simplified rules (documented in the README):
//  - Levers (on), pressed buttons and pressure plates with someone on them power everything next to them and the block they hang on.
//  - A powered block ("charged") powers the dust, lamps, pistons and repeaters next to it.
//  - Dust carries power 15 down to 1 along connected dust (also up and down a block), and
//    powers lamps and pistons next to it or below it, and a repeater it sits behind.
//  - A block of redstone always powers everything next to it.
//  - A redstone torch is a power source that turns off while the block under it is powered.
//  - TNT next to power (or on a powered block) is lit.
//  - A repeater passes power one way after 1-4 redstone ticks (0.1 s each).
//  - Pistons push up to 12 blocks, sticky ones pull one back; they won't push into a player.

import { B, BLOCKS, VARIANT, DECOR, SOLID, LIQUID, REPLACEABLE, ATTACH, FACE_DIR } from './blocks.js';
import { WORLD_HEIGHT as H } from './constants.js';

export const TICK = 0.1; // seconds per redstone tick
const BUTTON_TICKS = 10;
const PUSH_LIMIT = 12;
const MAX_DIRTY = 20000;
const MAX_NETWORK = 4096;
const RETRY_TICKS = 5;

const HORIZ = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // +X -X +Z -Z
// Repeater facing (rot) -> output direction: north, east, south, west.
const ROT_DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const kindOf = (id) => VARIANT[id]?.kind;
// Levers that are on, pressed buttons and pressure plates someone stands on.
const isSource = (v) => (v.kind === 'lever' && v.on) || (v.kind === 'button' && v.pressed) || (v.kind === 'plate' && v.on);
const PLATE_TICKS = 5; // a plate re-checks whether anyone is still on it this often

// Which horizontal sides of the dust at (0,0,0) connect, by what `get(dx, dy, dz)` returns:
// a bit per side of HORIZ for wire to draw. `links` (optional) receives [dx, dy, dz] of the
// dust it is wired to, which is what carries power.
export function dustShape(get, links) {
  let mask = 0;
  const aboveOpaque = SOLID[get(0, 1, 0)] === 1;
  HORIZ.forEach(([dx, dz], i) => {
    const side = get(dx, 0, dz);
    let on = false;
    if (kindOf(side) === 'dust') {
      on = true;
      links?.push([dx, 0, dz]);
    } else {
      // Up a step: dust on top of the neighbour, as long as nothing roofs this block.
      if (!aboveOpaque && SOLID[side] && kindOf(get(dx, 1, dz)) === 'dust') {
        on = true;
        links?.push([dx, 1, dz]);
      }
      // Down a step: dust below an open neighbour cell.
      if (!SOLID[side] && kindOf(get(dx, -1, dz)) === 'dust') {
        on = true;
        links?.push([dx, -1, dz]);
      }
      const v = VARIANT[side];
      if (v && (v.kind === 'lever' || v.kind === 'button')) on = true;
      if (v?.kind === 'repeater') {
        const [rx, rz] = ROT_DIR[v.rot];
        if (rx === dx && rz === dz) on = true; // dust in front of its output
        if (rx === -dx && rz === -dz) on = true; // dust behind its input
      }
    }
    if (on) mask |= 1 << i;
  });
  return mask;
}

export class Redstone {
  // `world` needs getBlock() and setBlocks(); `blocked(x, y, z, id)` says whether a player or
  // entity is in the way of that block (pistons won't squash anyone). Hooks:
  // `occupied(x, y, z)`: is anyone standing in that block (for pressure plates)?
  // `ignite(x, y, z)`: light the TNT block there (remove it, spawn primed TNT).
  constructor(world, blocked = () => false, { occupied = () => false, ignite = null } = {}) {
    this.world = world;
    this.blocked = blocked;
    this.occupied = occupied;
    this.ignite = ignite;
    this.dirty = new Map();
    this.timers = new Map(); // "kind,x,y,z" -> { at, kind, x, y, z }
    this.acc = 0;
    this.tick = 0;
  }

  // A block at (x, y, z) changed: everything within two blocks may behave differently now.
  notify(x, y, z) {
    if (this.dirty.size > MAX_DIRTY) return;
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2 + Math.abs(dx); dy <= 2 - Math.abs(dx); dy++) {
        const r = 2 - Math.abs(dx) - Math.abs(dy);
        for (let dz = -r; dz <= r; dz++) {
          const cy = y + dy;
          if (cy < 0 || cy >= H) continue;
          this.dirty.set(`${x + dx},${cy},${z + dz}`, [x + dx, cy, z + dz]);
        }
      }
  }

  update(dt) {
    if (this.dirty.size) this.settle();
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK && steps++ < 4) {
      this.acc -= TICK;
      this.tick++;
      this.runTimers();
      if (this.dirty.size) this.settle();
    }
    if (this.acc > TICK) this.acc = 0;
  }

  // Something stands with its feet in block (x, y, z): press the pressure plate there, if any.
  // Hosts call this every tick for players and mobs.
  stepOn(x, y, z) {
    const v = VARIANT[this.get(x, y, z)];
    if (v?.kind !== 'plate') return;
    if (!v.on) this.world.setBlocks([[x, y, z, DECOR.plate[v.wood ? 1 : 0][1]]]);
    this.schedule('plate', x, y, z, PLATE_TICKS);
  }

  clear() {
    this.dirty.clear();
    this.timers.clear();
  }

  get(x, y, z) {
    return y < 0 || y >= H ? 0 : this.world.getBlock(x, y, z);
  }

  schedule(kind, x, y, z, ticks) {
    const key = `${kind},${x},${y},${z}`;
    if (!this.timers.has(key)) this.timers.set(key, { at: this.tick + ticks, kind, x, y, z });
  }

  // ------------------------------------------------------------ power sources

  // Is the block at (x, y, z) a solid block that something is powering directly?
  charged(x, y, z) {
    if (!SOLID[this.get(x, y, z)]) return false;
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIR[f];
      const mx = x + dx, my = y + dy, mz = z + dz;
      const id = this.get(mx, my, mz);
      const v = VARIANT[id];
      if (!v) continue;
      if (isSource(v)) {
        const a = FACE_DIR[ATTACH[id]];
        if (mx + a[0] === x && my + a[1] === y && mz + a[2] === z) return true;
      } else if (v.kind === 'repeater' && v.on) {
        const [rx, rz] = ROT_DIR[v.rot];
        if (mx + rx === x && mz + rz === z && my === y) return true;
      } else if (v.kind === 'rstorch' && v.on && f === 3) return true; // the torch under this block
    }
    return false;
  }

  // Does the neighbour at (mx, my, mz) push power into the non-dust cell (x, y, z)?
  feeds(mx, my, mz, x, y, z) {
    const id = this.get(mx, my, mz);
    if (id === B.redstone_block) return true;
    const v = VARIANT[id];
    if (v) {
      if (isSource(v)) return true;
      if (v.kind === 'repeater') {
        if (!v.on) return false;
        const [rx, rz] = ROT_DIR[v.rot];
        return my === y && mx + rx === x && mz + rz === z;
      }
      if (v.kind === 'rstorch') return v.on && my <= y; // a lit torch powers what's above and beside it
      if (v.kind === 'dust') return v.power > 0 && my >= y; // dust powers what's beside or below it
    }
    return this.charged(mx, my, mz);
  }

  powered(x, y, z, skipFace = -1) {
    for (let f = 0; f < 6; f++) {
      if (f === skipFace) continue;
      const [dx, dy, dz] = FACE_DIR[f];
      if (this.feeds(x + dx, y + dy, z + dz, x, y, z)) return true;
    }
    return false;
  }

  repeaterInput(x, y, z, v) {
    const [rx, rz] = ROT_DIR[v.rot];
    return this.feeds(x - rx, y, z - rz, x, y, z);
  }

  dustInput(x, y, z) {
    let best = 0;
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIR[f];
      const mx = x + dx, my = y + dy, mz = z + dz;
      const id = this.get(mx, my, mz);
      if (id === B.redstone_block) return 15;
      const v = VARIANT[id];
      if (v) {
        if (isSource(v)) return 15;
        if (v.kind === 'repeater') {
          if (v.on) {
            const [rx, rz] = ROT_DIR[v.rot];
            if (my === y && mx + rx === x && mz + rz === z) return 15;
          }
          continue;
        }
        if (v.kind === 'rstorch') {
          if (v.on && my === y) return 15;
          continue;
        }
        if (v.kind === 'dust') continue;
      }
      if (this.charged(mx, my, mz)) return 15;
    }
    return best;
  }

  // ------------------------------------------------------------ settling

  settle() {
    const cells = [...this.dirty.values()];
    this.dirty.clear();
    const writes = [];
    const seen = new Set();
    for (const [x, y, z] of cells) {
      const id = this.get(x, y, z);
      if (id === B.tnt) {
        if (this.ignite && this.powered(x, y, z)) this.ignite(x, y, z);
        continue;
      }
      const v = VARIANT[id];
      if (!v) continue;
      switch (v.kind) {
        case 'dust':
          if (!seen.has(`${x},${y},${z}`)) this.solveDust(x, y, z, seen, writes);
          break;
        case 'lamp': {
          const on = this.powered(x, y, z);
          if (on !== v.on) writes.push([x, y, z, DECOR.lamp[on ? 1 : 0]]);
          break;
        }
        case 'button':
          if (v.pressed) this.schedule('button', x, y, z, BUTTON_TICKS);
          break;
        case 'repeater':
          if (this.repeaterInput(x, y, z, v) !== v.on) this.schedule('repeater', x, y, z, v.delay);
          break;
        case 'rstorch':
          if (!this.powered(x, y - 1, z, 2) !== v.on) this.schedule('torch', x, y, z, 1);
          break;
        case 'piston':
          if (this.powered(x, y, z, v.facing) !== v.extended) this.schedule('piston', x, y, z, 1);
          break;
      }
    }
    if (writes.length) this.world.setBlocks(writes);
  }

  // Power of every dust block connected to this one, from the strongest sources downhill.
  solveDust(x0, y0, z0, seen, writes) {
    const cells = new Map();
    const stack = [[x0, y0, z0]];
    cells.set(`${x0},${y0},${z0}`, null);
    const nodes = [];
    while (stack.length && nodes.length < MAX_NETWORK) {
      const [x, y, z] = stack.pop();
      const links = [];
      dustShape((dx, dy, dz) => this.get(x + dx, y + dy, z + dz), links);
      const node = { x, y, z, input: this.dustInput(x, y, z), power: 0, links: [], id: this.get(x, y, z) };
      nodes.push(node);
      cells.set(`${x},${y},${z}`, node);
      for (const [dx, dy, dz] of links) {
        const k = `${x + dx},${y + dy},${z + dz}`;
        node.links.push(k);
        if (!cells.has(k)) {
          cells.set(k, null);
          stack.push([x + dx, y + dy, z + dz]);
        }
      }
    }
    const buckets = Array.from({ length: 16 }, () => []);
    for (const n of nodes) {
      seen.add(`${n.x},${n.y},${n.z}`);
      n.power = n.input;
      buckets[n.power].push(n);
    }
    for (let p = 15; p >= 2; p--) {
      for (const n of buckets[p]) {
        if (n.power !== p) continue;
        for (const k of n.links) {
          const m = cells.get(k);
          // Wires are linked one way if the neighbour's own links don't include this one (a step
          // seen from the other side); the power rule is symmetric, so just relax.
          if (m && m.power < p - 1) {
            m.power = p - 1;
            buckets[p - 1].push(m);
          }
        }
      }
    }
    for (const n of nodes) {
      const cur = VARIANT[n.id].power;
      if (cur !== n.power) writes.push([n.x, n.y, n.z, DECOR.dust[n.power]]);
    }
  }

  // ------------------------------------------------------------ timers

  runTimers() {
    if (!this.timers.size) return;
    const due = [];
    for (const [key, t] of this.timers) if (t.at <= this.tick) due.push([key, t]);
    for (const [key, t] of due) {
      this.timers.delete(key);
      const id = this.get(t.x, t.y, t.z);
      const v = VARIANT[id];
      if (!v) continue;
      if (t.kind === 'button' && v.kind === 'button' && v.pressed) this.world.setBlocks([[t.x, t.y, t.z, DECOR.button[v.mount][0]]]);
      else if (t.kind === 'plate' && v.kind === 'plate' && v.on) {
        if (this.occupied(t.x, t.y, t.z)) this.schedule('plate', t.x, t.y, t.z, PLATE_TICKS);
        else this.world.setBlocks([[t.x, t.y, t.z, DECOR.plate[v.wood ? 1 : 0][0]]]);
      } else if (t.kind === 'torch' && v.kind === 'rstorch') {
        const on = !this.powered(t.x, t.y - 1, t.z, 2);
        if (on !== v.on) this.world.setBlocks([[t.x, t.y, t.z, DECOR.rstorch[on ? 1 : 0]]]);
      } else if (t.kind === 'repeater' && v.kind === 'repeater') {
        const input = this.repeaterInput(t.x, t.y, t.z, v);
        if (input !== v.on) this.world.setBlocks([[t.x, t.y, t.z, DECOR.repeater[v.rot][v.delay - 1][input ? 1 : 0]]]);
      } else if (t.kind === 'piston' && v.kind === 'piston') {
        const want = this.powered(t.x, t.y, t.z, v.facing);
        if (want === v.extended) continue;
        const ok = want ? this.extend(t.x, t.y, t.z, v) : this.retract(t.x, t.y, t.z, v);
        if (!ok) this.schedule('piston', t.x, t.y, t.z, RETRY_TICKS);
      }
    }
  }

  // ------------------------------------------------------------ pistons

  immovable(id) {
    const k = kindOf(id);
    return BLOCKS[id].hardness < 0 || id === B.obsidian || k === 'pistonHead' || (k === 'piston' && VARIANT[id].extended);
  }

  // Blocks that are simply broken when something is pushed into them.
  crushable(id) {
    return id === 0 || REPLACEABLE[id] === 1 || LIQUID[id] === 1 || (!SOLID[id] && !this.immovable(id));
  }

  extend(x, y, z, v) {
    const [dx, dy, dz] = FACE_DIR[v.facing];
    const chain = [];
    let cx = x + dx, cy = y + dy, cz = z + dz;
    for (;;) {
      if (cy < 0 || cy >= H) return true; // blocked by the world edge: stay retracted, don't retry
      const id = this.get(cx, cy, cz);
      if (this.crushable(id)) break;
      if (this.immovable(id) || chain.length >= PUSH_LIMIT) return true;
      chain.push([cx, cy, cz, id]);
      cx += dx; cy += dy; cz += dz;
    }
    if (cy < 0 || cy >= H) return true;
    const head = DECOR.pistonHead[v.sticky ? 1 : 0][v.facing];
    // Don't squash anybody: every cell that gets a new solid block must be free of players.
    for (const [bx, by, bz, id] of chain) if (this.blocked(bx + dx, by + dy, bz + dz, id)) return false;
    if (this.blocked(x + dx, y + dy, z + dz, head)) return false;
    const writes = [];
    for (let i = chain.length - 1; i >= 0; i--) writes.push([chain[i][0] + dx, chain[i][1] + dy, chain[i][2] + dz, chain[i][3]]);
    writes.push([x + dx, y + dy, z + dz, head]);
    writes.push([x, y, z, DECOR.piston[v.sticky ? 1 : 0][v.facing][1]]);
    this.world.setBlocks(writes);
    return true;
  }

  retract(x, y, z, v) {
    const [dx, dy, dz] = FACE_DIR[v.facing];
    const fx = x + dx, fy = y + dy, fz = z + dz;
    const h = VARIANT[this.get(fx, fy, fz)];
    const writes = [];
    if (h?.kind === 'pistonHead' && h.facing === v.facing) {
      const bx = fx + dx, by = fy + dy, bz = fz + dz;
      const pulled = by >= 0 && by < H ? this.get(bx, by, bz) : 0;
      if (v.sticky && pulled !== 0 && SOLID[pulled] && !this.immovable(pulled)) {
        writes.push([fx, fy, fz, pulled]);
        writes.push([bx, by, bz, 0]);
      } else writes.push([fx, fy, fz, 0]);
    }
    writes.push([x, y, z, DECOR.piston[v.sticky ? 1 : 0][v.facing][0]]);
    this.world.setBlocks(writes);
    return true;
  }
}
