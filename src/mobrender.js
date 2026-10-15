// Drawing mobs: blocky box models with swinging legs, a red flash when hit, and their sounds.
// Works on anything with { kind, x, y, z, yaw, hurt, walkPhase, walkAmount } (local mobs in
// singleplayer, smoothed copies of the server's mobs in multiplayer).

import { lightBrightness } from './sky.js';
import { boxMatrix } from './render/boxes.js';

export const MOB_TEXTURES = [
  'pig_skin', 'pig_face', 'pig_snout',
  'cow_hide', 'cow_face', 'cow_horn',
  'sheep_wool', 'sheep_face', 'sheep_skin',
  'chicken_white', 'chicken_face', 'chicken_beak', 'chicken_wattle', 'chicken_leg',
];

const PX = 1 / 16;
// Face order: +X, -X, +Y, -Y, +Z (back), -Z (front). `face` puts a texture on the front only.
const all = (t) => [t, t, t, t, t, t];
const face = (t, f) => [t, t, t, t, t, f];

// Parts in pixels, in the mob's frame (feet at the origin, facing -Z):
// [layers, pivot, min (relative to pivot), size, swing] where swing is +1/-1 for legs that
// move with (or against) the walk, 0 for parts that don't.
const MODELS = {
  pig: [
    ...legs([[3, -5], [-3, 5]], [[-3, -5], [3, 5]], 6, 4, all('pig_skin')),
    [all('pig_skin'), [0, 0, 0], [-5, 6, -8], [10, 8, 16], 0],
    [face('pig_skin', 'pig_face'), [0, 0, 0], [-4, 8, -13], [8, 8, 8], 0],
    [all('pig_snout'), [0, 0, 0], [-2, 9, -14], [4, 3, 1], 0],
  ],
  cow: [
    ...legs([[4, -7], [-4, 7]], [[-4, -7], [4, 7]], 12, 4, all('cow_hide')),
    [all('cow_hide'), [0, 0, 0], [-6, 12, -9], [12, 10, 18], 0],
    [face('cow_hide', 'cow_face'), [0, 0, 0], [-4, 16, -15], [8, 8, 6], 0],
    [all('cow_horn'), [0, 0, 0], [-5, 23, -13], [1, 3, 1], 0],
    [all('cow_horn'), [0, 0, 0], [4, 23, -13], [1, 3, 1], 0],
  ],
  sheep: [
    ...legs([[3, -6], [-3, 6]], [[-3, -6], [3, 6]], 10, 4, all('sheep_skin')),
    [all('sheep_wool'), [0, 0, 0], [-5, 10, -8], [10, 10, 16], 0],
    [face('sheep_wool', 'sheep_face'), [0, 0, 0], [-3, 15, -13], [6, 6, 7], 0],
  ],
  chicken: [
    ...legs([[1.5, 0]], [[-1.5, 0]], 5, 1, all('chicken_leg')),
    [all('chicken_white'), [0, 0, 0], [-3, 5, -4], [6, 6, 8], 0],
    [all('chicken_white'), [0, 0, 0], [-4, 6, -3], [1, 4, 6], 0],
    [all('chicken_white'), [0, 0, 0], [3, 6, -3], [1, 4, 6], 0],
    [face('chicken_white', 'chicken_face'), [0, 0, 0], [-2, 9, -6], [4, 6, 3], 0],
    [all('chicken_beak'), [0, 0, 0], [-2, 11, -8], [4, 2, 2], 0],
    [all('chicken_wattle'), [0, 0, 0], [-1, 9, -7], [2, 2, 1], 0],
  ],
};

// Legs hang from a pivot at their top; the two groups swing opposite ways.
function legs(groupA, groupB, height, width, layers) {
  const leg = ([x, z], swing) => [layers, [x, height, z], [-width / 2, -height, -width / 2], [width, height, width], swing];
  return [...groupA.map((p) => leg(p, 1)), ...groupB.map((p) => leg(p, -1))];
}

export class MobRenderer {
  constructor(layers) {
    const L = (name) => layers.get(name) ?? 0;
    this.models = {};
    for (const [kind, parts] of Object.entries(MODELS))
      this.models[kind] = parts.map(([tex, pivot, min, size, swing]) => ({
        layers: tex.map(L),
        pivot: pivot.map((v) => v * PX),
        min: min.map((v) => v * PX),
        size: size.map((v) => v * PX),
        swing,
      }));
    this.m = new Float32Array(16);
  }

  draw(batch, cam, world, sunlight, mobs, maxDist) {
    const m = this.m;
    for (const e of mobs) {
      const ox = e.x - cam.x, oz = e.z - cam.z;
      if (ox * ox + oz * oz > maxDist * maxDist) continue;
      const parts = this.models[e.kind];
      if (!parts) continue;
      const o = [ox, e.y - cam.y, oz];
      const light = lightBrightness(world.getLight(Math.floor(e.x), Math.floor(e.y + 0.5), Math.floor(e.z)), sunlight);
      const swing = Math.sin(e.walkPhase || 0) * 0.7 * (e.walkAmount || 0);
      const flash = e.hurt > 0 ? -0.6 : 0;
      for (const p of parts) batch.cube(boxMatrix(m, o, e.yaw, p.pivot, swing * p.swing, p.min, p.size), p.layers, light, flash);
    }
  }
}
