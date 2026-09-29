// Simple flowing liquids: water/lava pour into newly opened space, fall straight down and
// spread a limited distance sideways (7 blocks for water, 3 for lava) once supported.

import { B, LIQUID, REPLACEABLE } from './blocks.js';

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MAX_PER_TICK = 256;

const canFlowInto = (id) => id === 0 || (REPLACEABLE[id] && !LIQUID[id]);

export class Fluids {
  constructor(world) {
    this.world = world;
    this.queue = [];
    this.keys = new Set();
    this.levels = new Map(); // flow distance of liquid placed by flowing (sources are 0)
  }

  // Called after a block at (x, y, z) was removed.
  notifyRemoved(x, y, z) {
    const w = this.world;
    const above = w.getBlock(x, y + 1, z);
    if (LIQUID[above]) {
      this.schedule(x, y, z, above, 0, false);
      return;
    }
    for (const [dx, dz] of SIDES) {
      const n = w.getBlock(x + dx, y, z + dz);
      if (LIQUID[n]) {
        this.schedule(x, y, z, n, (this.levels.get(`${x + dx},${y},${z + dz}`) ?? 0) + 1, false);
        return;
      }
    }
  }

  schedule(x, y, z, id, level, recheck) {
    const key = `${x},${y},${z}`;
    const qkey = recheck ? `r${key}` : key;
    if (this.keys.has(qkey)) return;
    this.keys.add(qkey);
    this.queue.push({ x, y, z, id, level, recheck, t: id === B.lava ? 0.9 : 0.25, key, qkey });
  }

  spread(x, y, z, id, level, out) {
    const w = this.world;
    const below = w.getBlock(x, y - 1, z);
    if (y > 0 && canFlowInto(below)) out.push([x, y - 1, z, id, 0]);
    else if (level < (id === B.lava ? 3 : 7)) {
      for (const [dx, dz] of SIDES) if (canFlowInto(w.getBlock(x + dx, y, z + dz))) out.push([x + dx, y, z + dz, id, level + 1]);
    }
  }

  update(dt) {
    if (!this.queue.length) return;
    const w = this.world;
    const due = [];
    const rest = [];
    for (const q of this.queue) {
      q.t -= dt;
      if (q.t <= 0 && due.length < MAX_PER_TICK) due.push(q);
      else rest.push(q);
    }
    if (!due.length) return;
    this.queue = rest;
    const place = [];
    const next = [];
    const recheck = [];
    for (const q of due) {
      this.keys.delete(q.qkey);
      const cur = w.getBlock(q.x, q.y, q.z);
      if (q.recheck) {
        if (cur === q.id) this.spread(q.x, q.y, q.z, q.id, q.level, next);
        continue;
      }
      if (!canFlowInto(cur)) continue;
      place.push([q.x, q.y, q.z, q.id]);
      this.levels.set(q.key, q.level);
      this.spread(q.x, q.y, q.z, q.id, q.level, next);
      // Liquid resting above can now spread sideways over this one.
      if (w.getBlock(q.x, q.y + 1, q.z) === q.id) recheck.push([q.x, q.y + 1, q.z, q.id, this.levels.get(`${q.x},${q.y + 1},${q.z}`) ?? 0]);
    }
    if (place.length) w.setBlocks(place);
    for (const [x, y, z, id, level] of next) this.schedule(x, y, z, id, level, false);
    for (const [x, y, z, id, level] of recheck) this.schedule(x, y, z, id, level, true);
    if (this.levels.size > 50000) this.levels.clear();
  }

  clear() {
    this.queue = [];
    this.keys.clear();
    this.levels.clear();
  }
}
