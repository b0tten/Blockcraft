import { CHUNK_VOLUME, WORLD_HEIGHT, chunkKey } from '../constants.js';

export class Chunk {
  constructor(cx, cz, blocks, biomes) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.blocks = blocks;
    this.biomes = biomes;
    this.light = new Uint8Array(CHUNK_VOLUME); // high nibble: sky light, low nibble: block light
    this.ready = false; // blocks and light are valid
    this.meshDirty = true;
    this.mesh = null; // GPU buffers, owned by the renderer
    this.maxY = 0;
    this.updateMaxY();
  }

  updateMaxY() {
    const b = this.blocks;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const base = y << 8;
      for (let i = 0; i < 256; i++) {
        if (b[base + i] !== 0) {
          this.maxY = y;
          return;
        }
      }
    }
    this.maxY = 0;
  }
}
