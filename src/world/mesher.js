// Builds vertex data for a chunk: face culling, per-vertex ambient occlusion and smooth lighting.
//
// Vertex layout (16 bytes):
//   u16 x, y, z   position inside the chunk in 1/16 block units
//   u16 layer     texture array layer
//   u8  u, v      texture coords in 1/16 units
//   u8  face      face index (0-7) + 8 * flags (1: wave top, 2: wave leaves, 4: scroll liquid)
//   u8  ao        ambient occlusion 0..3
//   u8  sky, blk  light levels scaled to 0..255
//   u8  pad x2

import { WORLD_HEIGHT as H, chunkKey } from '../constants.js';
import { OPAQUE, RENDER, FACE_TEX, CULL_SELF, LIQUID, WAVE, R_NONE, R_TRANSLUCENT, R_CROSS, R_TORCH } from '../blocks.js';

const PW = 18;
const PA = PW * PW;
const PH = H + 2;
const pBlocks = new Uint8Array(PA * PH);
const pLight = new Uint8Array(PA * PH);

const FLAG_WAVE_TOP = 1;
const FLAG_WAVE_ALL = 2;
const FLAG_SCROLL = 4;
const FACE_PLANT = 6;

class VertexBuilder {
  constructor() {
    this.cap = 1 << 15;
    this.alloc(this.cap);
    this.count = 0;
  }
  alloc(cap) {
    const buf = new ArrayBuffer(cap * 16);
    const u8 = new Uint8Array(buf);
    if (this.u8) u8.set(this.u8.subarray(0, this.count * 16));
    this.u8 = u8;
    this.u16 = new Uint16Array(buf);
    this.cap = cap;
  }
  vert(x, y, z, layer, u, v, f, ao, sky, blk) {
    if (this.count >= this.cap) this.alloc(this.cap * 2);
    const o16 = this.count * 8, o8 = this.count * 16;
    const u16 = this.u16, u8 = this.u8;
    u16[o16] = x;
    u16[o16 + 1] = y;
    u16[o16 + 2] = z;
    u16[o16 + 3] = layer;
    u8[o8 + 8] = u;
    u8[o8 + 9] = v;
    u8[o8 + 10] = f;
    u8[o8 + 11] = ao;
    u8[o8 + 12] = sky;
    u8[o8 + 13] = blk;
    this.count++;
  }
  take() {
    const out = this.u8.slice(0, this.count * 16);
    const n = this.count;
    this.count = 0;
    return { data: out, vertexCount: n };
  }
}

const opaqueOut = new VertexBuilder();
const transOut = new VertexBuilder();

// Face corner positions (unit cube), counter-clockwise seen from outside: BL, BR, TR, TL.
const FACE_VERTS = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // +X
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // -X
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // +Y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // -Y
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +Z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // -Z
];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const QUAD_UV = [[0, 16], [16, 16], [16, 0], [0, 0]];
const pidx = (x, y, z) => x + z * PW + y * PA;

// Precomputed padded-index offsets: front neighbour, and per vertex side1, side2, corner.
const FRONT = new Int32Array(6);
const AO_OFF = new Int32Array(6 * 4 * 3);
for (let f = 0; f < 6; f++) {
  const n = FACE_NORMALS[f];
  FRONT[f] = pidx(n[0], n[1], n[2]);
  const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
  const [ta, tb] = [0, 1, 2].filter((a) => a !== axis);
  for (let v = 0; v < 4; v++) {
    const c = FACE_VERTS[f][v];
    const da = c[ta] * 2 - 1, db = c[tb] * 2 - 1;
    const s1 = [...n], s2 = [...n], cr = [...n];
    s1[ta] += da;
    s2[tb] += db;
    cr[ta] += da;
    cr[tb] += db;
    AO_OFF[(f * 4 + v) * 3] = pidx(...s1);
    AO_OFF[(f * 4 + v) * 3 + 1] = pidx(...s2);
    AO_OFF[(f * 4 + v) * 3 + 2] = pidx(...cr);
  }
}

// Torch model: 2x10x2 pixel stick.
const TORCH_MIN = [7, 0, 7], TORCH_MAX = [9, 10, 9];

function gather(world, chunk, yTop) {
  const ymax = Math.min(H - 1, yTop + 1);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const n = world.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
      const x0 = dx === -1 ? 15 : 0, x1 = dx === 1 ? 0 : 15;
      const z0 = dz === -1 ? 15 : 0, z1 = dz === 1 ? 0 : 15;
      const pxOff = dx === -1 ? -15 : dx === 0 ? 1 : 17;
      const pzOff = dz === -1 ? -15 : dz === 0 ? 1 : 17;
      for (let y = 0; y <= ymax; y++) {
        const py = (y + 1) * PA;
        for (let z = z0; z <= z1; z++) {
          const prow = py + (z + pzOff) * PW + pxOff;
          const crow = (y << 8) | (z << 4);
          for (let x = x0; x <= x1; x++) {
            if (n && n.ready) {
              pBlocks[prow + x] = n.blocks[crow | x];
              pLight[prow + x] = n.light[crow | x];
            } else {
              pBlocks[prow + x] = 0;
              pLight[prow + x] = 0xf0;
            }
          }
        }
      }
    }
  // Below the world: solid. Above the gathered range: open sky.
  for (let i = 0; i < PA; i++) {
    pBlocks[i] = 1;
    pLight[i] = 0;
  }
  const above = (ymax + 2) * PA;
  if (ymax + 2 < PH)
    for (let i = 0; i < PA; i++) {
      pBlocks[above + i] = 0;
      pLight[above + i] = 0xf0;
    }
}

function faceVisible(b, n) {
  if (n === 0) return true;
  if (OPAQUE[n]) return false;
  if (n === b && CULL_SELF[b]) return false;
  // Between two translucent blocks (water/ice) draw nothing: stacked blended faces sort badly.
  if (RENDER[b] === R_TRANSLUCENT && RENDER[n] === R_TRANSLUCENT) return false;
  return true;
}

export function buildChunkMesh(world, chunk) {
  const yTop = chunk.maxY;
  gather(world, chunk, yTop);

  let minY = H, maxY = 0;
  for (let y = 0; y <= yTop; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const pi = x + 1 + (z + 1) * PW + (y + 1) * PA;
        const b = pBlocks[pi];
        if (b === 0) continue;
        const r = RENDER[b];
        if (r === R_NONE) continue;
        let emitted = false;
        if (r === R_CROSS) {
          emitCross(opaqueOut, x, y, z, b, pLight[pi]);
          emitted = true;
        } else if (r === R_TORCH) {
          emitTorch(opaqueOut, x, y, z, b, pLight[pi]);
          emitted = true;
        } else {
          const out = r === R_TRANSLUCENT ? transOut : opaqueOut;
          const liquid = LIQUID[b];
          let topH = 16;
          if (liquid && pBlocks[pi + PA] !== b) topH = 14;
          for (let f = 0; f < 6; f++) {
            const ni = pi + FRONT[f];
            const n = pBlocks[ni];
            if (!faceVisible(b, n)) continue;
            emitted = true;
            if (liquid) emitLiquidFace(out, x, y, z, b, f, pLight[ni], topH, out === transOut);
            else emitCubeFace(out, x, y, z, b, f, pi);
          }
        }
        if (emitted) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  const opaque = opaqueOut.take();
  const trans = transOut.take();
  return { opaque, trans, minY: minY > maxY ? 0 : minY, maxY: maxY + 1 };
}

const aoTmp = new Int32Array(4);
const skyTmp = new Int32Array(4);
const blkTmp = new Int32Array(4);

function emitCubeFace(out, x, y, z, b, f, pi) {
  const layer = FACE_TEX[b * 6 + f];
  const front = pi + FRONT[f];
  const fl = pLight[front];
  const fSky = fl >> 4, fBlk = fl & 15;
  for (let v = 0; v < 4; v++) {
    const o = (f * 4 + v) * 3;
    const a = pi + AO_OFF[o], bb = pi + AO_OFF[o + 1], c = pi + AO_OFF[o + 2];
    const o1 = OPAQUE[pBlocks[a]], o2 = OPAQUE[pBlocks[bb]];
    const oc = OPAQUE[pBlocks[c]];
    aoTmp[v] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
    let sky = fSky, blk = fBlk, n = 1;
    if (!o1) { const l = pLight[a]; sky += l >> 4; blk += l & 15; n++; }
    if (!o2) { const l = pLight[bb]; sky += l >> 4; blk += l & 15; n++; }
    if (!oc && !(o1 && o2)) { const l = pLight[c]; sky += l >> 4; blk += l & 15; n++; }
    skyTmp[v] = Math.round((sky / n) * 17);
    blkTmp[v] = Math.round((blk / n) * 17);
  }
  let flags = 0;
  if (WAVE[b]) flags = FLAG_WAVE_ALL;
  const fcode = f + flags * 8;
  const verts = FACE_VERTS[f];
  // Flip the quad diagonal so AO interpolates without an ugly crease.
  const m0 = aoTmp[0] * 4 + ((skyTmp[0] + blkTmp[0]) >> 6);
  const m1 = aoTmp[1] * 4 + ((skyTmp[1] + blkTmp[1]) >> 6);
  const m2 = aoTmp[2] * 4 + ((skyTmp[2] + blkTmp[2]) >> 6);
  const m3 = aoTmp[3] * 4 + ((skyTmp[3] + blkTmp[3]) >> 6);
  const start = m0 + m2 > m1 + m3 ? 1 : 0;
  for (let k = 0; k < 4; k++) {
    const v = (k + start) & 3;
    const c = verts[v];
    out.vert((x + c[0]) * 16, (y + c[1]) * 16, (z + c[2]) * 16, layer, QUAD_UV[v][0], QUAD_UV[v][1], fcode, aoTmp[v], skyTmp[v], blkTmp[v]);
  }
}

// Liquid faces in the translucent pass are emitted double-sided so the surface is
// visible from underwater too.
function emitLiquidFace(out, x, y, z, b, f, light, topH, doubleSided) {
  const layer = FACE_TEX[b * 6 + f];
  const sky = (light >> 4) * 17, blk = (light & 15) * 17;
  const fcode = f + FLAG_SCROLL * 8;
  const verts = FACE_VERTS[f];
  for (let pass = 0; pass < (doubleSided ? 2 : 1); pass++) {
    for (let k = 0; k < 4; k++) {
      const v = pass ? 3 - k : k;
      const c = verts[v];
      const vy = c[1] ? topH : 0;
      let tv = QUAD_UV[v][1];
      if (f !== 2 && f !== 3 && c[1]) tv = 16 - topH;
      out.vert((x + c[0]) * 16, y * 16 + vy, (z + c[2]) * 16, layer, QUAD_UV[v][0], tv, fcode, 3, sky, blk);
    }
  }
}

// Two crossed quads, emitted with both windings so they're visible from either side.
const CROSS_QUADS = [
  [[2, 2], [14, 14]],
  [[2, 14], [14, 2]],
];
function emitCross(out, x, y, z, b, light) {
  const layer = FACE_TEX[b * 6];
  const sky = (light >> 4) * 17, blk = (light & 15) * 17;
  const flags = WAVE[b] ? FLAG_WAVE_TOP : 0;
  const fBottom = FACE_PLANT;
  const fTop = FACE_PLANT + flags * 8;
  const bx = x * 16, by = y * 16, bz = z * 16;
  for (const [[ax, az], [cx, cz]] of CROSS_QUADS) {
    // front
    out.vert(bx + ax, by, bz + az, layer, 0, 16, fBottom, 3, sky, blk);
    out.vert(bx + cx, by, bz + cz, layer, 16, 16, fBottom, 3, sky, blk);
    out.vert(bx + cx, by + 16, bz + cz, layer, 16, 0, fTop, 3, sky, blk);
    out.vert(bx + ax, by + 16, bz + az, layer, 0, 0, fTop, 3, sky, blk);
    // back
    out.vert(bx + cx, by, bz + cz, layer, 16, 16, fBottom, 3, sky, blk);
    out.vert(bx + ax, by, bz + az, layer, 0, 16, fBottom, 3, sky, blk);
    out.vert(bx + ax, by + 16, bz + az, layer, 0, 0, fTop, 3, sky, blk);
    out.vert(bx + cx, by + 16, bz + cz, layer, 16, 0, fTop, 3, sky, blk);
  }
}

function emitTorch(out, x, y, z, b, light) {
  const sky = (light >> 4) * 17, blk = (light & 15) * 17;
  const bx = x * 16, by = y * 16, bz = z * 16;
  for (let f = 0; f < 6; f++) {
    const layer = FACE_TEX[b * 6 + f];
    const verts = FACE_VERTS[f];
    for (let v = 0; v < 4; v++) {
      const c = verts[v];
      const px = c[0] ? TORCH_MAX[0] : TORCH_MIN[0];
      const py = c[1] ? TORCH_MAX[1] : TORCH_MIN[1];
      const pz = c[2] ? TORCH_MAX[2] : TORCH_MIN[2];
      let u, tv;
      if (f === 2) { u = c[0] ? 9 : 7; tv = c[2] ? 8 : 6; }
      else if (f === 3) { u = c[0] ? 9 : 7; tv = c[2] ? 16 : 14; }
      else { u = QUAD_UV[v][0] ? 9 : 7; tv = c[1] ? 6 : 16; }
      out.vert(bx + px, by + py, bz + pz, layer, u, tv, f, 3, sky, blk);
    }
  }
}
