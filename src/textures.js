// Procedural 16x16 pixel-art textures. Every texture is painted from code, no image assets.

import { mulberry32, hashString } from './noise.js';
import { WOOL_COLORS } from './blocks.js';

export const TEX_SIZE = 16;

class Canvas16 {
  constructor(name) {
    this.data = new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4);
    this.rand = mulberry32(hashString(name));
  }
  rnd(n) {
    return Math.floor(this.rand() * n);
  }
  pick(arr) {
    return arr[this.rnd(arr.length)];
  }
  set(x, y, c, a = c[3] ?? 255) {
    const i = (((y & 15) << 4) | (x & 15)) * 4;
    const d = this.data;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = a;
  }
  get(x, y) {
    const i = (((y & 15) << 4) | (x & 15)) * 4;
    const d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }
  mul(x, y, f) {
    const i = (((y & 15) << 4) | (x & 15)) * 4;
    const d = this.data;
    d[i] *= f;
    d[i + 1] *= f;
    d[i + 2] *= f;
  }
  // Fill every pixel with base color scaled by random factor.
  speckle(base, amount, alpha = 255) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const f = 1 + (this.rand() - 0.5) * amount;
        this.set(x, y, [base[0] * f, base[1] * f, base[2] * f], alpha);
      }
  }
  clear() {
    this.data.fill(0);
  }
}

const scale = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const torusDist = (ax, ay, bx, by) => {
  let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  dx = Math.min(dx, 16 - dx);
  dy = Math.min(dy, 16 - dy);
  return Math.hypot(dx, dy);
};

const GRASS = [[95, 159, 53], [88, 148, 48], [104, 170, 58], [80, 138, 44], [112, 178, 64], [99, 163, 55]];
const SNOW = [[242, 250, 252], [232, 242, 248], [250, 254, 255], [224, 236, 244]];

// ---------------------------------------------------------------- painters

function stone(t, base = [128, 128, 128]) {
  t.speckle(base, 0.16);
  for (let i = 0; i < 9; i++) {
    const x = t.rnd(16), y = t.rnd(16), len = 1 + t.rnd(3);
    for (let k = 0; k < len; k++) t.mul(x + k, y, 0.78);
  }
  for (let i = 0; i < 6; i++) t.mul(t.rnd(16), t.rnd(16), 1.14);
}

function dirt(t) {
  t.speckle([134, 96, 67], 0.2);
  for (let i = 0; i < 26; i++) t.set(t.rnd(16), t.rnd(16), t.pick([[108, 76, 52], [152, 112, 80], [94, 66, 45], [120, 86, 60]]));
}

function grassTop(t) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, scale(t.pick(GRASS), 0.95 + t.rand() * 0.1));
}

function sideTop(t, palette, base) {
  for (let x = 0; x < 16; x++) {
    let depth = 3 + (t.rand() < 0.5 ? 1 : 0) + (t.rand() < 0.25 ? 1 : 0);
    if (base) depth = Math.max(2, depth - 1);
    for (let y = 0; y < depth; y++) t.set(x, y, t.pick(palette));
  }
}

function cobble(t, base, mortar = [66, 66, 66]) {
  const pts = [];
  for (let i = 0; i < 11; i++) pts.push([t.rand() * 16, t.rand() * 16, 0.8 + t.rand() * 0.45]);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let d1 = 99, d2 = 99, n = 0;
      pts.forEach((p, i) => {
        const d = torusDist(x + 0.5, y + 0.5, p[0], p[1]);
        if (d < d1) { d2 = d1; d1 = d; n = i; } else if (d < d2) d2 = d;
      });
      if (d2 - d1 < 1.0) t.set(x, y, scale(mortar, 0.9 + t.rand() * 0.2));
      else {
        const f = pts[n][2] * (1 + (t.rand() - 0.5) * 0.14) - d1 * 0.025;
        t.set(x, y, scale(base, f));
      }
    }
}

function planks(t, base) {
  const rowTone = [];
  for (let y = 0; y < 16; y++) rowTone.push(0.94 + t.rand() * 0.12);
  for (let y = 0; y < 16; y++) {
    const plank = y >> 2;
    const seamX = (plank * 7 + 3) % 16;
    for (let x = 0; x < 16; x++) {
      let f = rowTone[y] * (1 + (t.rand() - 0.5) * 0.06);
      if (y % 4 === 3) f *= 0.68;
      else if (x === seamX) f *= 0.74;
      else if (y % 4 === 0) f *= 1.06;
      t.set(x, y, scale(base, f));
    }
  }
  for (let i = 0; i < 5; i++) {
    const y = t.rnd(16);
    if (y % 4 === 3) continue;
    const x = t.rnd(16);
    t.mul(x, y, 0.85);
    t.mul(x + 1, y, 0.85);
  }
}

function bark(t, base, dark) {
  const col = [];
  for (let x = 0; x < 16; x++) col.push(0.84 + t.rand() * 0.26);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) t.set(x, y, scale(base, col[x] * (1 + (t.rand() - 0.5) * 0.12)));
  for (let i = 0; i < 7; i++) {
    const x = t.rnd(16), y0 = t.rnd(16), len = 2 + t.rnd(6);
    for (let k = 0; k < len; k++) t.set(x, y0 + k, scale(dark, 0.9 + t.rand() * 0.2));
  }
}

function logTop(t, inner, ring, barkColor) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (x === 0 || y === 0 || x === 15 || y === 15) {
        t.set(x, y, scale(barkColor, 0.85 + t.rand() * 0.25));
        continue;
      }
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
      const d = 0.65 * Math.max(dx, dy) + 0.35 * Math.hypot(dx, dy);
      const c = Math.floor(d) % 2 === 0 ? inner : ring;
      t.set(x, y, scale(c, 0.95 + t.rand() * 0.1));
    }
}

function leaves(t, base, holes = 0.22) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (t.rand() < holes) t.set(x, y, scale(base, 0.8), 0);
      else t.set(x, y, scale(base, 0.72 + t.rand() * 0.5));
    }
}

function ore(t, colors) {
  stone(t);
  const clusters = 4 + t.rnd(2);
  for (let i = 0; i < clusters; i++) {
    const cx = 1 + t.rnd(13), cy = 1 + t.rnd(13);
    const shape = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 1], [1, 2]];
    const n = 3 + t.rnd(4);
    for (let k = 0; k < n; k++) {
      const [ox, oy] = shape[k];
      t.set(cx + ox, cy + oy, t.pick(colors));
    }
    t.set(cx, cy, scale(colors[0], 1.2));
  }
}

function bricks(t) {
  const mortar = [178, 170, 160];
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    const off = (row & 1) * 4;
    for (let x = 0; x < 16; x++) {
      const xx = (x + off) % 8;
      if (y % 4 === 3 || xx === 7) {
        t.set(x, y, scale(mortar, 0.9 + t.rand() * 0.15));
        continue;
      }
      const brickId = row * 4 + Math.floor((x + off) / 8);
      const tone = 0.85 + ((brickId * 37) % 11) / 40;
      let f = tone * (1 + (t.rand() - 0.5) * 0.12);
      if (y % 4 === 0) f *= 1.08;
      t.set(x, y, scale([150, 72, 56], f));
    }
  }
}

function stoneBricks(t) {
  for (let y = 0; y < 16; y++) {
    const row = y >> 3;
    for (let x = 0; x < 16; x++) {
      const xx = (x + row * 8) % 16;
      const yy = y % 8;
      let f = 1 + (t.rand() - 0.5) * 0.12;
      if (yy === 7 || xx === 15) f = 0.62;
      else if (yy === 0 || xx === 0) f *= 1.1;
      else if (yy === 6 || xx === 14) f *= 0.86;
      t.set(x, y, scale([124, 124, 124], f));
    }
  }
  for (let i = 0; i < 4; i++) t.mul(1 + t.rnd(13), 1 + t.rnd(13), 0.82);
}

function water(t) {
  const TAU = Math.PI * 2;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const w = Math.sin(TAU * (x / 16 + (2 * y) / 16)) * 0.5 + Math.sin(TAU * ((3 * x) / 16 - y / 16)) * 0.5;
      const f = 0.92 + w * 0.08 + (t.rand() - 0.5) * 0.06;
      t.set(x, y, scale([52, 98, 214], f), 175);
    }
}

function lava(t) {
  const TAU = Math.PI * 2;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const w = Math.sin(TAU * (x / 16 + y / 16)) + Math.sin(TAU * ((2 * x) / 16 - (3 * y) / 16)) + Math.cos(TAU * (y / 16) * 2);
      const v = w / 3 + (t.rand() - 0.5) * 0.3;
      let c = v > 0.35 ? [255, 196, 60] : v > -0.1 ? [230, 110, 24] : [190, 62, 14];
      t.set(x, y, scale(c, 0.95 + t.rand() * 0.1));
    }
}

function metal(t, base) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let f = 1 + (t.rand() - 0.5) * 0.05;
      if (x === 0 || y === 0) f *= 1.18;
      else if (x === 15 || y === 15) f *= 0.72;
      else if (x === 1 || y === 1) f *= 1.06;
      else if (x === 14 || y === 14) f *= 0.86;
      if ((x === 4 && y > 3 && y < 12) || (y === 4 && x > 3 && x < 12)) f *= 1.05;
      t.set(x, y, scale(base, f));
    }
}

function wool(t, base) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let f = 1 + (t.rand() - 0.5) * 0.1;
      if ((x + y) % 4 === 0) f *= 1.05;
      if ((x - y + 16) % 4 === 0) f *= 0.96;
      t.set(x, y, scale(base, f));
    }
}

function plantStem(t, x, top, color = [70, 130, 40]) {
  for (let y = top; y < 16; y++) t.set(x, y, scale(color, 0.9 + t.rand() * 0.2));
}

function flower(t, petal, center) {
  t.clear();
  plantStem(t, 7, 8);
  t.set(6, 12, [60, 120, 35]);
  t.set(5, 11, [70, 135, 40]);
  t.set(8, 13, [60, 120, 35]);
  t.set(9, 12, [70, 135, 40]);
  const shape = [
    '.XXX.',
    'XXXXX',
    'XXCXX',
    'XXXXX',
    '.XXX.',
  ];
  shape.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (ch === 'X') t.set(5 + dx, 3 + dy, scale(petal, 0.85 + t.rand() * 0.25));
      if (ch === 'C') t.set(5 + dx, 3 + dy, center);
    }),
  );
}

function drawPattern(t, x0, y0, rows, color) {
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch === '#' && t.set(x0 + dx, y0 + dy, color)));
}

// ---------------------------------------------------------------- registry

const PAINTERS = {
  stone: (t) => stone(t),
  dirt,
  grass_top: grassTop,
  grass_side: (t) => {
    dirt(t);
    sideTop(t, GRASS);
  },
  grass_snow_side: (t) => {
    dirt(t);
    sideTop(t, SNOW);
  },
  snow: (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, t.pick(SNOW));
  },
  cobblestone: (t) => cobble(t, [122, 122, 122]),
  mossy_cobblestone: (t) => {
    cobble(t, [118, 120, 116]);
    const centers = [];
    for (let i = 0; i < 6; i++) centers.push([t.rand() * 16, t.rand() * 16]);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.min(...centers.map((c) => torusDist(x, y, c[0], c[1])));
        if (d < 2.6 && t.rand() < 0.85) t.set(x, y, scale([78, 112, 48], 0.8 + t.rand() * 0.35));
      }
  },
  planks_oak: (t) => planks(t, [164, 132, 80]),
  planks_birch: (t) => planks(t, [200, 182, 126]),
  planks_spruce: (t) => planks(t, [118, 88, 52]),
  bedrock: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) t.set(x, y, t.pick([[86, 86, 86], [52, 52, 52], [120, 120, 120], [34, 34, 34], [70, 70, 70]]));
  },
  sand: (t) => {
    t.speckle([219, 207, 163], 0.08);
    for (let i = 0; i < 18; i++) t.set(t.rnd(16), t.rnd(16), t.pick([[198, 184, 140], [230, 220, 180], [205, 190, 150]]));
  },
  gravel: (t) => {
    t.speckle([128, 124, 122], 0.22);
    for (let i = 0; i < 16; i++) {
      const x = t.rnd(16), y = t.rnd(16);
      const c = t.pick([[156, 150, 146], [98, 94, 90], [142, 122, 110], [80, 78, 76], [170, 166, 160]]);
      t.set(x, y, c);
      t.set(x + 1, y, scale(c, 0.9));
      if (t.rand() < 0.6) t.set(x, y + 1, scale(c, 0.8));
    }
  },
  clay: (t) => t.speckle([160, 166, 180], 0.08),
  log_oak: (t) => bark(t, [106, 84, 52], [66, 52, 32]),
  log_oak_top: (t) => logTop(t, [168, 136, 82], [142, 112, 64], [106, 84, 52]),
  log_birch: (t) => {
    t.speckle([218, 216, 210], 0.08);
    for (let i = 0; i < 9; i++) {
      const y = t.rnd(16), x0 = t.rnd(16), len = 2 + t.rnd(3);
      for (let k = 0; k < len; k++) t.set(x0 + k, y, t.pick([[40, 40, 40], [60, 58, 55]]));
      if (t.rand() < 0.5) t.set(x0 + 1, y + 1, [70, 68, 64]);
    }
  },
  log_birch_top: (t) => logTop(t, [206, 190, 140], [186, 168, 118], [218, 216, 210]),
  log_spruce: (t) => bark(t, [62, 44, 24], [40, 28, 14]),
  log_spruce_top: (t) => logTop(t, [124, 92, 54], [98, 72, 40], [62, 44, 24]),
  leaves_oak: (t) => leaves(t, [62, 132, 34]),
  leaves_birch: (t) => leaves(t, [104, 150, 64]),
  leaves_spruce: (t) => leaves(t, [52, 90, 58], 0.14),
  glass: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        if (edge) t.set(x, y, scale([214, 238, 244], 0.92 + t.rand() * 0.08));
        else t.set(x, y, [205, 232, 240], 0);
      }
    for (const [x, y] of [[3, 6], [4, 5], [5, 4], [6, 3], [4, 7], [9, 12], [10, 11], [11, 10], [12, 9]]) t.set(x, y, [245, 252, 255]);
  },
  water,
  lava,
  ice: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let f = 0.95 + t.rand() * 0.08;
        if ((x + y * 2) % 11 === 0) f = 1.12;
        t.set(x, y, scale([150, 188, 250], f), 200);
      }
  },
  ore_coal: (t) => ore(t, [[34, 34, 34], [48, 48, 48], [22, 22, 22]]),
  ore_iron: (t) => ore(t, [[216, 175, 147], [196, 152, 124], [228, 192, 168]]),
  ore_gold: (t) => ore(t, [[252, 238, 75], [230, 200, 40], [255, 250, 150]]),
  ore_diamond: (t) => ore(t, [[93, 236, 245], [60, 200, 210], [180, 250, 255]]),
  bricks,
  stone_bricks: stoneBricks,
  cactus_side: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let f = 1 + (t.rand() - 0.5) * 0.1;
        if (x === 0 || x === 15) f *= 0.7;
        else if (x % 4 === 3) f *= 0.82;
        t.set(x, y, scale([86, 134, 42], f));
      }
    for (let y = 1; y < 16; y += 3)
      for (let x = 3; x < 16; x += 4) t.set(x, y + (x % 8 === 3 ? 0 : 1), [212, 220, 170]);
  },
  cactus_top: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let f = d > 6.5 ? 0.72 : d > 5 ? 0.9 : 1.05;
        if (x === 7 || y === 7 || x === 8 || y === 8) f *= 0.9;
        t.set(x, y, scale([96, 142, 48], f * (0.95 + t.rand() * 0.1)));
      }
  },
  cactus_bottom: (t) => {
    t.speckle([150, 170, 90], 0.08);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, [86, 134, 42]);
      t.set(i, 15, [86, 134, 42]);
      t.set(0, i, [86, 134, 42]);
      t.set(15, i, [86, 134, 42]);
    }
  },
  sandstone_top: (t) => t.speckle([222, 210, 162], 0.06),
  sandstone_bottom: (t) => {
    t.speckle([214, 200, 152], 0.07);
    for (let i = 0; i < 5; i++) {
      const x = t.rnd(16), y = t.rnd(16);
      t.mul(x, y, 0.85);
      t.mul(x + 1, y, 0.88);
    }
  },
  sandstone_side: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let c = [216, 203, 155];
        if (y < 3) c = [226, 215, 170];
        else if (y === 3 || y === 11) c = [196, 180, 132];
        else if (y > 11) c = [208, 194, 146];
        let f = 0.96 + t.rand() * 0.08;
        if (y > 4 && y < 10 && (y + x) % 7 === 0) f *= 0.94;
        t.set(x, y, scale(c, f));
      }
  },
  glowstone: (t) => {
    cobble(t, [236, 188, 96], [138, 92, 42]);
    for (let i = 0; i < 18; i++) {
      const x = t.rnd(16), y = t.rnd(16);
      const c = t.get(x, y);
      if (c[0] > 150) t.set(x, y, [255, 240, 176]);
    }
  },
  torch: (t) => {
    t.clear();
    for (let y = 8; y < 16; y++) {
      t.set(7, y, [124, 92, 52]);
      t.set(8, y, [96, 72, 40]);
    }
    t.set(7, 6, [255, 255, 196]);
    t.set(8, 6, [255, 232, 120]);
    t.set(7, 7, [255, 210, 90]);
    t.set(8, 7, [250, 168, 50]);
  },
  tnt_side: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (y >= 4 && y <= 11) t.set(x, y, scale([232, 232, 228], 0.95 + t.rand() * 0.05));
        else {
          let f = 0.92 + t.rand() * 0.12;
          if (x % 4 === 3) f *= 0.75;
          t.set(x, y, scale([214, 62, 30], f));
        }
      }
    const black = [30, 30, 30];
    drawPattern(t, 2, 5, ['###', '.#.', '.#.', '.#.', '.#.'], black);
    drawPattern(t, 6, 5, ['#..#', '##.#', '#.##', '#..#', '#..#'], black);
    drawPattern(t, 11, 5, ['###', '.#.', '.#.', '.#.', '.#.'], black);
  },
  tnt_top: (t) => {
    t.speckle([200, 56, 26], 0.12);
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, [210, 210, 206]);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, [70, 70, 70]);
    t.set(7, 7, [30, 30, 30]);
    t.set(8, 8, [30, 30, 30]);
  },
  tnt_bottom: (t) => t.speckle([180, 50, 24], 0.12),
  bookshelf: (t) => {
    planks(t, [164, 132, 80]);
    const bookColors = [[152, 42, 40], [44, 72, 142], [52, 112, 52], [142, 112, 42], [104, 52, 112], [170, 152, 120], [60, 60, 70]];
    for (const [y0, y1] of [[2, 7], [9, 14]]) {
      let x = 1;
      while (x < 15) {
        const w = 1 + (t.rand() < 0.35 ? 1 : 0);
        const col = t.pick(bookColors);
        const gap = t.rand() < 0.12;
        const top = y0 + (t.rand() < 0.3 ? 1 : 0);
        for (let xx = x; xx < Math.min(15, x + w); xx++)
          for (let y = y0; y < y1; y++) {
            if (gap || y < top) t.set(xx, y, [44, 32, 20]);
            else t.set(xx, y, scale(col, y === top ? 1.2 : 0.9 + t.rand() * 0.15));
          }
        x += w;
      }
    }
  },
  crafting_table_top: (t) => {
    planks(t, [164, 132, 80]);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, [92, 62, 32]);
      t.set(i, 15, [92, 62, 32]);
      t.set(0, i, [92, 62, 32]);
      t.set(15, i, [92, 62, 32]);
      if (i > 0 && i < 15) {
        t.set(i, 5, [122, 92, 52]);
        t.set(i, 10, [122, 92, 52]);
        t.set(5, i, [122, 92, 52]);
        t.set(10, i, [122, 92, 52]);
      }
    }
  },
  crafting_table_side: (t) => {
    planks(t, [150, 118, 70]);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) t.set(x, y, scale([110, 80, 45], 0.9 + t.rand() * 0.2));
    drawPattern(t, 2, 5, ['#####', '#####', '.#.#.'], [168, 168, 172]);
    drawPattern(t, 7, 5, ['##', '##'], [92, 62, 32]);
    drawPattern(t, 10, 5, ['###', '###', '.#.', '.#.', '.#.', '.#.'], [140, 140, 146]);
    drawPattern(t, 11, 7, ['#', '#', '#', '#'], [110, 80, 45]);
  },
  crafting_table_front: (t) => {
    planks(t, [150, 118, 70]);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) t.set(x, y, scale([110, 80, 45], 0.9 + t.rand() * 0.2));
    drawPattern(t, 3, 5, ['#####', '#...#', '..#..', '..#..', '..#..', '..#..'], [150, 150, 156]);
    drawPattern(t, 5, 7, ['#', '#', '#', '#'], [110, 80, 45]);
    drawPattern(t, 10, 5, ['.##', '###', '##.', '#..', '#..'], [170, 170, 176]);
  },
  furnace_side: (t) => {
    stone(t, [118, 118, 118]);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, [150, 150, 150]);
      t.set(0, i, [140, 140, 140]);
      t.set(i, 15, [80, 80, 80]);
      t.set(15, i, [86, 86, 86]);
    }
  },
  furnace_top: (t) => {
    stone(t, [128, 128, 128]);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, [96, 96, 96]);
      t.set(0, i, [96, 96, 96]);
      t.set(i, 15, [96, 96, 96]);
      t.set(15, i, [96, 96, 96]);
    }
  },
  furnace_front: (t) => {
    PAINTERS.furnace_side(t);
    for (let x = 4; x < 12; x++) {
      t.set(x, 3, [60, 60, 60]);
      t.set(x, 5, [60, 60, 60]);
      for (let y = 9; y < 15; y++) t.set(x, y, y === 9 ? [50, 50, 50] : [22, 20, 20]);
    }
    for (let x = 4; x < 12; x += 2) t.set(x, 4, [60, 60, 60]);
  },
  obsidian: (t) => {
    t.speckle([22, 17, 34], 0.3);
    for (let i = 0; i < 14; i++) t.set(t.rnd(16), t.rnd(16), t.pick([[58, 38, 88], [44, 30, 70], [96, 76, 140]]));
  },
  pumpkin_side: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let f = 0.95 + t.rand() * 0.1;
        if (x % 4 === 0) f *= 0.8;
        if (y === 0 || y === 15) f *= 0.9;
        t.set(x, y, scale([214, 126, 24], f));
      }
  },
  pumpkin_top: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let f = (0.95 + t.rand() * 0.1) * (d > 6.5 ? 0.82 : 1);
        if (x === 7 || y === 7) f *= 0.88;
        t.set(x, y, scale([210, 124, 22], f));
      }
    for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) t.set(x, y, [96, 72, 30]);
  },
  pumpkin_face: (t) => {
    PAINTERS.pumpkin_side(t);
    drawFace(t, [44, 22, 4]);
  },
  pumpkin_lit: (t) => {
    PAINTERS.pumpkin_side(t);
    drawFace(t, [255, 214, 80]);
  },
  melon_side: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const stripe = (x + (y % 4 < 2 ? 0 : 1)) % 4 === 0;
        t.set(x, y, scale(stripe ? [86, 128, 22] : [120, 168, 36], 0.93 + t.rand() * 0.12));
      }
  },
  melon_top: (t) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const stripe = Math.floor(d) % 3 === 0;
        t.set(x, y, scale(stripe ? [90, 130, 24] : [122, 170, 40], 0.93 + t.rand() * 0.12));
      }
    t.set(7, 7, [110, 90, 40]);
    t.set(8, 8, [110, 90, 40]);
  },
  iron_block: (t) => metal(t, [220, 220, 222]),
  gold_block: (t) => metal(t, [248, 208, 64]),
  diamond_block: (t) => metal(t, [104, 222, 216]),
  tall_grass: (t) => {
    t.clear();
    for (let i = 0; i < 11; i++) {
      let x = 1 + t.rnd(14);
      const h = 5 + t.rnd(9);
      const c = t.pick(GRASS);
      for (let k = 0; k < h; k++) {
        if (k > 3 && t.rand() < 0.2) x += t.rand() < 0.5 ? -1 : 1;
        t.set(x, 15 - k, scale(c, 0.8 + (k / h) * 0.35));
      }
    }
  },
  fern: (t) => {
    t.clear();
    for (const [x0, lean] of [[4, -1], [8, 0], [11, 1]]) {
      const h = 9 + t.rnd(5);
      for (let k = 0; k < h; k++) {
        const x = x0 + Math.round((lean * k) / 5);
        const y = 15 - k;
        t.set(x, y, [58, 112, 40]);
        if (k > 2 && k % 2 === 0) {
          t.set(x - 1, y, [72, 136, 48]);
          t.set(x + 1, y - 1, [72, 136, 48]);
        }
      }
    }
  },
  dandelion: (t) => flower(t, [250, 220, 40], [230, 160, 20]),
  poppy: (t) => flower(t, [214, 36, 30], [40, 24, 12]),
  cornflower: (t) => flower(t, [74, 104, 232], [40, 60, 160]),
  dead_bush: (t) => {
    t.clear();
    const c = [124, 84, 44];
    const branches = [[7, 15, 0, -1, 8], [7, 11, -1, -1, 5], [8, 10, 1, -1, 6], [7, 8, -1, -1, 3], [8, 13, 1, -1, 4]];
    for (const [sx, sy, dx, dy, n] of branches) {
      let x = sx, y = sy;
      for (let k = 0; k < n; k++) {
        t.set(x, y, scale(c, 0.8 + t.rand() * 0.3));
        y += dy;
        if (k % 2 === 1) x += dx;
      }
    }
  },
  mushroom_red: (t) => {
    t.clear();
    for (let y = 10; y < 16; y++) {
      t.set(7, y, [226, 216, 196]);
      t.set(8, y, [206, 196, 176]);
    }
    const cap = ['..####..', '.######.', '########', '########'];
    cap.forEach((row, dy) => [...row].forEach((ch, dx) => ch === '#' && t.set(4 + dx, 6 + dy, scale([204, 34, 30], 0.9 + t.rand() * 0.15))));
    for (const [x, y] of [[6, 7], [9, 8], [5, 9], [10, 9], [8, 6]]) t.set(x, y, [240, 240, 236]);
  },
  mushroom_brown: (t) => {
    t.clear();
    for (let y = 10; y < 16; y++) {
      t.set(7, y, [216, 206, 186]);
      t.set(8, y, [196, 186, 166]);
    }
    const cap = ['.######.', '########', '########'];
    cap.forEach((row, dy) => [...row].forEach((ch, dx) => ch === '#' && t.set(4 + dx, 7 + dy, scale([152, 112, 82], 0.9 + t.rand() * 0.15))));
  },
  sugar_cane: (t) => {
    t.clear();
    for (const x0 of [3, 8, 12]) {
      const off = t.rnd(4);
      for (let y = 0; y < 16; y++) {
        const node = (y + off) % 5 === 0;
        t.set(x0, y, node ? [120, 160, 70] : [150, 196, 96]);
        t.set(x0 + 1, y, node ? [100, 140, 60] : [128, 176, 80]);
      }
      t.set(x0 - 1, (off + 3) % 16, [110, 170, 70]);
      t.set(x0 + 2, (off + 9) % 16, [110, 170, 70]);
    }
  },
};

function drawFace(t, c) {
  drawPattern(t, 3, 4, ['###', '.#.'], c);
  drawPattern(t, 10, 4, ['###', '.#.'], c);
  drawPattern(t, 3, 9, ['##########', '.########.', '..#.##.#..'], c);
}

const WOOL_RGB = {
  white: [233, 236, 236], light_gray: [142, 142, 134], gray: [62, 68, 71], black: [24, 24, 30],
  brown: [114, 71, 40], red: [160, 39, 34], orange: [240, 118, 19], yellow: [248, 197, 39],
  lime: [112, 185, 25], green: [84, 109, 27], cyan: [21, 137, 145], light_blue: [58, 175, 217],
  blue: [53, 57, 157], purple: [121, 42, 172], magenta: [189, 68, 179], pink: [237, 141, 172],
};
for (const c of WOOL_COLORS) PAINTERS[`wool_${c}`] = (t) => wool(t, WOOL_RGB[c]);

// Give fully transparent pixels the average opaque color so mipmaps don't get dark fringes.
function bleedTransparent(data) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] > 0) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  if (!n || n === 256) return;
  r /= n; g /= n; b /= n;
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] === 0) {
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
}

export function paintTexture(name) {
  const t = new Canvas16(name);
  const painter = PAINTERS[name];
  if (painter) painter(t);
  else {
    // Missing texture: magenta/black checker.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, ((x >> 3) + (y >> 3)) % 2 ? [248, 0, 248] : [0, 0, 0]);
  }
  if (!name.startsWith('leaves') && name !== 'glass') bleedTransparent(t.data);
  return t.data;
}

// Paint all named textures into one RGBA buffer (layer after layer).
export function buildTextureArray(names) {
  const layerSize = TEX_SIZE * TEX_SIZE * 4;
  const data = new Uint8Array(names.length * layerSize);
  const layers = new Map();
  const images = new Map();
  names.forEach((name, i) => {
    const px = paintTexture(name);
    data.set(px, i * layerSize);
    layers.set(name, i);
    images.set(name, px);
  });
  return { data, layers, images, count: names.length };
}

export { mix };
