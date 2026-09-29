// First-person held block, built in view space.

import { FACE_TEX, RENDER, R_CROSS, R_TORCH } from './blocks.js';
import { modelMatrix } from './math.js';

const m = new Float32Array(16);

export function buildHand(batch, id, s) {
  if (!id) return;
  // s: { swing 0..1, bobPhase, bobAmount, light, equip 0..1 }
  const sw = s.swing;
  const swingA = Math.sin(Math.sqrt(sw) * Math.PI);
  const swingB = Math.sin(sw * Math.PI);
  let x = 0.6 - swingA * 0.3;
  let y = -0.56 + Math.sin(Math.sqrt(sw) * Math.PI * 2) * 0.12 - (1 - s.equip) * 0.6;
  let z = -0.95 - swingB * 0.12;
  x += Math.sin(s.bobPhase * Math.PI) * 0.03 * s.bobAmount;
  y -= Math.abs(Math.cos(s.bobPhase * Math.PI)) * 0.035 * s.bobAmount;

  const r = RENDER[id];
  if (r === R_CROSS || r === R_TORCH) {
    // Flat sprite, tilted like an item.
    const size = 0.5;
    modelMatrix(m, x, y, z, -0.35 - swingB * 0.4, 0, 0.25, size);
    const tp = (px, py) => [m[0] * px + m[4] * py + m[12], m[1] * px + m[5] * py + m[13], m[2] * px + m[6] * py + m[14]];
    batch.quad(tp(-0.5, -0.5), tp(0.5, -0.5), tp(0.5, 0.5), tp(-0.5, 0.5), 0, 0, 1, 1, FACE_TEX[id * 6], s.light);
    return;
  }
  const size = 0.3;
  modelMatrix(m, x, y, z, Math.PI / 4 + 0.1 - swingB * 0.5, 0.12 - swingB * 0.9, 0, size);
  // Shift so the cube's centre sits at (x, y, z).
  const cx = (m[0] + m[4] + m[8]) * 0.5, cy = (m[1] + m[5] + m[9]) * 0.5, cz = (m[2] + m[6] + m[10]) * 0.5;
  m[12] -= cx;
  m[13] -= cy;
  m[14] -= cz;
  const layers = [];
  for (let f = 0; f < 6; f++) layers.push(FACE_TEX[id * 6 + f]);
  batch.cube(m, layers, s.light);
}
