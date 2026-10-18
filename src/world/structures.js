// Generated structures: villages, desert pyramids and desert wells (generator version 2+).
//
// The world is cut into regions of 8x8 chunks. Each region holds at most one structure, whose
// kind, position and layout follow from the seed alone (`plan`). When a chunk is generated,
// the parts of its region's structure that fall inside it are built through a clipped `put`,
// so a structure comes out the same whichever chunk is generated first. Everything stays
// well inside its region, so a chunk only ever looks at its own region.

import { mulberry32, hash3i } from '../noise.js';
import { WORLD_HEIGHT as H, SEA_LEVEL as SEA, blockIndex } from '../constants.js';
import { B, DECOR, LIQUID, REPLACEABLE, NEEDS_SUPPORT } from '../blocks.js';
import { BIOME } from './generator.js';

const REGION = 128; // blocks
const MARGIN = 24; // anchors stay this far from region edges; structures reach at most 20 out
export const STRUCTURE_KINDS = ['village', 'pyramid', 'well'];

// Facing -> horizontal direction, as in rules.js: north, east, south, west.
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const STYLES = {
  plains: { floor: B.cobblestone, wall: B.oak_planks, corner: B.oak_log, roof: B.oak_planks, post: B.oak_log, well: B.cobblestone, path: B.gravel, steps: true },
  taiga: { floor: B.cobblestone, wall: B.spruce_planks, corner: B.spruce_log, roof: B.spruce_planks, post: B.spruce_log, well: B.cobblestone, path: B.gravel, steps: true },
  desert: { floor: B.sandstone, wall: B.sandstone, corner: B.sandstone, roof: B.sandstone, post: B.sandstone, well: B.sandstone, path: B.sandstone, steps: false },
};

// Natural blocks a foundation may replace, and the ones a path may pave over.
const SOFT = (id) => id === 0 || LIQUID[id] === 1 || REPLACEABLE[id] === 1 || NEEDS_SUPPORT[id] === 1 || id === B.oak_leaves || id === B.birch_leaves || id === B.spruce_leaves;
const PAVABLE = new Set([B.grass, B.dirt, B.sand, B.snowy_grass, B.gravel]);

export class Structures {
  constructor(gen) {
    this.gen = gen;
    this.seed = gen.seed;
    this.plans = new Map();
    this.col = { h: 0, biome: 0, temp: 0, river: 0, cont: 0 };
  }

  // ------------------------------------------------------------ planning

  // The structure of region (rx, rz), or null.
  plan(rx, rz) {
    const key = `${rx},${rz}`;
    if (this.plans.has(key)) return this.plans.get(key);
    if (this.plans.size > 4096) this.plans.clear();
    const p = this.makePlan(rx, rz);
    this.plans.set(key, p);
    return p;
  }

  makePlan(rx, rz) {
    const rng = mulberry32(hash3i(this.seed, rx, 7177, rz));
    if (rng() > 0.65) return null;
    const ax = rx * REGION + MARGIN + Math.floor(rng() * (REGION - 2 * MARGIN));
    const az = rz * REGION + MARGIN + Math.floor(rng() * (REGION - 2 * MARGIN));
    const c = this.column(ax, az);
    if (c.h <= SEA || c.river > 0.2) return null;
    const roll = rng();
    switch (c.biome) {
      case BIOME.DESERT:
        if (roll < 0.35) return this.planPyramid(ax, az, rng);
        if (roll < 0.65) return this.planWell(ax, az, rng);
        return this.planVillage(ax, az, rng, STYLES.desert);
      case BIOME.PLAINS:
      case BIOME.FOREST:
        return roll < 0.7 ? this.planVillage(ax, az, rng, STYLES.plains) : null;
      case BIOME.TAIGA:
        return roll < 0.5 ? this.planVillage(ax, az, rng, STYLES.taiga) : null;
      default:
        return null;
    }
  }

  column(x, z) {
    return this.gen.column(x, z, this.col);
  }

  // Ground height at the middle of a box if it's dry land and flat enough, else null.
  site(x0, z0, x1, z1, maxSpread) {
    let lo = H, hi = 0;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) >> 1, (z0 + z1) >> 1]]) {
      const c = this.column(x, z);
      if (c.h <= SEA || c.river > 0.2 || c.biome === BIOME.OCEAN || c.biome === BIOME.RIVER) return null;
      lo = Math.min(lo, c.h);
      hi = Math.max(hi, c.h);
    }
    if (hi - lo > maxSpread) return null;
    return this.column((x0 + x1) >> 1, (z0 + z1) >> 1).h;
  }

  planVillage(ax, az, rng, style) {
    const y = this.site(ax - 2, az - 2, ax + 1, az + 1, 2);
    if (y === null) return null;
    const pieces = [{ name: 'well', build: buildVillageWell, x: ax, y, z: az, rot: 0, box: [ax - 3, az - 3, ax + 2, az + 2], style }];
    const path = [];
    const level = []; // [x, z, y]: path cells set to exactly floor height (in front of doors)
    // The ring of path around the well.
    for (let d = -3; d <= 2; d++) path.push([ax + d, az - 3], [ax + d, az + 2], [ax - 3, az + d], [ax + 2, az + d]);
    const n = 4 + Math.floor(rng() * 4);
    const start = rng() * Math.PI * 2;
    // Try spots round the well (two rings) until n houses fit.
    for (let i = 0, placed = 0; i < n * 3 && placed < n; i++) {
      const angle = start + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const dist = (i % 2 ? 14 : 9) + rng() * 4;
      const hx = Math.round(ax + Math.cos(angle) * dist), hz = Math.round(az + Math.sin(angle) * dist);
      const kind = rng();
      const name = kind < 0.3 ? 'garden' : kind < 0.65 ? 'small' : 'big';
      const t = HOUSES[name];
      // Face the well.
      const dx = ax - hx, dz = az - hz;
      let rot = 0, best = -Infinity;
      DIRS.forEach(([ux, uz], r) => {
        const d = ux * dx + uz * dz;
        if (d > best) {
          best = d;
          rot = r;
        }
      });
      const [hw, hd] = rot % 2 ? [t.hd, t.hw] : [t.hw, t.hd];
      const box = [hx - hw, hz - hd, hx + hw, hz + hd];
      if (pieces.some((p) => overlaps(p.box, box, 2))) continue;
      const hy = this.site(box[0], box[1], box[2], box[3], 3);
      if (hy === null || Math.abs(hy - y) > 6) continue;
      pieces.push({ name, build: t.build, x: hx, y: hy, z: hz, rot, box, style });
      placed++;
      // A path from the well to the cell in front of the door.
      const [fx, fz] = DIRS[rot];
      const [lx, lz] = turn(0, -t.hd - 1, rot);
      const tx = hx + lx, tz = hz + lz;
      const sx = ax + Math.sign(tx - ax) * 3, sz = az + Math.sign(tz - az) * 3;
      for (const [px, pz] of lPath(sx, sz, tx, tz, rng() < 0.5)) path.push([px, pz]);
      // The two cells in front of the door sit level with the floor, so the ground can't
      // block the doorway.
      level.push([tx, tz, hy], [tx + fx, tz + fz, hy]);
    }
    if (pieces.length < 3) return null; // too few houses fit: no village here
    const isLevel = (x, z) => level.some(([lx, lz]) => lx === x && lz === z);
    const clearPath = path.filter(([x, z]) => !pieces.some((p) => inside(p.box, x, z)) && !isLevel(x, z));
    const clearLevel = level.filter(([x, z]) => !pieces.some((p) => inside(p.box, x, z)));
    return finish({ kind: 'village', x: ax, y, z: az, pieces, path: clearPath, level: clearLevel, style });
  }

  planPyramid(ax, az, rng) {
    const y = this.site(ax - 10, az - 10, ax + 10, az + 10, 5);
    if (y === null) return null;
    const rot = Math.floor(rng() * 4);
    return finish({ kind: 'pyramid', x: ax, y, z: az, pieces: [{ name: 'pyramid', build: buildPyramid, x: ax, y, z: az, rot, box: [ax - 10, az - 10, ax + 10, az + 10] }], path: [], level: [] });
  }

  planWell(ax, az, rng) {
    const y = this.site(ax - 2, az - 2, ax + 2, az + 2, 2);
    if (y === null) return null;
    return finish({ kind: 'well', x: ax, y, z: az, pieces: [{ name: 'desert well', build: buildDesertWell, x: ax, y, z: az, rot: 0, box: [ax - 2, az - 2, ax + 2, az + 2] }], path: [], level: [] });
  }

  // ------------------------------------------------------------ building

  regionOf(x, z) {
    return this.plan(Math.floor(x / REGION), Math.floor(z / REGION));
  }

  // Is (x, z) on or next to a structure? Trees aren't grown there.
  occupied(x, z) {
    const p = this.regionOf(x, z);
    return !!p && inside(p.box, x, z, 3);
  }

  // Build whatever part of this chunk's region structure lies in the chunk.
  apply(cx, cz, blocks) {
    const x0 = cx * 16, z0 = cz * 16;
    const p = this.regionOf(x0, z0);
    if (!p || !overlaps(p.box, [x0, z0, x0 + 15, z0 + 15], 0)) return;
    const inChunk = (x, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16;
    const ctx = {
      version: this.gen.version, // terrain generator version, for builders that change over time
      put(x, y, z, id) {
        if (!inChunk(x, z) || y < 1 || y >= H) return;
        blocks[blockIndex(x - x0, y, z - z0)] = id;
      },
      // Fill under (x, y, z) with `id` down to solid natural ground.
      foundation(x, y, z, id) {
        if (!inChunk(x, z)) return;
        for (let yy = y; yy > Math.max(0, y - 12); yy--) {
          const i = blockIndex(x - x0, yy, z - z0);
          if (!SOFT(blocks[i])) return;
          blocks[i] = id;
        }
      },
    };
    for (const piece of p.pieces) if (overlaps(piece.box, [x0, z0, x0 + 15, z0 + 15], 0)) piece.build(ctx, piece);
    // Paths: pave the top of the ground, and clear plants off it.
    for (const [x, z] of p.path) {
      if (!inChunk(x, z)) continue;
      for (let y = Math.min(H - 2, p.y + 8); y > Math.max(1, p.y - 8); y--) {
        const i = blockIndex(x - x0, y, z - z0);
        const id = blocks[i];
        if (id === 0 || NEEDS_SUPPORT[id] || REPLACEABLE[id]) continue;
        if (PAVABLE.has(id)) {
          blocks[i] = p.style.path;
          const above = blockIndex(x - x0, y + 1, z - z0);
          if (NEEDS_SUPPORT[blocks[above]]) blocks[above] = 0;
        }
        break;
      }
    }
    // Door steps: paving exactly at floor height, with a foundation under it and air above.
    for (const [x, z, y] of p.level) {
      if (!inChunk(x, z)) continue;
      ctx.foundation(x, y - 1, z, B.dirt);
      ctx.put(x, y, z, p.style.path);
      for (let k = 1; k <= 3; k++) ctx.put(x, y + k, z, 0);
    }
  }

  // Nearest planned structure of a kind to (x, z), searching `radius` regions out, or null.
  find(kind, x, z, radius = 12) {
    const rx0 = Math.floor(x / REGION), rz0 = Math.floor(z / REGION);
    let best = null, bestD = Infinity;
    for (let r = 0; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const p = this.plan(rx0 + dx, rz0 + dz);
          if (!p || p.kind !== kind) continue;
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      // Anything in a farther ring is at least (r * REGION) away.
      if (best && bestD < r * REGION) break;
    }
    return best && { kind, x: best.x, y: best.y, z: best.z };
  }
}

// ------------------------------------------------------------ helpers

function finish(p) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const q of p.pieces) {
    b[0] = Math.min(b[0], q.box[0]);
    b[1] = Math.min(b[1], q.box[1]);
    b[2] = Math.max(b[2], q.box[2]);
    b[3] = Math.max(b[3], q.box[3]);
  }
  for (const [x, z] of [...p.path, ...p.level]) {
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], z);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], z);
  }
  p.box = b;
  return p;
}

const overlaps = (a, b, pad) => a[0] - pad <= b[2] && b[0] <= a[2] + pad && a[1] - pad <= b[3] && b[1] <= a[3] + pad;
const inside = (b, x, z, pad = 0) => x >= b[0] - pad && x <= b[2] + pad && z >= b[1] - pad && z <= b[3] + pad;

// Quarter turns clockwise (seen from above), like rotateXZ: north -> east -> south -> west.
function turn(x, z, rot) {
  for (let i = 0; i < rot; i++) [x, z] = [-z, x];
  return [x, z];
}

function* lPath(x0, z0, x1, z1, xFirst) {
  let x = x0, z = z0;
  const sx = Math.sign(x1 - x0), sz = Math.sign(z1 - z0);
  if (xFirst) {
    for (; x !== x1; x += sx) yield [x, z];
    for (; z !== z1; z += sz) yield [x, z];
  } else {
    for (; z !== z1; z += sz) yield [x, z];
    for (; x !== x1; x += sx) yield [x, z];
  }
  yield [x1, z1];
}

// Local building coordinates: the front (door) faces -Z, turned by the piece's rot.
function frame(ctx, piece) {
  const { x, y, z, rot } = piece;
  return {
    set(ox, dy, oz, id) {
      const [wx, wz] = turn(ox, oz, rot);
      ctx.put(x + wx, y + dy, z + wz, id);
    },
    found(ox, oz, dy, id) {
      const [wx, wz] = turn(ox, oz, rot);
      ctx.foundation(x + wx, y + dy, z + wz, id);
    },
    face: (f) => (f + rot) & 3,
  };
}

// Floor at dy 0 with a foundation under it, and air above, over a rectangle.
function base(f, x0, z0, x1, z1, floor, height) {
  for (let ox = x0; ox <= x1; ox++)
    for (let oz = z0; oz <= z1; oz++) {
      f.found(ox, oz, -1, floor);
      f.set(ox, 0, oz, floor);
      for (let dy = 1; dy <= height; dy++) f.set(ox, dy, oz, 0);
    }
}

function door(f, ox, oz, facing) {
  f.set(ox, 1, oz, DECOR.door.lower[0][f.face(facing)]);
  f.set(ox, 2, oz, DECOR.door.upper[0][f.face(facing)]);
}

function bed(f, ox, oz, facing) {
  // The head is one step from the foot in the facing direction (as rules.js places beds).
  const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][facing];
  f.set(ox, 1, oz, DECOR.bed.foot[f.face(facing)]);
  f.set(ox + dx, 1, oz + dz, DECOR.bed.head[f.face(facing)]);
}

// Walls of a hollow box from dy 1 to `top`, with logs at the corners.
function walls(f, r, top, s, rd = r) {
  for (let dy = 1; dy <= top; dy++)
    for (let ox = -r; ox <= r; ox++)
      for (let oz = -rd; oz <= rd; oz++) {
        const edgeX = Math.abs(ox) === r, edgeZ = Math.abs(oz) === rd;
        if (!edgeX && !edgeZ) continue;
        f.set(ox, dy, oz, edgeX && edgeZ ? s.corner : s.wall);
      }
}

function roof(f, r, dy, s, rd = r) {
  for (let k = 0; ; k++) {
    const a = r - k, b = rd - k;
    if (a < 0 || b < 0) break;
    for (let ox = -a; ox <= a; ox++) for (let oz = -b; oz <= b; oz++) f.set(ox, dy + k, oz, s.roof);
    if (!s.steps) break;
  }
}

// ------------------------------------------------------------ builders

const HOUSES = {
  // 5x5 hut: bed, crafting table, torch.
  small: {
    hw: 2, hd: 2,
    build(ctx, p) {
      const f = frame(ctx, p), s = p.style;
      base(f, -2, -2, 2, 2, s.floor, 6);
      walls(f, 2, 3, s);
      roof(f, 2, 4, s);
      door(f, 0, -2, 0);
      for (const [ox, oz] of [[-2, 0], [2, 0], [0, 2]]) f.set(ox, 2, oz, B.glass);
      bed(f, -1, 0, 2);
      f.set(1, 1, 1, B.crafting_table);
      f.set(1, 1, -1, B.torch);
    },
  },
  // 7x7 house: two beds, bookshelves, furnace, a potted flower, torches, windows.
  big: {
    hw: 3, hd: 3,
    build(ctx, p) {
      const f = frame(ctx, p), s = p.style;
      base(f, -3, -3, 3, 3, s.floor, 8);
      walls(f, 3, 4, s);
      roof(f, 3, 5, s);
      door(f, 0, -3, 0);
      for (const [ox, oz] of [[-3, -1], [-3, 1], [3, -1], [3, 1], [-1, 3], [1, 3]]) {
        f.set(ox, 2, oz, B.glass);
        f.set(ox, 3, oz, B.glass);
      }
      bed(f, -2, 1, 2);
      bed(f, -1, 1, 2);
      f.set(2, 1, 2, B.bookshelf);
      f.set(2, 2, 2, B.bookshelf);
      f.set(1, 1, 2, B.bookshelf);
      f.set(2, 1, 0, B.furnace);
      f.set(-2, 1, -2, DECOR.pot.byPlant.get(B.poppy));
      f.set(2, 1, -2, B.torch);
      f.set(-2, 1, 0, B.torch);
    },
  },
  // 7x5 garden: a log frame round dirt with flowers and a water channel.
  garden: {
    hw: 3, hd: 2,
    build(ctx, p) {
      const f = frame(ctx, p), s = p.style;
      base(f, -3, -2, 3, 2, B.dirt, 3);
      const desert = s === STYLES.desert;
      const plants = desert ? [B.dead_bush, B.cactus, B.dead_bush] : [B.tall_grass, B.dandelion, B.poppy, B.fern, B.cornflower];
      for (let ox = -3; ox <= 3; ox++)
        for (let oz = -2; oz <= 2; oz++) {
          const edge = Math.abs(ox) === 3 || Math.abs(oz) === 2;
          if (edge) f.set(ox, 0, oz, s.corner);
          else if (oz === 0) f.set(ox, 0, oz, B.water);
          else {
            f.set(ox, 0, oz, desert ? B.sand : B.dirt);
            f.set(ox, 1, oz, plants[(ox + 3 + (oz + 2) * 7) % plants.length]);
          }
        }
      f.set(-3, 1, -2, B.torch);
      f.set(3, 1, -2, B.torch);
    },
  },
};

// Village centre: a covered well, 4x4 with 2x2 water three deep.
function buildVillageWell(ctx, p) {
  const f = frame(ctx, p), s = p.style;
  base(f, -2, -2, 1, 1, s.well, 5);
  for (let ox = -1; ox <= 0; ox++)
    for (let oz = -1; oz <= 0; oz++) {
      for (let dy = 0; dy >= -2; dy--) f.set(ox, dy, oz, B.water);
      f.set(ox, -3, oz, s.well);
    }
  for (let dy = -3; dy <= -1; dy++)
    for (let ox = -2; ox <= 1; ox++)
      for (let oz = -2; oz <= 1; oz++) if (ox === -2 || ox === 1 || oz === -2 || oz === 1) f.set(ox, dy, oz, s.well);
  for (const [ox, oz] of [[-2, -2], [1, -2], [-2, 1], [1, 1]]) {
    f.set(ox, 1, oz, s.post);
    f.set(ox, 2, oz, s.post);
  }
  for (let ox = -2; ox <= 1; ox++) for (let oz = -2; oz <= 1; oz++) f.set(ox, 3, oz, s.well);
  f.set(-2, 4, -2, B.torch);
  f.set(1, 4, 1, B.torch);
}

// Desert well: a 5x5 sandstone basin with water in the middle and a small roof on posts.
function buildDesertWell(ctx, p) {
  const f = frame(ctx, p);
  base(f, -2, -2, 2, 2, B.sandstone, 5);
  f.set(0, 0, 0, B.water);
  f.set(0, -1, 0, B.water);
  f.set(0, -2, 0, B.sandstone);
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    f.set(ox, 1, oz, B.sandstone);
    f.set(ox, 2, oz, B.sandstone);
  }
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) f.set(ox, 3, oz, B.sandstone);
}

// Desert pyramid: a stepped sandstone pyramid, 21 blocks square, with an entrance, a wool
// floor pattern, and under its centre a hidden room reached by a ladder, with TNT under it.
function buildPyramid(ctx, p) {
  const f = frame(ctx, p);
  base(f, -10, -10, 10, 10, B.sandstone, 13);
  for (let k = 1; k <= 10; k++) {
    const r = 10 - k;
    for (let ox = -r; ox <= r; ox++)
      for (let oz = -r; oz <= r; oz++) {
        const shell = Math.abs(ox) === r || Math.abs(oz) === r || k === 10;
        if (shell) f.set(ox, k, oz, k === 5 && Math.abs(ox) !== r && oz === -r ? B.orange_wool : B.sandstone);
      }
  }
  // Entrance through the front (-Z) steps.
  for (let oz = -10; oz <= -6; oz++) for (let ox = -1; ox <= 1; ox++) for (let dy = 1; dy <= 3; dy++) f.set(ox, dy, oz, 0);
  for (let ox = -2; ox <= 2; ox++) f.set(ox, 4, -6, B.orange_wool);
  // Floor pattern.
  for (let ox = -4; ox <= 4; ox++)
    for (let oz = -4; oz <= 4; oz++) {
      const d = Math.abs(ox) + Math.abs(oz);
      if (d <= 4) f.set(ox, 0, oz, d === 0 ? B.blue_wool : d % 2 ? B.orange_wool : B.sandstone);
    }
  for (const [ox, oz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) f.set(ox, 1, oz, B.torch);
  // Shaft under the blue centre block, down to the hidden room.
  for (let dy = -1; dy >= -9; dy--) { // fill with sand
    for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) f.set(ox, dy, oz, B.sand);
  }

  for (let dy = -14; dy <= -10; dy++)
    for (let ox = -4; ox <= 4; ox++)
      for (let oz = -4; oz <= 4; oz++) {
        const wall = Math.abs(ox) === 4 || Math.abs(oz) === 4 || dy === -14 || dy === -10;
        f.set(ox, dy, oz, wall ? B.sandstone : 0);
      }

  for (let dy = -1; dy >= -10; dy--) { // make a hole
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) f.set(ox, dy, oz, 0);
  }

  for (const [ox, oz, id] of [[-3, -3, B.gold_block], [3, -3, B.diamond_block], [-3, 3, B.diamond_block], [3, 3, B.gold_block]]) {
    f.set(ox, -13, oz, id);
    f.set(ox, -12, oz, B.torch);
  }
  // The trap: TNT under the middle of the room's floor.
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) f.set(ox, -15, oz, B.tnt);
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) f.set(ox, -13, oz, DECOR.plate[0][0]);
  f.set(0, -13, 0, 0); // stone pressure plates except in the center, so you need to land there to be safe, exact opposite of minecraft
}
