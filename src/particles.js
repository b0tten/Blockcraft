// Block-break debris and explosion smoke, drawn as camera-facing textured quads.

import { FACE_TEX, B } from './blocks.js';
import { lightBrightness } from './sky.js';

const MAX_PARTICLES = 2000;

export class Particles {
  constructor() {
    this.list = [];
  }

  blockBreak(x, y, z, id, count = 4) {
    const layer = FACE_TEX[id * 6];
    for (let i = 0; i < count; i++)
      for (let j = 0; j < count; j++)
        for (let k = 0; k < count; k++) {
          const px = x + (i + 0.5) / count, py = y + (j + 0.5) / count, pz = z + (k + 0.5) / count;
          this.add({
            x: px, y: py, z: pz,
            vx: (px - x - 0.5) * 4 + (Math.random() - 0.5) * 1.5,
            vy: (py - y - 0.5) * 3 + Math.random() * 2.5,
            vz: (pz - z - 0.5) * 4 + (Math.random() - 0.5) * 1.5,
            life: 0.4 + Math.random() * 0.7,
            size: 0.08 + Math.random() * 0.08,
            layer,
            u: Math.floor(Math.random() * 12) / 16,
            v: Math.floor(Math.random() * 12) / 16,
            uvSize: 4 / 16,
            gravity: 18,
          });
        }
  }

  smoke(x, y, z, n, spread) {
    const layer = FACE_TEX[B.light_gray_wool * 6];
    const dark = FACE_TEX[B.gray_wool * 6];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.add({
        x: x + Math.cos(a) * r, y: y + (Math.random() - 0.5) * spread, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * (2 + Math.random() * 4), vy: 1 + Math.random() * 3, vz: Math.sin(a) * (2 + Math.random() * 4),
        life: 0.8 + Math.random() * 1.2,
        size: 0.3 + Math.random() * 0.5,
        layer: Math.random() < 0.5 ? layer : dark,
        u: 0, v: 0, uvSize: 1,
        gravity: -1.5,
        drag: 2.5,
        glow: 0.3,
      });
    }
  }

  add(p) {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  update(dt, world) {
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vy *= k; p.vz *= k;
      }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (p.gravity > 0 && world.isSolid(Math.floor(nx), Math.floor(ny - p.size * 0.5), Math.floor(nz))) {
        // Hit something: stop and slide.
        if (!world.isSolid(Math.floor(p.x), Math.floor(ny - p.size * 0.5), Math.floor(p.z))) {
          p.vx *= -0.3; p.vz *= -0.3;
        } else {
          p.vy = 0;
          p.vx *= 0.6; p.vz *= 0.6;
        }
      } else {
        p.x = nx; p.y = ny; p.z = nz;
      }
      list[w++] = p;
    }
    list.length = w;
  }

  // Emit billboards into a sprite batch, positions relative to the camera.
  build(batch, cam, world, sunlight) {
    if (!this.list.length) return;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const rx = cy, rz = -sy; // camera right
    const ux = sy * sp, uy = cp, uz = cy * sp; // camera up
    for (const p of this.list) {
      const light = p.glow ? Math.max(p.glow, sunlight) : lightBrightness(world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), sunlight);
      const s = p.size * (p.gravity < 0 ? 0.6 + 0.4 * Math.min(1, p.life) : 1);
      const x = p.x - cam.x, y = p.y - cam.y, z = p.z - cam.z;
      const a = [x - rx * s - ux * s, y - uy * s, z - rz * s - uz * s];
      const b = [x + rx * s - ux * s, y - uy * s, z + rz * s - uz * s];
      const c = [x + rx * s + ux * s, y + uy * s, z + rz * s + uz * s];
      const d = [x - rx * s + ux * s, y + uy * s, z - rz * s + uz * s];
      batch.quad(a, b, c, d, p.u, p.v, p.u + p.uvSize, p.v + p.uvSize, p.layer, light);
    }
  }
}
