// Voxel ray traversal (Amanatides & Woo).

import { LIQUID, RENDER, R_CROSS, R_TORCH } from './blocks.js';

export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
  const tdx = stepX ? Math.abs(1 / dx) : Infinity;
  const tdy = stepY ? Math.abs(1 / dy) : Infinity;
  const tdz = stepZ ? Math.abs(1 / dz) : Infinity;
  let tmx = stepX > 0 ? (x + 1 - ox) * tdx : stepX < 0 ? (ox - x) * tdx : Infinity;
  let tmy = stepY > 0 ? (y + 1 - oy) * tdy : stepY < 0 ? (oy - y) * tdy : Infinity;
  let tmz = stepZ > 0 ? (z + 1 - oz) * tdz : stepZ < 0 ? (oz - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 512 && t <= maxDist; i++) {
    const b = world.getBlock(x, y, z);
    if (b !== 0 && !LIQUID[b]) return { x, y, z, nx, ny, nz, block: b, dist: t };
    if (tmx < tmy && tmx < tmz) {
      x += stepX; t = tmx; tmx += tdx; nx = -stepX; ny = 0; nz = 0;
    } else if (tmy < tmz) {
      y += stepY; t = tmy; tmy += tdy; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

// Outline box for a block, in block-local coordinates.
export function blockBounds(id) {
  const r = RENDER[id];
  if (r === R_TORCH) return [7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16];
  if (r === R_CROSS) return [2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16];
  return [0, 0, 0, 1, 1, 1];
}
