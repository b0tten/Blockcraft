// Inventory icons: isometric cubes (or flat sprites) painted onto small canvases.

import { BLOCKS, RENDER, R_CROSS, R_TORCH, faceTextureNames } from './blocks.js';

function textureCanvas(pixels, shade) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(16, 16);
  for (let i = 0; i < 256 * 4; i += 4) {
    img.data[i] = pixels[i] * shade;
    img.data[i + 1] = pixels[i + 1] * shade;
    img.data[i + 2] = pixels[i + 2] * shade;
    img.data[i + 3] = pixels[i + 3] < 40 ? 0 : 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function makeIcons(tex, size = 48) {
  const icons = new Map();
  const cache = new Map();
  const texCanvas = (name, shade) => {
    const key = `${name}:${shade}`;
    if (!cache.has(key)) cache.set(key, textureCanvas(tex.images.get(name), shade));
    return cache.get(key);
  };
  for (const b of BLOCKS) {
    const faces = faceTextureNames(b);
    if (!faces || !b.inventory) continue;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const r = RENDER[b.id];
    if (r === R_CROSS || r === R_TORCH) {
      ctx.drawImage(texCanvas(faces[0], 1), 0, 0, size, size);
    } else {
      const S = size, k = S / 16;
      const pad = 1.01; // slight overlap hides seams between faces
      // Top face (+Y): NW corner at the top of the rhombus.
      ctx.setTransform((0.5 * k) * pad, 0.25 * k * pad, -0.5 * k * pad, 0.25 * k * pad, 0.5 * S, 0);
      ctx.drawImage(texCanvas(faces[2], 1), 0, 0);
      // Left face: south (+Z).
      ctx.setTransform(0.5 * k * pad, 0.25 * k * pad, 0, 0.5 * k * pad, 0, 0.25 * S);
      ctx.drawImage(texCanvas(faces[4], 0.8), 0, 0);
      // Right face: east (+X).
      ctx.setTransform(0.5 * k * pad, -0.25 * k * pad, 0, 0.5 * k * pad, 0.5 * S, 0.5 * S);
      ctx.drawImage(texCanvas(faces[0], 0.62), 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    icons.set(b.id, c.toDataURL());
  }
  return icons;
}

// Tiled background image (e.g. dirt) for menu screens.
export function textureDataURL(tex, name, scale = 4, shade = 0.35) {
  const c = document.createElement('canvas');
  c.width = c.height = 16 * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(textureCanvas(tex.images.get(name), shade), 0, 0, 16 * scale, 16 * scale);
  return c.toDataURL();
}
