// Block edit maps (chunkKey -> Map(voxel index -> block id)) and their compact JSON form,
// used by singleplayer saves, the multiplayer server and its network messages.

import { chunkKey } from '../constants.js';

export const chunkCoords = (key) => [Math.floor(key / 65536) - 32768, (key % 65536) - 32768];

export function editsToArray(m) {
  const arr = [];
  if (m) for (const [i, id] of m) arr.push(i, id);
  return arr;
}

export function editsFromArray(arr) {
  const m = new Map();
  for (let i = 0; i + 1 < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
  return m;
}

// { "cx,cz": [index, id, index, id, ...] }
export function serializeEdits(edits) {
  const out = {};
  for (const [key, m] of edits) {
    if (!m.size) continue;
    const [cx, cz] = chunkCoords(key);
    out[`${cx},${cz}`] = editsToArray(m);
  }
  return out;
}

export function deserializeEdits(obj) {
  const edits = new Map();
  if (!obj) return edits;
  for (const k of Object.keys(obj)) {
    const [cx, cz] = k.split(',').map(Number);
    edits.set(chunkKey(cx, cz), editsFromArray(obj[k]));
  }
  return edits;
}
