// Chunk streaming, block access and edits. Generation runs in a worker pool;
// lighting and meshing run on the main thread under a per-frame time budget.

import { WORLD_HEIGHT as H, SEA_LEVEL, chunkKey } from '../constants.js';
import { B, SOLID, LIQUID, NEEDS_SUPPORT } from '../blocks.js';
import { Chunk } from './chunk.js';
import { LightEngine } from './lighting.js';
import { buildChunkMesh } from './mesher.js';
import { TerrainGenerator, BIOME } from './generator.js';

export class World {
  constructor(seed, { edits, onMeshed, onUnloaded } = {}) {
    this.seed = seed | 0;
    this.chunks = new Map();
    this.edits = edits || new Map(); // chunkKey -> Map(index -> block id)
    this.editsDirty = false;
    this.light = new LightEngine(this);
    this.generator = new TerrainGenerator(this.seed);
    this.renderDistance = 8;
    this.onMeshed = onMeshed || (() => {});
    this.onUnloaded = onUnloaded || (() => {});
    this.pending = new Set();
    this.arrived = [];
    this.wanted = [];
    this.wantedIndex = 0;
    this.center = null;
    this.stats = { generated: 0, meshed: 0, lastMeshMs: 0 };
    this.initWorkers();
  }

  initWorkers() {
    this.workers = [];
    this.useFallback = false;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        w.job = null;
        w.onmessage = (e) => {
          w.job = null;
          this.arrived.push(e.data);
        };
        w.onerror = (e) => {
          console.warn('Terrain worker failed; generating on the main thread instead.', e.message || e);
          this.disableWorkers();
        };
        this.workers.push(w);
      }
    } catch (err) {
      console.warn('Module workers unavailable; generating on the main thread.', err);
      this.disableWorkers();
    }
  }

  disableWorkers() {
    for (const w of this.workers) {
      if (w.job !== null) this.pending.delete(w.job);
      w.terminate();
    }
    this.workers = [];
    this.useFallback = true;
    this.center = null; // rebuild the wanted list so dropped jobs get re-requested
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const c of this.chunks.values()) this.onUnloaded(c);
    this.chunks.clear();
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  isReady(cx, cz) {
    const c = this.chunks.get(chunkKey(cx, cz));
    return !!(c && c.ready);
  }

  markDirty(cx, cz) {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) c.meshDirty = true;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.ready) return 0;
    return c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  // For physics: unloaded chunks count as solid so the player can't fall into the void.
  isSolid(x, y, z) {
    if (y < 0) return true;
    if (y >= H) return false;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.ready) return true;
    return SOLID[c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)]] === 1;
  }

  getLight(x, y, z) {
    if (y >= H) return 0xf0;
    if (y < 0) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.ready) return 0xf0;
    return c.light[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  getBiome(x, z) {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.biomes) return -1;
    return c.biomes[(x & 15) | ((z & 15) << 4)];
  }

  // Change a block, update lighting and dependants. Returns true if something changed.
  setBlock(x, y, z, id) {
    return this.setBlocks([[x, y, z, id]]) > 0;
  }

  setBlocks(list) {
    const changes = [];
    for (const [x, y, z, id] of list) {
      if (y < 0 || y >= H) continue;
      const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
      if (!c || !c.ready) continue;
      const i = (x & 15) | ((z & 15) << 4) | (y << 8);
      if (c.blocks[i] === id) continue;
      this.writeBlock(c, x, y, z, i, id, changes);
      // Plants, torches etc. above lose their support.
      let below = id;
      for (let yy = y + 1; yy < H; yy++) {
        const ii = (x & 15) | ((z & 15) << 4) | (yy << 8);
        const a = c.blocks[ii];
        if (!NEEDS_SUPPORT[a]) break;
        if (SOLID[below] || (below === a && a === B.sugar_cane)) break;
        this.writeBlock(c, x, yy, z, ii, 0, changes);
        below = 0;
      }
    }
    if (changes.length) this.light.update(changes);
    return changes.length / 3;
  }

  writeBlock(c, x, y, z, i, id, changes) {
    c.blocks[i] = id;
    if (id !== 0 && y > c.maxY) c.maxY = y;
    let m = this.edits.get(c.key);
    if (!m) this.edits.set(c.key, (m = new Map()));
    m.set(i, id);
    this.editsDirty = true;
    c.meshDirty = true;
    const lx = x & 15, lz = z & 15;
    const ex = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const ez = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (ex) this.markDirty(c.cx + ex, c.cz);
    if (ez) this.markDirty(c.cx, c.cz + ez);
    if (ex && ez) this.markDirty(c.cx + ex, c.cz + ez);
    changes.push(x, y, z);
  }

  // ------------------------------------------------------------------ streaming

  rebuildWanted(pcx, pcz) {
    const r = this.renderDistance + 1.5;
    const ri = Math.ceil(r);
    const list = [];
    for (let dz = -ri; dz <= ri; dz++)
      for (let dx = -ri; dx <= ri; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        list.push([d2, pcx + dx, pcz + dz]);
      }
    list.sort((a, b) => a[0] - b[0]);
    this.wanted = list;
    this.wantedIndex = 0;
    this.center = [pcx, pcz];
  }

  nextWanted() {
    while (this.wantedIndex < this.wanted.length) {
      const [, cx, cz] = this.wanted[this.wantedIndex++];
      const key = chunkKey(cx, cz);
      if (this.chunks.has(key) || this.pending.has(key)) continue;
      return [cx, cz, key];
    }
    return null;
  }

  update(px, pz, budgetMs = 6) {
    const t0 = performance.now();
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    if (!this.center || this.center[0] !== pcx || this.center[1] !== pcz) {
      this.rebuildWanted(pcx, pcz);
      this.unloadFar(pcx, pcz);
    }

    // Dispatch generation jobs.
    for (const w of this.workers) {
      if (w.job !== null) continue;
      const next = this.nextWanted();
      if (!next) break;
      const [cx, cz, key] = next;
      w.job = key;
      this.pending.add(key);
      w.postMessage({ seed: this.seed, cx, cz });
    }
    if (this.useFallback) {
      for (let n = 0; n < 2; n++) {
        const next = this.nextWanted();
        if (!next) break;
        const [cx, cz] = next;
        const r = this.generator.generate(cx, cz);
        this.arrived.push({ cx, cz, blocks: r.blocks, biomes: r.biomes });
        if (performance.now() - t0 > budgetMs * 0.5) break;
      }
    }

    // Integrate generated chunks (lighting) within budget.
    while (this.arrived.length && (performance.now() - t0 < budgetMs * 0.5 || this.chunks.size < 9)) {
      this.addChunk(this.arrived.shift(), pcx, pcz);
    }

    this.buildMeshes(px, pz, t0 + budgetMs);
  }

  addChunk(data, pcx, pcz) {
    const { cx, cz } = data;
    const key = chunkKey(cx, cz);
    this.pending.delete(key);
    if (this.chunks.has(key)) return;
    const lim = this.renderDistance + 2.5;
    if ((cx - pcx) ** 2 + (cz - pcz) ** 2 > lim * lim) return;
    const c = new Chunk(cx, cz, data.blocks, data.biomes);
    const edits = this.edits.get(key);
    if (edits) {
      for (const [i, id] of edits) c.blocks[i] = id;
      c.updateMaxY();
    }
    this.chunks.set(key, c);
    this.light.initChunk(c);
    this.stats.generated++;
  }

  neighborsReady(c) {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
        if (!n || !n.ready) return false;
      }
    return true;
  }

  buildMeshes(px, pz, deadline) {
    const r = this.renderDistance + 0.5;
    const pcx = px / 16 - 0.5, pcz = pz / 16 - 0.5;
    const candidates = [];
    for (const c of this.chunks.values()) {
      if (!c.meshDirty || !c.ready) continue;
      const d2 = (c.cx - pcx) ** 2 + (c.cz - pcz) ** 2;
      if (d2 > r * r) continue;
      candidates.push([d2, c]);
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => a[0] - b[0]);
    let built = 0;
    for (const [, c] of candidates) {
      if (built > 0 && performance.now() > deadline) break;
      if (!this.neighborsReady(c)) continue;
      const t = performance.now();
      const mesh = buildChunkMesh(this, c);
      c.meshDirty = false;
      this.onMeshed(c, mesh);
      this.stats.lastMeshMs = performance.now() - t;
      this.stats.meshed++;
      built++;
    }
  }

  // Rebuild dirty meshes close to a point immediately (used right after the player edits blocks).
  flushNear(x, z) {
    const cx = x >> 4, cz = z >> 4;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (c && c.ready && c.meshDirty && this.neighborsReady(c)) {
          const mesh = buildChunkMesh(this, c);
          c.meshDirty = false;
          this.onMeshed(c, mesh);
        }
      }
  }

  unloadFar(pcx, pcz) {
    const lim = this.renderDistance + 3;
    for (const c of [...this.chunks.values()]) {
      if ((c.cx - pcx) ** 2 + (c.cz - pcz) ** 2 > lim * lim) {
        this.onUnloaded(c);
        this.chunks.delete(c.key);
      }
    }
  }

  setRenderDistance(r) {
    this.renderDistance = r;
    this.center = null;
  }

  loadedAround(px, pz, radius = 1) {
    const cx = Math.floor(px / 16), cz = Math.floor(pz / 16);
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) if (!this.isReady(cx + dx, cz + dz)) return false;
    return true;
  }

  // ------------------------------------------------------------------ spawning

  findSpawnColumn() {
    const col = { h: 0, biome: 0 };
    for (let r = 0; r < 4000; r += 24) {
      const steps = Math.max(1, Math.floor((r * Math.PI * 2) / 24));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        this.generator.column(x, z, col);
        if (col.h > SEA_LEVEL + 1 && col.h < 90 && col.biome !== BIOME.OCEAN && col.biome !== BIOME.RIVER && col.biome !== BIOME.BEACH)
          return { x: x + 0.5, z: z + 0.5 };
      }
    }
    return { x: 0.5, z: 0.5 };
  }

  // Highest position where a player can stand in the given column (chunk must be loaded).
  surfaceY(x, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let y = H - 2; y > 0; y--) {
      const b = this.getBlock(bx, y, bz);
      if (b !== 0 && (SOLID[b] || LIQUID[b])) return y + 1;
    }
    return SEA_LEVEL + 1;
  }

  // Serialise edits: { "cx,cz": [index, id, index, id, ...] }
  serializeEdits() {
    const out = {};
    for (const [key, m] of this.edits) {
      if (!m.size) continue;
      const cx = Math.floor(key / 65536) - 32768, cz = (key % 65536) - 32768;
      const arr = [];
      for (const [i, id] of m) arr.push(i, id);
      out[`${cx},${cz}`] = arr;
    }
    return out;
  }

  static deserializeEdits(obj) {
    const edits = new Map();
    if (!obj) return edits;
    for (const k of Object.keys(obj)) {
      const [cx, cz] = k.split(',').map(Number);
      const arr = obj[k];
      const m = new Map();
      for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
      edits.set(chunkKey(cx, cz), m);
    }
    return edits;
  }
}
