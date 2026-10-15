// Placing boxes of blocky models (player avatars, mobs) in the world.

// Column-major matrix for a box: scale the unit cube to (sx, sy, sz) at offset b from a
// pivot, turn it by `pitch` around X at the pivot, place the pivot at p in the avatar's
// frame, turn that by `yaw` around Y and move it to o.
export function boxMatrix(m, o, yaw, p, pitch, b, s) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ca = Math.cos(pitch), sa = Math.sin(pitch);
  m[0] = cy * s[0]; m[1] = 0; m[2] = -sy * s[0]; m[3] = 0;
  m[4] = sy * sa * s[1]; m[5] = ca * s[1]; m[6] = cy * sa * s[1]; m[7] = 0;
  m[8] = sy * ca * s[2]; m[9] = -sa * s[2]; m[10] = cy * ca * s[2]; m[11] = 0;
  const vx = b[0] + p[0], vy = ca * b[1] - sa * b[2] + p[1], vz = sa * b[1] + ca * b[2] + p[2];
  m[12] = cy * vx + sy * vz + o[0]; m[13] = vy + o[1]; m[14] = -sy * vx + cy * vz + o[2]; m[15] = 1;
  return m;
}
