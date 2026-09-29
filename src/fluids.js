// Simple flowing liquids: water/lava pour into newly opened space, fall straight down and
// spread a limited distance sideways (7 blocks for water, 3 for lava).

import { B, LIQUID, REPLACEABLE } from './blocks.js';

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MAX_PER_TICK = 256;

const canFlowInto = (id) => id === 0 || (REPLACEABLE[id] && !LIQUID[id]);

export class Fluids {
  constructor(world) {
    this.world = world;
    this.queue = [];
    this.keys = new Set();
  }

  // Called after a block at (x, y, z) was removed.
  notifyRemoved(x, y, z) {
    const w = this.world;
    const above = w.getBlock(x, y + 1, z);
    if (LIQUID[above]) {
      this.schedule(x, y, z, above, 0);
      return;
    }
    for (const [dx, dz] of SIDES) {
      const n = w.getBlock(x + dx, y, z + dz);
      if (LIQUID[n]) {
        this.schedule(x, y, z, n, 1);
        return;
      }
    }
  }

  schedule(x, y, z, id, level) {
    const key = `${x},${y},${z}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.queue.push({ x, y, z, id, level, t: id === B.lava ? 0.9 : 0.25, key });
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
    for (const q of due) {
      this.keys.delete(q.key);
      if (!canFlowInto(w.getBlock(q.x, q.y, q.z))) continue;
      place.push([q.x, q.y, q.z, q.id]);
      const below = w.getBlock(q.x, q.y - 1, q.z);
      if (q.y > 0 && canFlowInto(below)) next.push([q.x, q.y - 1, q.z, q.id, 0]);
      else if (!LIQUID[below] && q.level < (q.id === B.lava ? 3 : 7)) {
        for (const [dx, dz] of SIDES)
          if (canFlowInto(w.getBlock(q.x + dx, q.y, q.z + dz))) next.push([q.x + dx, q.y, q.z + dz, q.id, q.level + 1]);
      }
    }
    if (place.length) w.setBlocks(place);
    for (const [x, y, z, id, level] of next) this.schedule(x, y, z, id, level);
  }

  clear() {
    this.queue = [];
    this.keys.clear();
  }
}
