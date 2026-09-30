// The server's copy of the world: terrain regenerated on demand from the seed (the same
// generator the browser runs), with every edit layered on top. No lighting or meshes.
// It offers the getBlock / setBlocks / isSolid surface that fluids.js and entities.js use.

import { TerrainGenerator, BIOME } from '../src/world/generator.js';
import { WORLD_HEIGHT as H, SEA_LEVEL, chunkKey } from '../src/constants.js';
import { B, SOLID, LIQUID, NEEDS_SUPPORT } from '../src/blocks.js';

const LEAVES = new Set([B.oak_leaves, B.birch_leaves, B.spruce_leaves]);
const LOGS = new Set([B.oak_log, B.birch_log, B.spruce_log, B.cactus]);

export class ServerWorld {
  constructor(seed, edits = new Map()) {
    this.seed = seed | 0;
    this.generator = new TerrainGenerator(this.seed);
    this.edits = edits; // chunkKey -> Map(index -> id): the persistent part of the world
    this.chunks = new Map(); // chunkKey -> { blocks, used }: a cache, rebuilt when needed
    this.changes = []; // x, y, z, id of every write since the last takeChanges()
    this.dirty = false;
    this.clock = 0;
  }

  chunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      const { blocks } = this.generator.generate(cx, cz);
      const m = this.edits.get(key);
      if (m) for (const [i, id] of m) blocks[i] = id;
      c = { key, blocks, used: 0 };
      this.chunks.set(key, c);
    }
    c.used = this.clock;
    return c;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= H) return 0;
    return this.chunk(x >> 4, z >> 4).blocks[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  isSolid(x, y, z) {
    if (y < 0) return true;
    if (y >= H) return false;
    return SOLID[this.getBlock(x, y, z)] === 1;
  }

  setBlock(x, y, z, id) {
    return this.setBlocks([[x, y, z, id]]) > 0;
  }

  // Same rules as the client's World.setBlocks, including plants and torches that lose
  // their support, so both sides end up with identical blocks.
  setBlocks(list) {
    let n = 0;
    for (const [x, y, z, id] of list) {
      if (y < 0 || y >= H) continue;
      const c = this.chunk(x >> 4, z >> 4);
      const i = (x & 15) | ((z & 15) << 4) | (y << 8);
      if (c.blocks[i] === id) continue;
      this.write(c, x, y, z, i, id);
      n++;
      let below = id;
      for (let yy = y + 1; yy < H; yy++) {
        const ii = (x & 15) | ((z & 15) << 4) | (yy << 8);
        const a = c.blocks[ii];
        if (!NEEDS_SUPPORT[a]) break;
        if (SOLID[below] || (below === a && a === B.sugar_cane)) break;
        this.write(c, x, yy, z, ii, 0);
        n++;
        below = 0;
      }
    }
    return n;
  }

  write(c, x, y, z, i, id) {
    c.blocks[i] = id;
    let m = this.edits.get(c.key);
    if (!m) this.edits.set(c.key, (m = new Map()));
    m.set(i, id);
    this.changes.push(x, y, z, id);
    this.dirty = true;
  }

  takeChanges() {
    const c = this.changes;
    this.changes = [];
    return c;
  }

  // Forget cached terrain nobody has touched for a while (edits are kept separately).
  evict(keep, maxIdleSeconds) {
    for (const [key, c] of this.chunks) if (!keep.has(key) && this.clock - c.used > maxIdleSeconds) this.chunks.delete(key);
  }

  // A dry spot near the origin to stand on, like singleplayer's spawn search.
  findSpawn() {
    const col = { h: 0, biome: 0 };
    let sx = 0, sz = 0;
    search: for (let r = 0; r < 4000; r += 24) {
      const steps = Math.max(1, Math.floor((r * Math.PI * 2) / 24));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        this.generator.column(x, z, col);
        if (col.h > SEA_LEVEL + 1 && col.h < 90 && col.biome !== BIOME.OCEAN && col.biome !== BIOME.RIVER && col.biome !== BIOME.BEACH) {
          sx = x;
          sz = z;
          break search;
        }
      }
    }
    for (let r = 0; r <= 8; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = sx + dx, z = sz + dz;
          for (let y = H - 2; y > 0; y--) {
            const b = this.getBlock(x, y, z);
            if (b === 0 || (!SOLID[b] && !LIQUID[b])) continue;
            if (SOLID[b] && !LEAVES.has(b) && !LOGS.has(b)) return [x + 0.5, y + 1, z + 0.5];
            break;
          }
        }
    return [sx + 0.5, SEA_LEVEL + 20, sz + 0.5];
  }
}
