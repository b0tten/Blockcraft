// First-person player: movement, gravity, swimming, flying and AABB collision against voxels.

import { B, CLIMB } from './blocks.js';

const HALF_W = 0.3;
const HEIGHT = 1.8;
const EPS = 1e-4;

const GRAVITY = 28;
const JUMP_VELOCITY = 8.4;
const WALK = 4.317;
const SPRINT = 5.612;
const SNEAK = 1.31;
const FLY = 10.9;
const FLY_SPRINT = 21.8;
const CLIMB_SPEED = 2.4;
const LADDER_FALL = 3;

export class Player {
  constructor() {
    this.pos = [0.5, 80, 0.5];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.inWater = false;
    this.inLava = false;
    this.headInWater = false;
    this.eyeOffset = 1.62;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.stepAccum = 0;
    this.fallSpeed = 0;
    this.onLadder = false;
    this.hitWall = false;
  }

  get eye() {
    return [this.pos[0], this.pos[1] + this.eyeOffset, this.pos[2]];
  }

  // Returns a list of events ('step', 'land', 'splash', 'jump') for sounds.
  update(dt, input, world) {
    const events = [];
    const p = this.pos, v = this.vel;
    // Hold still until the chunk we're in has been generated.
    if (!world.isReady(Math.floor(p[0] / 16), Math.floor(p[2] / 16))) {
      v[0] = v[1] = v[2] = 0;
      return events;
    }

    // Movement intent in local space.
    let fx = 0, fz = 0;
    if (input.ax || input.az) {
      fx = input.ax;
      fz = input.az;
    } else {
      if (input.forward) fz -= 1;
      if (input.back) fz += 1;
      if (input.left) fx -= 1;
      if (input.right) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const wx = fx * cy + fz * sy;
    const wz = -fx * sy + fz * cy;

    this.sneaking = input.sneak && !this.flying;
    if (!input.forward || this.sneaking || (this.inWater && !this.flying && !input.sprint && !this.sprinting)) this.sprinting = false;
    if (input.sprint && input.forward && !this.sneaking) this.sprinting = true;

    const wasInWater = this.inWater;
    this.checkLiquids(world);
    this.onLadder = !this.flying && this.touchingLadder(world);
    if (this.inWater && !wasInWater && v[1] < -4) events.push('splash');

    if (this.flying) {
      const speed = this.sprinting ? FLY_SPRINT : FLY;
      const k = Math.min(1, dt * 10);
      v[0] += (wx * speed - v[0]) * k;
      v[2] += (wz * speed - v[2]) * k;
      const vy = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      v[1] += (vy * 8 - v[1]) * k;
    } else if (this.inWater || this.inLava) {
      const speed = this.inLava ? 1.2 : this.sprinting ? 3.6 : 2.3;
      const k = Math.min(1, dt * 6);
      v[0] += (wx * speed - v[0]) * k;
      v[2] += (wz * speed - v[2]) * k;
      v[1] -= (this.inLava ? 6 : 9) * dt;
      v[1] *= Math.max(0, 1 - dt * 2.5);
      if (input.jump) v[1] = Math.min(v[1] + 26 * dt, this.canClimbOut(world) ? 6.5 : 3);
      if (input.sneak) v[1] = Math.max(v[1] - 20 * dt, -4);
      v[1] = Math.max(v[1], -4);
    } else {
      const speed = this.sneaking ? SNEAK : this.sprinting ? SPRINT : WALK;
      const k = Math.min(1, dt * (this.onGround ? 14 : 2.5));
      v[0] += (wx * speed - v[0]) * k;
      v[2] += (wz * speed - v[2]) * k;
      v[1] -= GRAVITY * dt;
      if (v[1] < -60) v[1] = -60;
      if (input.jump && this.onGround && !this.onLadder) {
        v[1] = JUMP_VELOCITY;
        events.push('jump');
      }
      if (this.onLadder) {
        // Climb by pushing into the ladder or holding jump; sneaking holds on.
        if (input.jump || (this.hitWall && (input.forward || input.az < -0.25))) v[1] = CLIMB_SPEED;
        else if (input.sneak) v[1] = Math.max(v[1], 0);
        v[1] = Math.max(v[1], -LADDER_FALL);
      }
    }

    // Integrate with collision, in small steps to avoid tunnelling.
    const wasOnGround = this.onGround;
    const fallV = v[1];
    const maxMove = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) * dt;
    const steps = Math.max(1, Math.ceil(maxMove / 0.35));
    const sdt = dt / steps;
    this.onGround = false;
    this.hitWall = false;
    for (let s = 0; s < steps; s++) {
      if (this.moveAxis(world, 1, v[1] * sdt)) {
        if (v[1] < 0) this.onGround = true;
        v[1] = 0;
      }
      const guard = this.sneaking && (wasOnGround || this.onGround);
      for (const axis of [0, 2]) {
        const before = p[axis];
        if (this.moveAxis(world, axis, v[axis] * sdt)) {
          v[axis] = 0;
          this.hitWall = true;
        }
        else if (guard && !this.groundBelow(world)) {
          p[axis] = before;
          v[axis] = 0;
        }
      }
    }
    if (!this.onGround && this.touchingGround(world) && v[1] <= 0) this.onGround = true;
    if (this.flying && this.onGround && input.sneak) this.flying = false;

    if (this.onGround && !wasOnGround && fallV < -9) events.push('land');

    // Footsteps and view bob.
    const hs = Math.hypot(v[0], v[2]);
    if (this.onGround && !this.flying && hs > 0.5) {
      this.stepAccum += hs * dt;
      this.bobPhase += hs * dt * 1.6;
      this.bobAmount = Math.min(1, this.bobAmount + dt * 4);
      if (this.stepAccum > 2.1) {
        this.stepAccum = 0;
        events.push('step');
      }
    } else {
      this.bobAmount = Math.max(0, this.bobAmount - dt * 4);
    }
    if (this.inWater && hs > 0.5) {
      this.stepAccum += hs * dt;
      if (this.stepAccum > 3) {
        this.stepAccum = 0;
        events.push('swim');
      }
    }

    const target = this.sneaking ? 1.32 : 1.62;
    this.eyeOffset += (target - this.eyeOffset) * Math.min(1, dt * 12);

    const eye = this.eye;
    const eb = world.getBlock(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2]));
    this.headInWater = eb === B.water && eye[1] - Math.floor(eye[1]) < 0.9;
    this.headInLava = eb === B.lava;
    return events;
  }

  checkLiquids(world) {
    const p = this.pos;
    const x = Math.floor(p[0]), z = Math.floor(p[2]);
    const feet = world.getBlock(x, Math.floor(p[1] + 0.1), z);
    const mid = world.getBlock(x, Math.floor(p[1] + 0.9), z);
    this.inWater = feet === B.water || mid === B.water;
    this.inLava = feet === B.lava || mid === B.lava;
  }

  canClimbOut(world) {
    // Near a ledge while swimming at the surface: allow a bigger push up.
    const p = this.pos;
    const y = Math.floor(p[1] + 0.5);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (world.isSolid(Math.floor(p[0] + dx * 0.45), y, Math.floor(p[2] + dz * 0.45))) return true;
    }
    return false;
  }

  // Does the box overlap any block's collision box?
  aabbHits(world, minX, minY, minZ, maxX, maxY, maxZ) {
    for (let y = Math.floor(minY); y <= Math.floor(maxY - EPS); y++)
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ - EPS); z++)
        for (let x = Math.floor(minX); x <= Math.floor(maxX - EPS); x++) {
          const boxes = world.boxesAt(x, y, z);
          if (!boxes) continue;
          for (const b of boxes)
            if (x + b[0] < maxX && x + b[3] > minX && y + b[1] < maxY && y + b[4] > minY && z + b[2] < maxZ && z + b[5] > minZ) return true;
        }
    return false;
  }

  // Move along one axis and stop at the first collision box ahead. Boxes the player already
  // overlaps are ignored, so you can always move out of a block.
  moveAxis(world, axis, amount) {
    if (amount === 0) return false;
    const p = this.pos;
    const min = [p[0] - HALF_W, p[1], p[2] - HALF_W];
    const max = [p[0] + HALF_W, p[1] + HEIGHT, p[2] + HALF_W];
    const lo = [...min], hi = [...max];
    if (amount > 0) hi[axis] += amount;
    else lo[axis] += amount;
    const a1 = axis === 0 ? 1 : 0, a2 = axis === 2 ? 1 : 2;
    let move = amount;
    const v = [0, 0, 0];
    for (let y = Math.floor(lo[1]); y <= Math.floor(hi[1]); y++)
      for (let z = Math.floor(lo[2]); z <= Math.floor(hi[2]); z++)
        for (let x = Math.floor(lo[0]); x <= Math.floor(hi[0]); x++) {
          const boxes = world.boxesAt(x, y, z);
          if (!boxes) continue;
          v[0] = x;
          v[1] = y;
          v[2] = z;
          for (const b of boxes) {
            const b1 = v[a1] + b[a1], e1 = v[a1] + b[a1 + 3];
            const b2 = v[a2] + b[a2], e2 = v[a2] + b[a2 + 3];
            if (b1 >= max[a1] - EPS || e1 <= min[a1] + EPS || b2 >= max[a2] - EPS || e2 <= min[a2] + EPS) continue;
            if (amount > 0) {
              const face = v[axis] + b[axis];
              if (face >= max[axis] - EPS) move = Math.min(move, Math.max(0, face - max[axis] - EPS));
            } else {
              const face = v[axis] + b[axis + 3];
              if (face <= min[axis] + EPS) move = Math.max(move, Math.min(0, face - min[axis] + EPS));
            }
          }
        }
    p[axis] += move;
    return move !== amount;
  }

  touchingLadder(world) {
    const p = this.pos;
    for (const dy of [0.1, 0.9]) if (CLIMB[world.getBlock(Math.floor(p[0]), Math.floor(p[1] + dy), Math.floor(p[2]))]) return true;
    return false;
  }

  groundBelow(world) {
    const p = this.pos;
    return this.aabbHits(world, p[0] - HALF_W, p[1] - 0.1, p[2] - HALF_W, p[0] + HALF_W, p[1], p[2] + HALF_W);
  }

  touchingGround(world) {
    const p = this.pos;
    return this.aabbHits(world, p[0] - HALF_W, p[1] - 0.02, p[2] - HALF_W, p[0] + HALF_W, p[1], p[2] + HALF_W);
  }

  // Would collision boxes placed at block (x, y, z) overlap the player?
  intersectsBoxes(boxes, x, y, z) {
    const p = this.pos;
    return boxes.some((b) => p[0] + HALF_W > x + b[0] && p[0] - HALF_W < x + b[3] && p[1] + HEIGHT > y + b[1] && p[1] < y + b[4] && p[2] + HALF_W > z + b[2] && p[2] - HALF_W < z + b[5]);
  }

  blockUnderFeet(world) {
    const p = this.pos;
    return world.getBlock(Math.floor(p[0]), Math.floor(p[1] - 0.05), Math.floor(p[2]));
  }
}

