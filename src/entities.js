// Primed TNT and explosions.

import { B, FACE_TEX } from './blocks.js';
import { modelMatrix } from './math.js';
import { lightBrightness } from './sky.js';

export class PrimedTNT {
  constructor(x, y, z, fuse = 4) {
    this.x = x + 0.5;
    this.y = y;
    this.z = z + 0.5;
    this.vy = 3;
    this.fuse = fuse;
    this.total = fuse;
  }

  // Returns true when it should explode.
  update(dt, world) {
    this.vy -= 22 * dt;
    let ny = this.y + this.vy * dt;
    if (this.vy < 0 && world.isSolid(Math.floor(this.x), Math.floor(ny), Math.floor(this.z))) {
      ny = Math.floor(ny) + 1;
      this.vy = 0;
    }
    this.y = ny;
    this.fuse -= dt;
    return this.fuse <= 0;
  }

  draw(batch, cam, world, sunlight) {
    const m = new Float32Array(16);
    const grow = this.fuse < 0.4 ? 1 + (0.4 - this.fuse) * 0.35 : 1;
    // Unit cube centred on x/z, sitting on y.
    modelMatrix(m, this.x - cam.x - 0.5 * grow, this.y - cam.y, this.z - cam.z - 0.5 * grow, 0, 0, 0, grow);
    const layers = [];
    for (let f = 0; f < 6; f++) layers.push(FACE_TEX[B.tnt * 6 + f]);
    const flash = Math.floor(this.fuse * 4) % 2 === 0 ? 0.55 : 0;
    const light = lightBrightness(world.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z)), sunlight);
    batch.cube(m, layers, light, flash);
  }
}

const UNBREAKABLE = new Set([B.bedrock, B.obsidian, B.water, B.lava]);

// Work out a roughly spherical hole without changing the world: `list` is the blocks to
// clear, `chain` the TNT blocks it sets off, `debris` a few blocks to show particles for.
export function blast(world, x, y, z, radius = 4) {
  const list = [];
  const chain = [];
  const debris = [];
  const r = Math.ceil(radius);
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  for (let dy = -r; dy <= r; dy++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy, dz);
        if (d > radius - Math.random() * 1.3) continue;
        const bx = ix + dx, by = iy + dy, bz = iz + dz;
        const b = world.getBlock(bx, by, bz);
        if (b === 0 || UNBREAKABLE.has(b)) continue;
        if (b === B.tnt) chain.push([bx, by, bz]);
        else if (Math.random() < 0.08 && debris.length < 24) debris.push([bx, by, bz, b]);
        list.push([bx, by, bz, 0]);
      }
  return { list, chain, debris };
}

// Singleplayer explosion: change the world, then show it.
export function explode(game, x, y, z, radius = 4) {
  const { list, chain, debris } = blast(game.world, x, y, z, radius);
  game.world.setBlocks(list);
  for (const [bx, by, bz] of list) game.fluids.notifyRemoved(bx, by, bz);
  for (const [bx, by, bz] of chain) game.entities.push(new PrimedTNT(bx, by, bz, 0.4 + Math.random() * 0.9));
  explosionEffects(game, x, y, z, radius, debris);
}

// Particles, sound, knockback and screen shake (the world has already changed).
export function explosionEffects(game, x, y, z, radius, debris) {
  const ix = Math.floor(x), iz = Math.floor(z);
  for (const [bx, by, bz, b] of debris) game.particles.blockBreak(bx, by, bz, b, 2);
  game.particles.smoke(x, y, z, 40, radius * 0.6);
  game.sound.explosion();

  // Knock the player back.
  const p = game.player;
  const px = p.pos[0], py = p.pos[1] + 0.9, pz = p.pos[2];
  const dist = Math.hypot(px - x, py - y, pz - z);
  const reach = radius * 2;
  if (dist < reach) {
    const k = (1 - dist / reach) * 22;
    const nx = (px - x) / (dist || 1), ny = (py - y) / (dist || 1), nz = (pz - z) / (dist || 1);
    p.vel[0] += nx * k;
    p.vel[1] += Math.max(ny, 0.3) * k * 0.7;
    p.vel[2] += nz * k;
  }
  game.shake = Math.min(1, (game.shake || 0) + Math.max(0, 1 - dist / 32));
  game.world.flushNear(ix, iz);
}
