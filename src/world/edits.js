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

// Sign text: chunkKey -> Map(voxel index -> [four lines]).
export function signsToArray(m) {
  const arr = [];
  if (m) for (const [i, lines] of m) arr.push([i, lines]);
  return arr;
}

export function signsFromArray(arr) {
  const m = new Map();
  if (Array.isArray(arr)) for (const e of arr) if (Array.isArray(e) && Number.isInteger(e[0]) && Array.isArray(e[1])) m.set(e[0], e[1].map(String));
  return m;
}

export function serializeSigns(signs) {
  const out = {};
  for (const [key, m] of signs) {
    if (!m.size) continue;
    const [cx, cz] = chunkCoords(key);
    out[`${cx},${cz}`] = signsToArray(m);
  }
  return out;
}

export function deserializeSigns(obj) {
  const signs = new Map();
  if (!obj) return signs;
  for (const k of Object.keys(obj)) {
    const [cx, cz] = k.split(',').map(Number);
    signs.set(chunkKey(cx, cz), signsFromArray(obj[k]));
  }
  return signs;
}

// Sign maps shared by the client and server worlds.
export function setSignIn(signs, x, y, z, lines) {
  const key = chunkKey(x >> 4, z >> 4), i = (x & 15) | ((z & 15) << 4) | (y << 8);
  let m = signs.get(key);
  if (lines && lines.some((l) => l)) {
    if (!m) signs.set(key, (m = new Map()));
    m.set(i, lines);
  } else if (m) m.delete(i);
}

export function getSignIn(signs, x, y, z) {
  return signs.get(chunkKey(x >> 4, z >> 4))?.get((x & 15) | ((z & 15) << 4) | (y << 8)) || null;
}
