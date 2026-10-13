// Voxel ray traversal (Amanatides & Woo).

import { LIQUID, RENDER, R_CROSS, R_TORCH, SELECT } from './blocks.js';

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
    if (b !== 0 && !LIQUID[b]) {
      const s = SELECT[b];
      if (!s) return { x, y, z, nx, ny, nz, block: b, dist: t };
      // Shaped blocks: only their outline counts, so you can click past an open door.
      const hit = rayBox(ox, oy, oz, dx, dy, dz, x + s[0], y + s[1], z + s[2], x + s[3], y + s[4], z + s[5]);
      if (hit && hit.t <= maxDist) return { x, y, z, nx: hit.n ? hit.n[0] : nx, ny: hit.n ? hit.n[1] : ny, nz: hit.n ? hit.n[2] : nz, block: b, dist: hit.t };
    }
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

// Slab test: entry distance and face normal of a ray hitting a box (n is null when the ray
// starts inside it).
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  let tmin = -Infinity, tmax = Infinity, axis = -1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    let t0 = (lo[a] - o[a]) / d[a], t1 = (hi[a] - o[a]) / d[a];
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tmin) {
      tmin = t0;
      axis = a;
    }
    tmax = Math.min(tmax, t1);
    if (tmin > tmax || tmax < 0) return null;
  }
  if (tmin < 0) return { t: 0, n: null };
  const n = [0, 0, 0];
  n[axis] = d[axis] > 0 ? -1 : 1;
  return { t: tmin, n };
}

// Outline box for a block, in block-local coordinates.
export function blockBounds(id) {
  if (SELECT[id]) return SELECT[id];
  const r = RENDER[id];
  if (r === R_TORCH) return [7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16];
  if (r === R_CROSS) return [2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16];
  return [0, 0, 0, 1, 1, 1];
}
