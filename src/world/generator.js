// Deterministic terrain generation. Pure functions of (seed, chunk coords) so it can run in a worker.

import { Noise, mulberry32, hash3i, hash3 } from '../noise.js';
import { WORLD_HEIGHT as H, SEA_LEVEL as SEA, CHUNK_VOLUME, blockIndex } from '../constants.js';
import { B } from '../blocks.js';
import { smoothstep, clamp } from '../math.js';

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, TAIGA: 5, SNOWY: 6, MOUNTAINS: 7, RIVER: 8 };
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Taiga', 'Snowy Tundra', 'Mountains', 'River'];

const CONT_SPLINE = [[-1, 30], [-0.45, 38], [-0.22, 50], [-0.1, 59], [-0.02, 63], [0.12, 66], [0.4, 72], [1, 80]];

function spline(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x < points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

const LOGS = new Set([B.oak_log, B.birch_log, B.spruce_log, B.cactus]);
const CARVABLE = new Uint8Array(256);
for (const id of [B.stone, B.dirt, B.grass, B.snowy_grass, B.sand, B.sandstone, B.gravel, B.coal_ore, B.iron_ore, B.clay]) CARVABLE[id] = 1;
const PLANTS = new Uint8Array(256);
for (const id of [B.tall_grass, B.fern, B.dandelion, B.poppy, B.cornflower, B.dead_bush, B.red_mushroom, B.brown_mushroom, B.sugar_cane]) PLANTS[id] = 1;

const CAVE_STEP = 4;

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const s = this.seed;
    this.nCont = new Noise(s ^ 0x1a2b3c);
    this.nHills = new Noise(s ^ 0x2b3c4d);
    this.nMount = new Noise(s ^ 0x3c4d5e);
    this.nRidge = new Noise(s ^ 0x4d5e6f);
    this.nTemp = new Noise(s ^ 0x5e6f70);
    this.nHum = new Noise(s ^ 0x6f7081);
    this.nRiver = new Noise(s ^ 0x708192);
    this.nDetail = new Noise(s ^ 0x8192a3);
    this.nWarp = new Noise(s ^ 0x92a3b4);
    this.nCave1 = new Noise(s ^ 0xa3b4c5);
    this.nCave2 = new Noise(s ^ 0xb4c5d6);
    this.nCave3 = new Noise(s ^ 0xc5d6e7);
    this.tmp = { h: 0, biome: 0, temp: 0, river: 0, cont: 0 };
  }

  // Height and biome of a single world column.
  column(x, z, out = this.tmp) {
    const wx = x + this.nWarp.noise2(x / 240, z / 240) * 36;
    const wz = z + this.nWarp.noise2(x / 240 + 71.3, z / 240 - 13.7) * 36;

    const cont = this.nCont.fbm2(wx / 1100, wz / 1100, 4) * 1.4 + 0.2;
    let h = spline(CONT_SPLINE, cont);
    const land = smoothstep(-0.1, 0.12, cont);

    h += this.nHills.fbm2(wx / 240, wz / 240, 4) * (3 + 9 * land);

    const m = this.nMount.fbm2(wx / 760, wz / 760, 3);
    const mountain = smoothstep(0.1, 0.42, m) * land;
    if (mountain > 0) {
      const r = 1 - Math.abs(this.nRidge.fbm2(wx / 190, wz / 190, 4));
      h += mountain * (r * r * 92 + 8);
    }
    h += this.nDetail.noise2(x / 26, z / 26) * 1.2;

    // Rivers follow the zero-crossings of a low frequency noise.
    const rv = Math.abs(this.nRiver.fbm2(wx / 560, wz / 560, 3));
    let river = (1 - smoothstep(0.0, 0.05, rv)) * smoothstep(0.0, 0.3, land) * (1 - mountain * 0.75);
    if (river > 0) {
      const target = SEA - 3;
      if (h > target) h -= (h - target) * Math.min(1, river * 1.35);
    }

    h = Math.floor(clamp(h, 4, H - 24));

    let temp = this.nTemp.fbm2(x / 850, z / 850, 3) + this.nDetail.noise2(x / 60, z / 60) * 0.03;
    const hum = this.nHum.fbm2(x / 700, z / 700, 3);
    temp -= Math.max(0, h - 96) / 75;

    let biome;
    if (h < SEA) biome = river > 0.35 && cont > -0.05 ? BIOME.RIVER : BIOME.OCEAN;
    else if (h <= SEA + 2 && cont < 0.02 && mountain < 0.1) biome = BIOME.BEACH;
    else if (mountain > 0.3 && h > 92) biome = BIOME.MOUNTAINS;
    else if (temp > 0.26 && hum < 0.08) biome = BIOME.DESERT;
    else if (temp < -0.28) biome = BIOME.SNOWY;
    else if (temp < -0.06 && hum > -0.2) biome = BIOME.TAIGA;
    else if (hum > 0.06) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;

    out.h = h;
    out.biome = biome;
    out.temp = temp;
    out.river = river;
    out.cont = cont;
    return out;
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const heights = new Int16Array(256);
    const biomes = new Uint8Array(256);
    const temps = new Float32Array(256);
    const x0 = cx * 16, z0 = cz * 16;
    const col = { h: 0, biome: 0, temp: 0, river: 0, cont: 0 };
    let maxH = SEA;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        this.column(x0 + lx, z0 + lz, col);
        const i = lx + lz * 16;
        heights[i] = col.h;
        biomes[i] = col.biome;
        temps[i] = col.temp;
        if (col.h > maxH) maxH = col.h;
      }

    // Cave noise on a coarse grid, trilinearly interpolated.
    const GX = 16 / CAVE_STEP + 1;
    const GY = Math.ceil((maxH + 2) / CAVE_STEP) + 1;
    const g1 = new Float32Array(GX * GX * GY);
    const g2 = new Float32Array(GX * GX * GY);
    const g3 = new Float32Array(GX * GX * GY);
    for (let gy = 0; gy < GY; gy++)
      for (let gz = 0; gz < GX; gz++)
        for (let gx = 0; gx < GX; gx++) {
          const wx = x0 + gx * CAVE_STEP, wy = gy * CAVE_STEP, wz = z0 + gz * CAVE_STEP;
          const gi = gx + gz * GX + gy * GX * GX;
          g1[gi] = this.nCave1.noise3(wx / 52, wy / 30, wz / 52);
          g2[gi] = this.nCave2.noise3(wx / 52, wy / 30, wz / 52);
          g3[gi] = this.nCave3.noise3(wx / 90, wy / 42, wz / 90);
        }
    const sample = (g, x, y, z) => {
      const fx = x / CAVE_STEP, fy = y / CAVE_STEP, fz = z / CAVE_STEP;
      const ix = Math.min(fx | 0, GX - 2), iy = Math.min(fy | 0, GY - 2), iz = Math.min(fz | 0, GX - 2);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const i000 = ix + iz * GX + iy * GX * GX;
      const sy = GX * GX, sz = GX;
      const c00 = g[i000] + (g[i000 + 1] - g[i000]) * tx;
      const c10 = g[i000 + sz] + (g[i000 + sz + 1] - g[i000 + sz]) * tx;
      const c01 = g[i000 + sy] + (g[i000 + sy + 1] - g[i000 + sy]) * tx;
      const c11 = g[i000 + sy + sz] + (g[i000 + sy + sz + 1] - g[i000 + sy + sz]) * tx;
      const c0 = c00 + (c10 - c00) * tz;
      const c1 = c01 + (c11 - c01) * tz;
      return c0 + (c1 - c0) * ty;
    };

    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const ci = lx + lz * 16;
        const h = heights[ci];
        const biome = biomes[ci];
        const wx = x0 + lx, wz = z0 + lz;
        const underwater = h < SEA;
        let top = B.grass, filler = B.dirt, fillerDepth = 3, deep = B.stone;
        switch (biome) {
          case BIOME.OCEAN:
            top = h < SEA - 7 ? (hash3(this.seed, wx, 2, wz) < 0.5 ? B.gravel : B.sand) : B.sand;
            filler = B.sand;
            break;
          case BIOME.RIVER: {
            const r = hash3(this.seed, wx, 3, wz);
            top = r < 0.15 ? B.clay : r < 0.4 ? B.gravel : B.sand;
            filler = B.dirt;
            break;
          }
          case BIOME.BEACH:
            top = B.sand;
            filler = B.sand;
            fillerDepth = 4;
            break;
          case BIOME.DESERT:
            top = B.sand;
            filler = B.sand;
            fillerDepth = 4;
            deep = B.sandstone;
            break;
          case BIOME.SNOWY:
            top = B.snowy_grass;
            break;
          case BIOME.MOUNTAINS:
            if (h > 136 + this.nDetail.noise2(wx / 11, wz / 11) * 6) { top = B.snow; filler = B.stone; }
            else if (h > 112 && this.nDetail.noise2(wx / 9, wz / 9) > -0.1) { top = B.stone; filler = B.stone; }
            else if (temps[ci] < -0.2) top = B.snowy_grass;
            break;
        }
        if (underwater && (top === B.grass || top === B.snowy_grass)) top = B.dirt;

        const colTop = Math.max(h, SEA);
        for (let y = 0; y <= colTop; y++) {
          let b;
          if (y === 0) b = B.bedrock;
          else if (y < 4 && hash3(this.seed, wx, y, wz) < (4 - y) / 4) b = B.bedrock;
          else if (y <= h) {
            const depth = h - y;
            if (depth === 0) b = top;
            else if (depth <= fillerDepth) b = filler;
            else if (deep === B.sandstone && depth <= fillerDepth + 4) b = B.sandstone;
            else b = B.stone;
          } else {
            b = B.water;
            if (y === SEA && temps[ci] < -0.3) b = B.ice;
          }
          blocks[blockIndex(lx, y, lz)] = b;
        }

        // Carve caves. Keep a seal below water so oceans don't drain into caverns.
        const carveTop = underwater || h <= SEA + 1 ? h - 7 : h;
        for (let y = 4; y <= carveTop; y++) {
          const idx = blockIndex(lx, y, lz);
          if (!CARVABLE[blocks[idx]]) continue;
          const n1 = sample(g1, lx, y, lz);
          const n2 = sample(g2, lx, y, lz);
          const nearSurface = y > h - 6;
          const tube = n1 * n1 + n2 * n2 < (nearSurface ? 0.005 : 0.0105);
          let cheese = false;
          if (!tube && y < 48) cheese = sample(g3, lx, y, lz) > 0.58 + (48 - y) * -0.002;
          if (tube || cheese) blocks[idx] = y <= 10 ? B.lava : 0;
        }
        // Grass under a carved gap becomes exposed dirt; fine. Fix floating plants/sand later.
      }

    this.placeOres(cx, cz, blocks);
    this.placePlants(cx, cz, blocks, heights, biomes);
    this.placeTrees(cx, cz, blocks);

    return { blocks, heights, biomes };
  }

  placeOres(cx, cz, blocks) {
    const rng = mulberry32(hash3i(this.seed, cx, 7, cz));
    const ORES = [
      [B.coal_ore, 24, 5, 150, 10],
      [B.iron_ore, 14, 5, 64, 7],
      [B.gold_ore, 3, 5, 32, 7],
      [B.diamond_ore, 2, 5, 16, 5],
      [B.gravel, 4, 5, 120, 16],
      [B.dirt, 4, 5, 120, 16],
    ];
    for (const [id, count, ymin, ymax, size] of ORES) {
      for (let i = 0; i < count; i++) {
        let x = rng() * 16, y = ymin + rng() * (ymax - ymin), z = rng() * 16;
        for (let k = 0; k < size; k++) {
          const ix = x | 0, iy = y | 0, iz = z | 0;
          if (ix >= 0 && ix < 16 && iz >= 0 && iz < 16 && iy > 0 && iy < H) {
            const idx = blockIndex(ix, iy, iz);
            if (blocks[idx] === B.stone) blocks[idx] = id;
          }
          x += rng() * 2 - 1;
          y += rng() * 2 - 1;
          z += rng() * 2 - 1;
        }
      }
    }
  }

  placePlants(cx, cz, blocks, heights, biomes) {
    const x0 = cx * 16, z0 = cz * 16;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const ci = lx + lz * 16;
        const h = heights[ci];
        if (h < SEA || h >= H - 5) continue;
        const ground = blocks[blockIndex(lx, h, lz)];
        if (blocks[blockIndex(lx, h + 1, lz)] !== 0) continue;
        const wx = x0 + lx, wz = z0 + lz;
        const r = hash3(this.seed, wx, 1, wz);
        const up = blockIndex(lx, h + 1, lz);
        const biome = biomes[ci];
        if (ground === B.grass) {
          // Flower patches: a low-frequency mask makes flowers cluster.
          const patch = this.nDetail.noise2(wx / 18, wz / 18);
          if (biome === BIOME.PLAINS) {
            if (r < 0.18) blocks[up] = B.tall_grass;
            else if (patch > 0.35 && r < 0.3) blocks[up] = patch > 0.55 ? B.poppy : r < 0.24 ? B.dandelion : B.cornflower;
          } else if (biome === BIOME.FOREST) {
            if (r < 0.07) blocks[up] = B.tall_grass;
            else if (r < 0.085) blocks[up] = B.fern;
            else if (r < 0.09) blocks[up] = B.red_mushroom;
            else if (r < 0.095) blocks[up] = B.brown_mushroom;
            else if (patch > 0.45 && r < 0.12) blocks[up] = B.poppy;
          } else if (biome === BIOME.TAIGA) {
            if (r < 0.07) blocks[up] = B.fern;
            else if (r < 0.12) blocks[up] = B.tall_grass;
            else if (r < 0.125) blocks[up] = B.brown_mushroom;
          } else if (r < 0.06) blocks[up] = B.tall_grass;
        } else if (ground === B.sand && biome === BIOME.DESERT) {
          if (r < 0.01) blocks[up] = B.dead_bush;
          else if (r < 0.018 && lx > 0 && lx < 15 && lz > 0 && lz < 15) {
            const tall = 1 + Math.floor(hash3(this.seed, wx, 5, wz) * 3);
            for (let k = 1; k <= tall; k++) blocks[blockIndex(lx, h + k, lz)] = B.cactus;
          }
        }
        // Sugar cane next to water.
        if ((ground === B.sand || ground === B.grass || ground === B.dirt) && h === SEA && r > 0.9 && lx > 0 && lx < 15 && lz > 0 && lz < 15) {
          const nearWater =
            blocks[blockIndex(lx + 1, h, lz)] === B.water ||
            blocks[blockIndex(lx - 1, h, lz)] === B.water ||
            blocks[blockIndex(lx, h, lz + 1)] === B.water ||
            blocks[blockIndex(lx, h, lz - 1)] === B.water;
          if (nearWater) {
            const tall = 1 + Math.floor(hash3(this.seed, wx, 6, wz) * 3);
            for (let k = 1; k <= tall; k++) blocks[blockIndex(lx, h + k, lz)] = B.sugar_cane;
          }
        }
      }
  }

  placeTrees(cx, cz, blocks) {
    const x0 = cx * 16, z0 = cz * 16;
    const put = (wx, y, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= H) return;
      const idx = blockIndex(lx, y, lz);
      const cur = blocks[idx];
      if (id === B.dirt) {
        if (cur === B.grass || cur === B.snowy_grass) blocks[idx] = B.dirt;
      } else if (LOGS.has(id)) {
        if (cur === 0 || PLANTS[cur] || cur === B.oak_leaves || cur === B.birch_leaves || cur === B.spruce_leaves) blocks[idx] = id;
      } else if (cur === 0 || PLANTS[cur]) blocks[idx] = id;
    };
    const col = { h: 0, biome: 0, temp: 0, river: 0, cont: 0 };
    for (let ncx = cx - 1; ncx <= cx + 1; ncx++)
      for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
        const rng = mulberry32(hash3i(this.seed, ncx, 99, ncz));
        for (let a = 0; a < 9; a++) {
          const lx = Math.floor(rng() * 16), lz = Math.floor(rng() * 16);
          const roll = rng(), variant = rng();
          const wx = ncx * 16 + lx, wz = ncz * 16 + lz;
          // Cheap reject: only evaluate the column if the roll could pass for the densest biome.
          if (roll > 0.8) continue;
          this.column(wx, wz, col);
          if (col.h < SEA || col.h > H - 20 || col.river > 0.25) continue;
          let density = 0, kind = 'oak';
          switch (col.biome) {
            case BIOME.FOREST: density = 0.8; kind = variant < 0.3 ? 'birch' : 'oak'; break;
            case BIOME.TAIGA: density = 0.55; kind = 'spruce'; break;
            case BIOME.SNOWY: density = 0.1; kind = 'spruce'; break;
            case BIOME.PLAINS: density = 0.035; kind = 'oak'; break;
            case BIOME.MOUNTAINS: density = col.h < 124 ? 0.12 : 0; kind = 'spruce'; break;
          }
          if (roll >= density) continue;
          const y = col.h + 1;
          put(wx, col.h, wz, B.dirt);
          if (kind === 'spruce') spruceTree(put, wx, y, wz, rng);
          else blobTree(put, wx, y, wz, rng, kind === 'birch' ? B.birch_log : B.oak_log, kind === 'birch' ? B.birch_leaves : B.oak_leaves, kind === 'birch' ? 5 : 4);
        }
      }
  }
}

function blobTree(put, x, y, z, rng, log, leaves, minHeight) {
  const h = minHeight + Math.floor(rng() * 3);
  for (let ly = y + h - 3; ly <= y + h; ly++) {
    const r = ly >= y + h - 1 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        const skip = rng() < 0.5;
        if (corner && (ly === y + h || skip)) continue;
        put(x + dx, ly, z + dz, leaves);
      }
  }
  for (let i = 0; i < h; i++) put(x, y + i, z, log);
}

function spruceTree(put, x, y, z, rng) {
  const h = 6 + Math.floor(rng() * 4);
  const top = y + h;
  put(x, top, z, B.spruce_leaves);
  const pattern = [1, 1, 2, 1, 2, 3, 2, 3, 2, 3];
  let i = 0;
  for (let ly = top - 1; ly >= y + 2; ly--, i++) {
    const r = pattern[Math.min(i, pattern.length - 1)];
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r + (r > 1 ? 1 : 0)) continue;
        put(x + dx, ly, z + dz, B.spruce_leaves);
      }
  }
  for (let k = 0; k < h; k++) put(x, y + k, z, B.spruce_log);
}
