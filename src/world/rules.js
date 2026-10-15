// How blocks are placed and used, shared by singleplayer, the multiplayer client (to show
// results at once) and the server (which has the final say). `world` needs getBlock().

import { WORLD_HEIGHT as H } from '../constants.js';
import { B, SOLID, REPLACEABLE, NEEDS_SUPPORT, VARIANT, DECOR, ATTACH, FACE_DIR } from '../blocks.js';

// Facing (rot) -> horizontal direction: north, east, south, west.
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function facingFromYaw(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best = 0, bestDot = -2;
  DIRS.forEach(([dx, dz], r) => {
    const d = dx * fx + dz * fz;
    if (d > bestDot) {
      bestDot = d;
      best = r;
    }
  });
  return best;
}

// Clicked face (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z) -> facing of something hung on that wall.
const WALL_ROT = { 4: 0, 1: 1, 5: 2, 0: 3 };

// Facing (rot) -> face index of the direction it points: north -Z, east +X, south +Z, west -X.
const FACE_OF_ROT = [5, 0, 4, 1];

const free = (w, x, y, z) => {
  if (y < 0 || y >= H) return false;
  const b = w.getBlock(x, y, z);
  return b === 0 || REPLACEABLE[b] === 1;
};
const solidBelow = (w, x, y, z) => SOLID[w.getBlock(x, y - 1, z)] === 1;

// Blocks to write when `item` is placed at (x, y, z): `rot` is where the player faces,
// `face` the face that was clicked. Null if it can't go there.
export function placeChanges(w, x, y, z, item, rot, face) {
  if (!free(w, x, y, z)) return null;
  rot &= 3;
  switch (item) {
    case B.oak_door:
      if (!free(w, x, y + 1, z) || !solidBelow(w, x, y, z)) return null;
      return [[x, y, z, DECOR.door.lower[0][rot]], [x, y + 1, z, DECOR.door.upper[0][rot]]];
    case B.red_bed: {
      const [dx, dz] = DIRS[rot];
      if (!free(w, x + dx, y, z + dz) || !solidBelow(w, x, y, z) || !solidBelow(w, x + dx, y, z + dz)) return null;
      return [[x, y, z, DECOR.bed.foot[rot]], [x + dx, y, z + dz, DECOR.bed.head[rot]]];
    }
    case B.ladder:
      return face in WALL_ROT ? [[x, y, z, DECOR.ladder[WALL_ROT[face]]]] : null;
    case B.oak_sign:
      if (face in WALL_ROT) return [[x, y, z, DECOR.sign.wall[WALL_ROT[face]]]];
      return face === 2 && solidBelow(w, x, y, z) ? [[x, y, z, DECOR.sign.stand[rot]]] : null;
    case B.flower_pot:
      return solidBelow(w, x, y, z) ? [[x, y, z, DECOR.pot.empty]] : null;
    case B.redstone_dust:
      return solidBelow(w, x, y, z) ? [[x, y, z, DECOR.dust[0]]] : null;
    case B.stone_pressure_plate:
    case B.oak_pressure_plate:
      return solidBelow(w, x, y, z) ? [[x, y, z, DECOR.plate[item === B.oak_pressure_plate ? 1 : 0][0]]] : null;
    case B.redstone_torch:
      return solidBelow(w, x, y, z) ? [[x, y, z, DECOR.rstorch[1]]] : null;
    case B.repeater:
      return solidBelow(w, x, y, z) ? [[x, y, z, DECOR.repeater[rot][0][0]]] : null;
    case B.lever:
    case B.stone_button: {
      // Hangs on the face that was clicked: floor, ceiling or a wall.
      const [dx, dy, dz] = FACE_DIR[face] || [0, 0, 0];
      if (!SOLID[w.getBlock(x - dx, y - dy, z - dz)]) return null;
      return [[x, y, z, (item === B.lever ? DECOR.lever : DECOR.button)[face][0]]];
    }
    case B.piston:
    case B.sticky_piston: {
      // Points up or down when put on a floor or ceiling, else the way the player faces.
      const facing = face === 2 || face === 3 ? face : FACE_OF_ROT[rot];
      return [[x, y, z, DECOR.piston[item === B.sticky_piston ? 1 : 0][facing][0]]];
    }
  }
  if (NEEDS_SUPPORT[item]) {
    const below = w.getBlock(x, y - 1, z);
    const supported = SOLID[below] || (item === B.sugar_cane && below === B.sugar_cane);
    if (!supported && !(item === B.torch && face !== 2 && face !== 3)) return null;
  }
  return [[x, y, z, item]];
}

// Blocks to write when the block at (x, y, z) is used (right-clicked) while holding `held`:
// doors open and close, levers flip, repeaters change delay, pots take and give back plants. Null if nothing happens.
export function useChanges(w, x, y, z, held) {
  const v = VARIANT[w.getBlock(x, y, z)];
  if (!v) return null;
  if (v.kind === 'door') {
    const ly = v.half === 'upper' ? y - 1 : y;
    const lo = VARIANT[w.getBlock(x, ly, z)], up = VARIANT[w.getBlock(x, ly + 1, z)];
    if (lo?.kind !== 'door' || lo.half !== 'lower' || up?.kind !== 'door' || up.half !== 'upper') return null;
    const open = v.open ? 0 : 1;
    return [[x, ly, z, DECOR.door.lower[open][lo.rot]], [x, ly + 1, z, DECOR.door.upper[open][up.rot]]];
  }
  if (v.kind === 'repeater') return [[x, y, z, DECOR.repeater[v.rot][v.delay % 4][v.on ? 1 : 0]]]; // click to change the delay
  if (v.kind === 'lever') return [[x, y, z, DECOR.lever[v.mount][v.on ? 0 : 1]]];
  // A pressed button lets go by itself (the redstone simulation), so the click does nothing.
  if (v.kind === 'button') return [[x, y, z, DECOR.button[v.mount][1]]];
  if (v.kind === 'pot') {
    const potted = DECOR.pot.byPlant.get(held);
    if (potted && v.plant !== held) return [[x, y, z, potted]];
    return v.plant ? [[x, y, z, DECOR.pot.empty]] : null;
  }
  return null;
}

// When one half of a door or bed is removed (or replaced by something else), the other half
// goes too. Returns that half's position, or null.
export function linkedRemoval(w, old, id, x, y, z) {
  const v = VARIANT[old];
  if (!v) return null;
  // Pistons: the head goes with an extended base; without its head the base is a plain piston again.
  if (v.kind === 'piston' && v.extended) {
    if (VARIANT[id]?.kind === 'piston') return null;
    const [dx, dy, dz] = FACE_DIR[v.facing];
    const h = VARIANT[w.getBlock(x + dx, y + dy, z + dz)];
    return h?.kind === 'pistonHead' && h.facing === v.facing ? [x + dx, y + dy, z + dz, 0] : null;
  }
  if (v.kind === 'pistonHead') {
    if (VARIANT[id]?.kind === 'pistonHead') return null;
    const [dx, dy, dz] = FACE_DIR[v.facing];
    const bx = x - dx, by = y - dy, bz = z - dz;
    const b = VARIANT[w.getBlock(bx, by, bz)];
    return b?.kind === 'piston' && b.extended && b.facing === v.facing ? [bx, by, bz, DECOR.piston[b.sticky ? 1 : 0][b.facing][0]] : null;
  }
  if ((v.kind !== 'door' && v.kind !== 'bed') || VARIANT[id]?.kind === v.kind) return null;
  let px = x, py = y, pz = z;
  if (v.kind === 'door') py += v.half === 'lower' ? 1 : -1;
  else {
    const [dx, dz] = DIRS[v.rot];
    const s = v.part === 'foot' ? 1 : -1;
    px += dx * s;
    pz += dz * s;
  }
  const o = VARIANT[w.getBlock(px, py, pz)];
  if (!o || o.kind !== v.kind) return null;
  if (v.kind === 'door' ? o.half === v.half : o.part === v.part || o.rot !== v.rot) return null;
  return [px, py, pz, 0];
}

export const isSign = (id) => VARIANT[id]?.kind === 'sign';

export const MAX_SIGN_LINE = 15;
const CONTROL = /[\u0000-\u001f\u007f]/g;
// Four lines of sign text from untrusted input, or null.
export function cleanSignLines(lines) {
  if (!Array.isArray(lines)) return null;
  const out = [];
  for (let i = 0; i < 4; i++) out.push(typeof lines[i] === 'string' ? lines[i].replace(CONTROL, '').slice(0, MAX_SIGN_LINE) : '');
  return out;
}

// Levers and buttons fall off when the block they hang on goes: called after (x, y, z) became
// `id`, returns the attached blocks next to it that must be removed (or null).
export function attachedLost(w, x, y, z, id) {
  if (SOLID[id]) return null;
  let out = null;
  for (let f = 0; f < 6; f++) {
    const nx = x + FACE_DIR[f][0], ny = y + FACE_DIR[f][1], nz = z + FACE_DIR[f][2];
    if (ATTACH[w.getBlock(nx, ny, nz)] === (f ^ 1)) (out ||= []).push([nx, ny, nz, 0]);
  }
  return out;
}
