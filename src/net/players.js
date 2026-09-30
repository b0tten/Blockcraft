// Other players in a multiplayer world: smoothed movement, blocky avatars and name tags.

import { B, FACE_TEX } from '../blocks.js';
import { hashString } from '../noise.js';
import { lightBrightness } from '../sky.js';
import { clamp, lerp } from '../math.js';
import { F_FLYING, F_SNEAKING } from './protocol.js';

export const AVATAR_TEXTURES = ['avatar_face', 'avatar_head', 'avatar_hair', 'avatar_skin'];

// Positions arrive ~20 times a second; draw them this far in the past so there is
// always a newer sample to interpolate towards.
const DELAY_MS = 120;
const PX = 1.8 / 32; // one "skin pixel": the avatar is 32 pixels tall
const HALF_W = 0.3;
const HEIGHT = 1.8;
const SHIRTS = ['red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'purple', 'magenta', 'pink', 'white', 'gray'];

const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// Column-major matrix for a box: scale the unit cube to (sx, sy, sz) at offset b from a
// pivot, turn it by `pitch` around X at the pivot, place the pivot at p in the avatar's
// frame, turn that by `yaw` around Y and move it to o.
function boxMatrix(m, o, yaw, p, pitch, b, s) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ca = Math.cos(pitch), sa = Math.sin(pitch);
  m[0] = cy * s[0]; m[1] = 0; m[2] = -sy * s[0]; m[3] = 0;
  m[4] = sy * sa * s[1]; m[5] = ca * s[1]; m[6] = cy * sa * s[1]; m[7] = 0;
  m[8] = sy * ca * s[2]; m[9] = -sa * s[2]; m[10] = cy * ca * s[2]; m[11] = 0;
  const vx = b[0] + p[0], vy = ca * b[1] - sa * b[2] + p[1], vz = sa * b[1] + ca * b[2] + p[2];
  m[12] = cy * vx + sy * vz + o[0]; m[13] = vy + o[1]; m[14] = -sy * vx + cy * vz + o[2]; m[15] = 1;
  return m;
}

export class RemotePlayers {
  constructor(layers, tagContainer) {
    this.map = new Map();
    this.tags = tagContainer;
    const L = (name) => layers.get(name) ?? 0;
    const wool = (c) => FACE_TEX[B[`${c}_wool`] * 6];
    const skin = L('avatar_skin'), hair = L('avatar_hair'), head = L('avatar_head');
    // Face order: +X, -X, +Y, -Y, +Z (back), -Z (front).
    this.headLayers = [head, head, hair, skin, hair, L('avatar_face')];
    this.legLayers = Array(6).fill(wool('blue'));
    this.shirtLayers = new Map(SHIRTS.map((c) => [c, Array(6).fill(wool(c))]));
    this.armLayers = new Map(SHIRTS.map((c) => [c, [skin, skin, wool(c), skin, skin, skin]]));
    this.m = new Float32Array(16);
  }

  get size() {
    return this.map.size;
  }

  add(id, name) {
    if (this.map.has(id)) return;
    const tag = document.createElement('div');
    tag.className = 'nametag';
    tag.textContent = name;
    tag.hidden = true;
    this.tags?.appendChild(tag);
    const shirt = SHIRTS[(hashString(name) >>> 0) % SHIRTS.length];
    this.map.set(id, {
      id, name, tag, shirt,
      samples: [],
      offset: null, // their clock -> ours
      visible: false,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0,
      walkPhase: 0, walkAmount: 0, swing: 1,
    });
  }

  remove(id) {
    const e = this.map.get(id);
    if (!e) return;
    e.tag.remove();
    this.map.delete(id);
  }

  clear() {
    for (const e of this.map.values()) e.tag.remove();
    this.map.clear();
  }

  names() {
    return [...this.map.values()].map((e) => e.name);
  }

  // [[id, x, y, z, yaw, pitch, flags, their clock in ms], ...] from the server.
  setStates(list, now = performance.now()) {
    for (const s of list) {
      const e = this.map.get(s[0]);
      if (!e || s.length < 7 || !s.slice(1, 6).every(Number.isFinite)) continue;
      // Time each sample by the sender's clock, mapped onto ours through the smallest delay
      // seen (which adapts slowly), so uneven network delivery doesn't make them stutter.
      let t = now;
      if (Number.isFinite(s[7])) {
        const off = now - s[7];
        e.offset = e.offset === null || off < e.offset ? off : e.offset + (off - e.offset) * 0.01;
        t = s[7] + e.offset;
      }
      const last = e.samples[e.samples.length - 1];
      if (last && t <= last.t) continue;
      // After standing still (no updates), start moving from where they stood just now.
      if (last && t - last.t > 150) e.samples.push({ ...last, t: t - 50 });
      e.samples.push({ t, x: s[1], y: s[2], z: s[3], yaw: s[4], pitch: s[5], f: s[6] | 0 });
      if (e.samples.length > 30) e.samples.splice(0, e.samples.length - 30);
    }
  }

  swing(id) {
    const e = this.map.get(id);
    if (e) e.swing = 0;
  }

  update(dt, now = performance.now()) {
    const rt = now - DELAY_MS;
    for (const e of this.map.values()) {
      const s = e.samples;
      if (!s.length) continue;
      while (s.length > 2 && s[1].t <= rt) s.shift();
      const a = s[0], b = s[1] || a;
      const k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
      const px = e.x, pz = e.z, was = e.visible;
      e.x = lerp(a.x, b.x, k);
      e.y = lerp(a.y, b.y, k);
      e.z = lerp(a.z, b.z, k);
      e.yaw = lerpAngle(a.yaw, b.yaw, k);
      e.pitch = lerp(a.pitch, b.pitch, k);
      e.flags = b.f;
      e.visible = true;
      const speed = was && dt > 0 ? Math.hypot(e.x - px, e.z - pz) / dt : 0;
      const walking = speed > 0.4 && !(e.flags & F_FLYING);
      e.walkAmount += ((walking ? 1 : 0) - e.walkAmount) * Math.min(1, dt * 10);
      e.walkPhase += Math.min(speed, 8) * dt * 1.9;
      e.swing = Math.min(1, e.swing + dt * 4);
    }
  }

  // Would a block at (x, y, z) overlap another player?
  intersectsBlock(x, y, z) {
    for (const e of this.map.values()) {
      if (!e.visible) continue;
      if (e.x + HALF_W > x && e.x - HALF_W < x + 1 && e.y + HEIGHT > y && e.y < y + 1 && e.z + HALF_W > z && e.z - HALF_W < z + 1) return true;
    }
    return false;
  }

  draw(batch, cam, world, sunlight, maxDist) {
    const m = this.m;
    for (const e of this.map.values()) {
      if (!e.visible) continue;
      const ox = e.x - cam.x, oz = e.z - cam.z;
      if (ox * ox + oz * oz > maxDist * maxDist) continue;
      const feet = [ox, e.y - cam.y, oz];
      const light = lightBrightness(world.getLight(Math.floor(e.x), Math.floor(e.y + 1.2), Math.floor(e.z)), sunlight);
      const walk = Math.sin(e.walkPhase) * 0.85 * e.walkAmount;
      const swing = e.swing < 1 ? Math.sin(e.swing * Math.PI) * 1.4 : 0;
      const shirt = this.shirtLayers.get(e.shirt), arms = this.armLayers.get(e.shirt);
      // Sneaking leans the upper body forward around the hips and lowers it a little.
      const lean = e.flags & F_SNEAKING ? 0.4 : 0;
      const upper = [ox, feet[1] - (lean ? 0.1 : 0), oz];
      const onBody = (x, h) => [x, 12 + h * Math.cos(lean), -h * Math.sin(lean)]; // h pixels above the hips
      const box = (o, layers, pivot, angle, min, size) =>
        batch.cube(
          boxMatrix(m, o, e.yaw, pivot.map((v) => v * PX), angle, min.map((v) => v * PX), size.map((v) => v * PX)),
          layers,
          light,
        );
      // Right is +X in the avatar's frame (it faces -Z); positive angles swing forward/up.
      box(feet, this.legLayers, [2, 12, 0], walk, [-2, -12, -2], [4, 12, 4]);
      box(feet, this.legLayers, [-2, 12, 0], -walk, [-2, -12, -2], [4, 12, 4]);
      box(upper, shirt, [0, 12, 0], -lean, [-4, 0, -2], [8, 12, 4]);
      box(upper, arms, onBody(6, 10), -walk * 0.9 + swing + lean * 0.5, [-2, -10, -2], [4, 12, 4]);
      box(upper, arms, onBody(-6, 10), walk * 0.9 + lean * 0.5, [-2, -10, -2], [4, 12, 4]);
      box(upper, this.headLayers, onBody(0, 12), e.pitch, [-4, 0, -4], [8, 8, 8]);
    }
  }

  // Place the name tags over the heads (after the frame is rendered with `viewProj`).
  updateTags(viewProj, cam, width, height) {
    const vp = viewProj;
    for (const e of this.map.values()) {
      const tag = e.tag;
      if (!e.visible) {
        tag.hidden = true;
        continue;
      }
      const sneak = (e.flags & F_SNEAKING) !== 0;
      const x = e.x - cam.x, y = e.y + (sneak ? 1.95 : 2.1) - cam.y, z = e.z - cam.z;
      const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (w < 0.1 || Math.hypot(x, y, z) > 64) {
        tag.hidden = true;
        continue;
      }
      const sx = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w) * 0.5 + 0.5;
      const sy = 0.5 - ((vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) * 0.5;
      tag.hidden = false;
      tag.classList.toggle('sneak', sneak);
      tag.style.transform = `translate(${(sx * width).toFixed(1)}px, ${(sy * height).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
