// Text on nearby signs: each sign's lines are drawn on a canvas and uploaded into a layer of
// a texture array (reused as signs come and go), then drawn as a quad on the board.

import { SpriteBatch } from './renderer.js';
import { SIGN_TEXT, VARIANT, rotateXZ } from '../blocks.js';
import { chunkKey } from '../constants.js';
import { lightBrightness } from '../sky.js';

const TW = 256, TH = 128, LAYERS = 64, LEVELS = 9;
const RANGE = 24;

export class SignText {
  constructor(gl) {
    this.gl = gl;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, LEVELS, gl.RGBA8, TW, TH, LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.canvas = document.createElement('canvas');
    this.canvas.width = TW;
    this.canvas.height = TH;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.slots = new Map(); // "x,y,z\ntext" -> { layer, frame }
    this.free = [...Array(LAYERS).keys()];
    this.frame = 0;
    this.batch = new SpriteBatch();
  }

  // Collect the signs near the camera into this.batch.
  build(world, cam, sunlight) {
    this.frame++;
    this.batch.clear();
    const ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4;
    const found = [];
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const m = world.signs.get(chunkKey(ccx + dx, ccz + dz));
        if (!m) continue;
        for (const [i, lines] of m) {
          const x = (ccx + dx) * 16 + (i & 15), y = i >> 8, z = (ccz + dz) * 16 + ((i >> 4) & 15);
          const d2 = (x + 0.5 - cam.x) ** 2 + (y + 0.5 - cam.y) ** 2 + (z + 0.5 - cam.z) ** 2;
          const v = VARIANT[world.getBlock(x, y, z)];
          if (d2 > RANGE * RANGE || v?.kind !== 'sign') continue;
          found.push([d2, x, y, z, v, lines]);
        }
      }
    if (!found.length) return;
    found.sort((a, b) => a[0] - b[0]);
    let uploaded = false;
    for (const [, x, y, z, v, lines] of found.slice(0, LAYERS)) {
      const key = `${x},${y},${z}\n${lines.join('\n')}`;
      let slot = this.slots.get(key);
      if (!slot) {
        const layer = this.takeLayer();
        if (layer === null) continue;
        slot = { layer, frame: 0 };
        this.slots.set(key, slot);
        this.draw(lines, layer);
        uploaded = true;
      }
      slot.frame = this.frame;
      this.emit(x, y, z, v, slot.layer, cam, lightBrightness(world.getLight(x, y, z), sunlight));
    }
    if (uploaded) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    }
  }

  takeLayer() {
    if (this.free.length) return this.free.pop();
    for (const [key, slot] of this.slots)
      if (slot.frame !== this.frame) {
        this.slots.delete(key);
        return slot.layer;
      }
    return null;
  }

  draw(lines, layer) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, TW, TH);
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = '#1d1208';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, TW / 2, 17 + i * 31, TW - 8));
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, TW, TH, 1, gl.RGBA, gl.UNSIGNED_BYTE, ctx.getImageData(0, 0, TW, TH).data);
  }

  emit(x, y, z, v, layer, cam, light) {
    const t = v.wall ? SIGN_TEXT.wall : SIGN_TEXT.stand;
    const corner = (px, py) => {
      const [rx, rz] = rotateXZ(px, t.z, v.rot);
      return [x + rx / 16 - cam.x, y + py / 16 - cam.y, z + rz / 16 - cam.z];
    };
    this.batch.quad(corner(t.x0, t.y0), corner(t.x1, t.y0), corner(t.x1, t.y1), corner(t.x0, t.y1), 0, 0, 1, 1, layer, light);
  }
}
