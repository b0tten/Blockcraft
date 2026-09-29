// WebGL2 renderer: chunk meshes, sky, clouds, block outline and dynamic sprites.
// Everything is rendered relative to the camera so far-away coordinates stay precise.

import * as S from './shaders.js';
import { mat4, perspective, multiply, invert, viewRotation, frustumPlanes, aabbInFrustum } from '../math.js';
import { Noise } from '../noise.js';
import { TEX_SIZE } from '../textures.js';

function compileProgram(gl, vsSrc, fsSrc) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader compile error: ${gl.getShaderInfoLog(s)}\n${src}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program link error: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { program: p, u };
}

// Unit cube corners for sprite cubes, same face order/winding as the chunk mesher.
const CUBE_FACES = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
export const FACE_SHADE = [0.62, 0.62, 1.0, 0.5, 0.8, 0.8];

// Growable batch of textured triangles: x y z u v layer light flash (8 floats).
export class SpriteBatch {
  constructor() {
    this.data = new Float32Array(8 * 6 * 512);
    this.count = 0;
  }
  clear() {
    this.count = 0;
  }
  vert(x, y, z, u, v, layer, light, flash) {
    if ((this.count + 1) * 8 > this.data.length) {
      const nd = new Float32Array(this.data.length * 2);
      nd.set(this.data);
      this.data = nd;
    }
    const o = this.count * 8;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = u; d[o + 4] = v; d[o + 5] = layer;
    d[o + 6] = light; d[o + 7] = flash;
    this.count++;
  }
  // Quad with corners a (bottom-left), b, c, d in CCW order.
  quad(a, b, c, d, u0, v0, u1, v1, layer, light, flash = 0) {
    this.vert(a[0], a[1], a[2], u0, v1, layer, light, flash);
    this.vert(b[0], b[1], b[2], u1, v1, layer, light, flash);
    this.vert(c[0], c[1], c[2], u1, v0, layer, light, flash);
    this.vert(a[0], a[1], a[2], u0, v1, layer, light, flash);
    this.vert(c[0], c[1], c[2], u1, v0, layer, light, flash);
    this.vert(d[0], d[1], d[2], u0, v0, layer, light, flash);
  }
  // Cube from unit space [0,1]^3 transformed by column-major matrix m.
  cube(m, layers, light, flash = 0, uvRect = null) {
    const tp = (p) => {
      const x = p[0], y = p[1], z = p[2];
      return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    };
    const [u0, v0, u1, v1] = uvRect || [0, 0, 1, 1];
    for (let f = 0; f < 6; f++) {
      const c = CUBE_FACES[f].map(tp);
      const l = typeof light === 'number' ? light * FACE_SHADE[f] : light[f];
      this.quad(c[0], c[1], c[2], c[3], u0, v0, u1, v1, layers[f], l, flash);
    }
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is not supported by this browser or GPU.');
    this.gl = gl;
    this.renderScale = 1;

    this.chunkProg = compileProgram(gl, S.CHUNK_VS, S.CHUNK_FS);
    this.skyProg = compileProgram(gl, S.SKY_VS, S.SKY_FS);
    this.cloudProg = compileProgram(gl, S.CLOUD_VS, S.CLOUD_FS);
    this.lineProg = compileProgram(gl, S.LINE_VS, S.LINE_FS);
    this.spriteProg = compileProgram(gl, S.SPRITE_VS, S.SPRITE_FS);

    this.proj = mat4();
    this.view = mat4();
    this.viewProj = mat4();
    this.invViewProj = mat4();
    this.handProj = mat4();
    this.planes = new Float32Array(24);

    this.quadIndex = gl.createBuffer();
    this.quadCapacity = 0;
    this.ensureQuadIndex(1 << 16);

    this.emptyVao = gl.createVertexArray();
    this.initClouds();
    this.initLines();
    this.initSprites();

    this.worldSprites = new SpriteBatch();
    this.handSprites = new SpriteBatch();
    this.stats = { chunksDrawn: 0, quads: 0 };

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
  }

  ensureQuadIndex(quads) {
    if (quads <= this.quadCapacity) return;
    const cap = Math.max(quads, this.quadCapacity * 2);
    const idx = new Uint32Array(cap * 6);
    for (let q = 0, v = 0, i = 0; q < cap; q++, v += 4) {
      idx[i++] = v; idx[i++] = v + 1; idx[i++] = v + 2;
      idx[i++] = v; idx[i++] = v + 2; idx[i++] = v + 3;
    }
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.quadCapacity = cap;
  }

  setTextures(texArray) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, TEX_SIZE, TEX_SIZE, texArray.count, 0, gl.RGBA, gl.UNSIGNED_BYTE, texArray.data);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 4);
    // No anisotropic filtering: on several backends it forces linear magnification,
    // which blurs the pixel art.
    this.blockTex = tex;
  }

  initClouds() {
    const gl = this.gl;
    const size = 64;
    const n = new Noise(4242);
    const px = new Uint8Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        // Tileable noise by sampling on a torus.
        const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
        const v = n.fbm3(Math.cos(a) * 2.2, Math.sin(a) * 2.2 + Math.cos(b) * 2.2, Math.sin(b) * 2.2, 3);
        px[x + y * size] = v > 0.12 ? 255 : 0;
      }
    this.cloudTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.cloudVao = gl.createVertexArray();
    gl.bindVertexArray(this.cloudVao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  initLines() {
    const gl = this.gl;
    const e = [];
    const c = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of edges) e.push(...c[a], ...c[b]);
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(e), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  initSprites() {
    const gl = this.gl;
    this.spriteVao = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVao);
    this.spriteBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 1 << 16, gl.DYNAMIC_DRAW);
    this.spriteBufSize = 1 << 16;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------ chunk meshes

  createMesh(part) {
    const gl = this.gl;
    const quads = part.vertexCount / 4;
    this.ensureQuadIndex(quads);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, part.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, false, 16, 6);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, 16, 8);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.UNSIGNED_BYTE, false, 16, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bindVertexArray(null);
    return { vao, vbo, count: quads * 6 };
  }

  uploadChunk(chunk, mesh) {
    this.deleteChunk(chunk);
    chunk.mesh = {
      opaque: mesh.opaque.vertexCount ? this.createMesh(mesh.opaque) : null,
      trans: mesh.trans.vertexCount ? this.createMesh(mesh.trans) : null,
      minY: mesh.minY,
      maxY: mesh.maxY,
    };
  }

  deleteChunk(chunk) {
    const m = chunk.mesh;
    if (!m) return;
    const gl = this.gl;
    for (const part of [m.opaque, m.trans]) {
      if (!part) continue;
      gl.deleteVertexArray(part.vao);
      gl.deleteBuffer(part.vbo);
    }
    chunk.mesh = null;
  }

  // ------------------------------------------------------------ frame

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(frame) {
    const gl = this.gl;
    this.resize();
    const { cam, env } = frame;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    const far = Math.max(256, (frame.renderDistance + 2) * 16 * 1.5);
    perspective(this.proj, (cam.fov * Math.PI) / 180, w / h, 0.05, far);
    viewRotation(this.view, cam.yaw, cam.pitch);
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
    frustumPlanes(this.planes, this.viewProj);

    const fogColor = frame.underwater ? env.waterFog : env.fog;
    const fogRange = frame.underwater ? [1, 18 + 30 * env.sunlight] : frame.inLava ? [0, 3] : [frame.renderDistance * 16 * 0.55, frame.renderDistance * 16];
    const fogCol = frame.inLava ? [0.8, 0.25, 0.05] : fogColor;

    gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    if (!frame.underwater && !frame.inLava) {
      const p = this.skyProg;
      gl.useProgram(p.program);
      gl.uniformMatrix4fv(p.u.u_invViewProj, false, this.invViewProj);
      gl.uniform3fv(p.u.u_sunDir, env.sunDir);
      gl.uniform3fv(p.u.u_zenith, env.zenith);
      gl.uniform3fv(p.u.u_horizon, env.horizon);
      gl.uniform3fv(p.u.u_sunsetColor, env.sunsetColor);
      gl.uniform1f(p.u.u_sunset, env.sunset);
      gl.uniform1f(p.u.u_stars, env.stars);
      gl.uniform1f(p.u.u_time, frame.time);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    // Collect visible chunks.
    const opaque = [], trans = [];
    const cx = cam.x, cy = cam.y, cz = cam.z;
    const maxD = (frame.renderDistance + 0.5) * 16;
    for (const c of frame.chunks) {
      const m = c.mesh;
      if (!m || (!m.opaque && !m.trans)) continue;
      const ox = c.cx * 16 - cx, oz = c.cz * 16 - cz;
      const dx = ox + 8, dz = oz + 8;
      const d2 = dx * dx + dz * dz;
      if (d2 > maxD * maxD) continue;
      if (!aabbInFrustum(this.planes, ox, m.minY - cy, oz, ox + 16, m.maxY - cy, oz + 16)) continue;
      if (m.opaque) opaque.push([d2, c]);
      if (m.trans) trans.push([d2, c]);
    }
    opaque.sort((a, b) => a[0] - b[0]);
    trans.sort((a, b) => b[0] - a[0]);

    const p = this.chunkProg;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    gl.uniform1i(p.u.u_tex, 0);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, this.viewProj);
    gl.uniform1f(p.u.u_time, frame.time);
    gl.uniform1f(p.u.u_sunlight, env.sunlight);
    gl.uniform3fv(p.u.u_skyTint, env.skyTint);
    gl.uniform3fv(p.u.u_fogColor, fogCol);
    gl.uniform2f(p.u.u_fogRange, fogRange[0], fogRange[1]);
    gl.uniform1f(p.u.u_alphaCut, 0.5);

    let quads = 0;
    const drawPart = (c, part) => {
      gl.uniform3f(p.u.u_offset, c.cx * 16 - cx, -cy, c.cz * 16 - cz);
      gl.uniform2f(p.u.u_chunkWorld, (c.cx * 16) % 4096, (c.cz * 16) % 4096);
      gl.bindVertexArray(part.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
      gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
      quads += part.count / 6;
    };
    for (const [, c] of opaque) drawPart(c, c.mesh.opaque);

    // Entities and particles.
    if (this.worldSprites.count) this.drawSprites(this.worldSprites, this.viewProj, fogCol, fogRange);

    // Clouds
    if (frame.clouds && !frame.underwater) {
      const cp = this.cloudProg;
      gl.useProgram(cp.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      const extent = Math.max(256, frame.renderDistance * 16 * 2);
      gl.uniformMatrix4fv(cp.u.u_viewProj, false, this.viewProj);
      gl.uniform1f(cp.u.u_height, 192.5 - cy);
      gl.uniform1f(cp.u.u_extent, extent);
      const tile = 12 * 64;
      const wind = frame.time * 1.2;
      gl.uniform2f(cp.u.u_offset, (((cx + wind) % tile) + tile) % tile, ((cz % tile) + tile) % tile);
      gl.uniform3fv(cp.u.u_color, env.cloud);
      gl.uniform3fv(cp.u.u_fogColor, fogCol);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
      gl.uniform1i(cp.u.u_clouds, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(this.cloudVao);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
    }

    // Translucent chunk geometry (water, ice), back to front.
    if (trans.length) {
      gl.useProgram(p.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1f(p.u.u_alphaCut, 0.02);
      for (const [, c] of trans) drawPart(c, c.mesh.trans);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    this.stats.chunksDrawn = opaque.length;
    this.stats.quads = quads;

    // Block outline
    if (frame.selection) {
      const s = frame.selection;
      const lp = this.lineProg;
      gl.useProgram(lp.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(lp.u.u_viewProj, false, this.viewProj);
      const e = 0.003;
      gl.uniform3f(lp.u.u_min, s.min[0] - cx - e, s.min[1] - cy - e, s.min[2] - cz - e);
      gl.uniform3f(lp.u.u_max, s.max[0] - cx + e, s.max[1] - cy + e, s.max[2] - cz + e);
      gl.uniform4f(lp.u.u_color, 0, 0, 0, 0.55);
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINES, 0, 24);
      gl.disable(gl.BLEND);
    }

    // First-person held item, drawn on top of the world.
    if (this.handSprites.count) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      perspective(this.handProj, (70 * Math.PI) / 180, w / h, 0.01, 10);
      this.drawSprites(this.handSprites, this.handProj, fogCol, [1000, 1001]);
    }
    gl.bindVertexArray(null);
  }

  drawSprites(batch, viewProj, fogColor, fogRange) {
    const gl = this.gl;
    const sp = this.spriteProg;
    gl.useProgram(sp.program);
    gl.uniformMatrix4fv(sp.u.u_viewProj, false, viewProj);
    gl.uniform3fv(sp.u.u_fogColor, fogColor);
    gl.uniform2f(sp.u.u_fogRange, fogRange[0], fogRange[1]);
    gl.uniform1i(sp.u.u_tex, 0);
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    const bytes = batch.count * 32;
    if (bytes > this.spriteBufSize) {
      this.spriteBufSize = Math.max(bytes, this.spriteBufSize * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.spriteBufSize, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.count * 8);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, batch.count);
    gl.enable(gl.CULL_FACE);
    gl.useProgram(this.chunkProg.program);
  }
}
