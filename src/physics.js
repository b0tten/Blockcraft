// Swept AABB collision against voxel collision boxes, shared by the player and mobs.
// `world` needs boxesAt(x, y, z) -> boxes in block units, or null.

const EPS = 1e-4;

// Does the box overlap any block's collision box?
export function boxHits(world, minX, minY, minZ, maxX, maxY, maxZ) {
  for (let y = Math.floor(minY); y <= Math.floor(maxY - EPS); y++)
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ - EPS); z++)
      for (let x = Math.floor(minX); x <= Math.floor(maxX - EPS); x++) {
        const boxes = world.boxesAt(x, y, z);
        if (!boxes) continue;
        for (const b of boxes)
          if (x + b[0] < maxX && x + b[3] > minX && y + b[1] < maxY && y + b[4] > minY && z + b[2] < maxZ && z + b[5] > minZ) return true;
      }
  return false;
}

// Move a box (feet at p, half width hw, height h) along one axis, stopping at the first
// collision box ahead. Boxes it already overlaps are ignored, so it can always move out of a
// block. Returns true if it was stopped.
export function sweepAxis(world, p, hw, h, axis, amount) {
  if (amount === 0) return false;
  const min = [p[0] - hw, p[1], p[2] - hw];
  const max = [p[0] + hw, p[1] + h, p[2] + hw];
  const lo = [...min], hi = [...max];
  if (amount > 0) hi[axis] += amount;
  else lo[axis] += amount;
  const a1 = axis === 0 ? 1 : 0, a2 = axis === 2 ? 1 : 2;
  let move = amount;
  const v = [0, 0, 0];
  for (let y = Math.floor(lo[1]); y <= Math.floor(hi[1]); y++)
    for (let z = Math.floor(lo[2]); z <= Math.floor(hi[2]); z++)
      for (let x = Math.floor(lo[0]); x <= Math.floor(hi[0]); x++) {
        const boxes = world.boxesAt(x, y, z);
        if (!boxes) continue;
        v[0] = x;
        v[1] = y;
        v[2] = z;
        for (const b of boxes) {
          const b1 = v[a1] + b[a1], e1 = v[a1] + b[a1 + 3];
          const b2 = v[a2] + b[a2], e2 = v[a2] + b[a2 + 3];
          if (b1 >= max[a1] - EPS || e1 <= min[a1] + EPS || b2 >= max[a2] - EPS || e2 <= min[a2] + EPS) continue;
          if (amount > 0) {
            const face = v[axis] + b[axis];
            if (face >= max[axis] - EPS) move = Math.min(move, Math.max(0, face - max[axis] - EPS));
          } else {
            const face = v[axis] + b[axis + 3];
            if (face <= min[axis] + EPS) move = Math.max(move, Math.min(0, face - min[axis] + EPS));
          }
        }
      }
  p[axis] += move;
  return move !== amount;
}
