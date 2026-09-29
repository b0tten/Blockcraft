// Flood-fill voxel lighting with two channels: sky light and block light (torches etc).
// Uses incremental add/remove BFS so single block edits only touch the affected region.

import { WORLD_HEIGHT as H, chunkKey } from '../constants.js';
import { OPAQUE, FILTER, EMIT } from '../blocks.js';

class Queue {
  constructor() {
    this.buf = new Int32Array(1 << 14);
    this.head = 0;
    this.tail = 0;
  }
  push(v) {
    if (this.tail === this.buf.length) {
      if (this.head > this.buf.length >> 1) {
        this.buf.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      } else {
        const nb = new Int32Array(this.buf.length * 2);
        nb.set(this.buf);
        this.buf = nb;
      }
    }
    this.buf[this.tail++] = v;
  }
  push3(a, b, c) {
    this.push(a);
    this.push(b);
    this.push(c);
  }
  reset() {
    this.head = this.tail = 0;
  }
}

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const DOWN = 3;

export class LightEngine {
  constructor(world) {
    this.world = world;
    this.skyInc = new Queue();
    this.blkInc = new Queue();
    this.skyDec = new Queue();
    this.blkDec = new Queue();
  }

  chunk(cx, cz) {
    const c = this.world.chunks.get(chunkKey(cx, cz));
    return c && c.ready ? c : null;
  }

  // A light value changed in chunk c at local (lx, lz): the chunk and any neighbour
  // that samples this voxel while meshing must be rebuilt.
  changed(c, lx, lz) {
    c.meshDirty = true;
    const edgeX = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const edgeZ = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (edgeX === 0 && edgeZ === 0) return;
    const w = this.world;
    if (edgeX) w.markDirty(c.cx + edgeX, c.cz);
    if (edgeZ) w.markDirty(c.cx, c.cz + edgeZ);
    if (edgeX && edgeZ) w.markDirty(c.cx + edgeX, c.cz + edgeZ);
  }

  propagate(q, sky) {
    const shift = sky ? 4 : 0;
    const clearMask = sky ? 0x0f : 0xf0;
    let cc = null, ccx = 0x7fffffff, ccz = 0x7fffffff;
    while (q.head < q.tail) {
      const x = q.buf[q.head++], y = q.buf[q.head++], z = q.buf[q.head++];
      const cx = x >> 4, cz = z >> 4;
      if (cx !== ccx || cz !== ccz) {
        cc = this.chunk(cx, cz);
        ccx = cx;
        ccz = cz;
      }
      if (!cc) continue;
      const L = (cc.light[(x & 15) | ((z & 15) << 4) | (y << 8)] >> shift) & 15;
      if (L <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= H) continue;
        const ncx = nx >> 4, ncz = nz >> 4;
        const nc = ncx === cx && ncz === cz ? cc : this.chunk(ncx, ncz);
        if (!nc) continue;
        const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
        const b = nc.blocks[ni];
        if (OPAQUE[b]) continue;
        const f = FILTER[b];
        const nl = sky && d === DOWN && L === 15 && f === 0 ? 15 : L - 1 - f;
        if (nl <= 0) continue;
        const v = nc.light[ni];
        if (nl > ((v >> shift) & 15)) {
          nc.light[ni] = (v & clearMask) | (nl << shift);
          this.changed(nc, nx & 15, nz & 15);
          q.push3(nx, ny, nz);
        }
      }
    }
    q.reset();
  }

  unpropagate(dec, inc, sky) {
    const shift = sky ? 4 : 0;
    const clearMask = sky ? 0x0f : 0xf0;
    while (dec.head < dec.tail) {
      const x = dec.buf[dec.head++], y = dec.buf[dec.head++], z = dec.buf[dec.head++], L = dec.buf[dec.head++];
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= H) continue;
        const nc = this.chunk(nx >> 4, nz >> 4);
        if (!nc) continue;
        const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
        const v = nc.light[ni];
        const nl = (v >> shift) & 15;
        if (nl === 0) continue;
        if (nl < L || (sky && d === DOWN && L === 15 && nl === 15)) {
          const keep = sky ? 0 : EMIT[nc.blocks[ni]];
          nc.light[ni] = (v & clearMask) | (keep << shift);
          this.changed(nc, nx & 15, nz & 15);
          dec.push3(nx, ny, nz);
          dec.push(nl);
          if (keep) inc.push3(nx, ny, nz);
        } else {
          inc.push3(nx, ny, nz);
        }
      }
    }
    dec.reset();
  }

  // Compute light for a freshly generated chunk and merge it with its loaded neighbours.
  initChunk(c) {
    const { blocks, light } = c;
    light.fill(0);
    c.ready = true;
    const bx = c.cx * 16, bz = c.cz * 16;

    // Sky light straight down each column.
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let L = 15;
        for (let y = H - 1; y >= 0; y--) {
          const i = x | (z << 4) | (y << 8);
          const b = blocks[i];
          if (OPAQUE[b]) break;
          const f = FILTER[b];
          L = L === 15 && f === 0 ? 15 : L - 1 - f;
          if (L <= 0) break;
          light[i] = L << 4;
        }
      }

    // Block light sources.
    const end = (c.maxY + 1) << 8;
    for (let i = 0; i < end; i++) {
      const e = EMIT[blocks[i]];
      if (e) {
        light[i] |= e;
        this.blkInc.push3(bx + (i & 15), i >> 8, bz + ((i >> 4) & 15));
      }
    }

    const nbrs = [this.chunk(c.cx + 1, c.cz), this.chunk(c.cx - 1, c.cz), this.chunk(c.cx, c.cz + 1), this.chunk(c.cx, c.cz - 1)];
    let top = c.maxY;
    for (const n of nbrs) if (n && n.maxY > top) top = n.maxY;
    top = Math.min(H - 1, top + 1);

    // Seed horizontal sky spreading where a lit voxel sits next to a darker one.
    const skyAt = (x, y, z) => {
      // Returns [blocked, skyLevel, filter] for local coords possibly one outside the chunk.
      let ch = c, lx = x, lz = z;
      if (x < 0) { ch = nbrs[1]; lx = 15; }
      else if (x > 15) { ch = nbrs[0]; lx = 0; }
      else if (z < 0) { ch = nbrs[3]; lz = 15; }
      else if (z > 15) { ch = nbrs[2]; lz = 0; }
      if (!ch) return -1;
      const i = lx | (lz << 4) | (y << 8);
      const b = ch.blocks[i];
      if (OPAQUE[b]) return -1;
      return (ch.light[i] >> 4) + FILTER[b];
    };
    for (let y = 0; y <= top; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const L = light[x | (z << 4) | (y << 8)] >> 4;
          if (L <= 1) continue;
          let a = skyAt(x + 1, y, z);
          if (a < 0 || a >= L - 1) a = skyAt(x - 1, y, z);
          if (a < 0 || a >= L - 1) a = skyAt(x, y, z + 1);
          if (a < 0 || a >= L - 1) a = skyAt(x, y, z - 1);
          if (a >= 0 && a < L - 1) this.skyInc.push3(bx + x, y, bz + z);
        }

    // Pull light in from neighbours across the shared faces.
    const seedFace = (n, fixedX, fixedZ) => {
      if (!n) return;
      const yTop = Math.min(H - 1, Math.max(n.maxY, c.maxY) + 1);
      const nbx = n.cx * 16, nbz = n.cz * 16;
      for (let y = 0; y <= yTop; y++)
        for (let k = 0; k < 16; k++) {
          const lx = fixedX >= 0 ? fixedX : k;
          const lz = fixedZ >= 0 ? fixedZ : k;
          const v = n.light[lx | (lz << 4) | (y << 8)];
          if (v >> 4 > 1) this.skyInc.push3(nbx + lx, y, nbz + lz);
          if ((v & 15) > 1) this.blkInc.push3(nbx + lx, y, nbz + lz);
        }
    };
    seedFace(nbrs[0], 0, -1);
    seedFace(nbrs[1], 15, -1);
    seedFace(nbrs[2], -1, 0);
    seedFace(nbrs[3], -1, 15);

    this.propagate(this.skyInc, true);
    this.propagate(this.blkInc, false);
  }

  // Re-light after blocks changed. `changes` is a flat array [x, y, z, x, y, z, ...]
  // and the new block ids must already be written.
  update(changes) {
    for (let k = 0; k < changes.length; k += 3) {
      const x = changes[k], y = changes[k + 1], z = changes[k + 2];
      const c = this.chunk(x >> 4, z >> 4);
      if (!c) continue;
      const i = (x & 15) | ((z & 15) << 4) | (y << 8);
      const v = c.light[i];
      const s = v >> 4, b = v & 15;
      c.light[i] = 0;
      this.changed(c, x & 15, z & 15);
      if (s) {
        this.skyDec.push3(x, y, z);
        this.skyDec.push(s);
      }
      if (b) {
        this.blkDec.push3(x, y, z);
        this.blkDec.push(b);
      }
      const e = EMIT[c.blocks[i]];
      if (e) {
        c.light[i] = e;
        this.blkInc.push3(x, y, z);
      }
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < 0 || ny >= H) continue;
        this.skyInc.push3(x + DX[d], ny, z + DZ[d]);
        this.blkInc.push3(x + DX[d], ny, z + DZ[d]);
      }
      // Light arriving from above the world.
      if (y === H - 1 && !OPAQUE[c.blocks[i]]) {
        c.light[i] |= 15 << 4;
        this.skyInc.push3(x, y, z);
      }
    }
    this.unpropagate(this.skyDec, this.skyInc, true);
    this.unpropagate(this.blkDec, this.blkInc, false);
    this.propagate(this.skyInc, true);
    this.propagate(this.blkInc, false);
  }
}
