// The server's mobs as this client sees them: smoothed towards the latest update.

import { MOB_KINDS, animateWalk } from '../mobs.js';

const HURT_TIME = 0.4;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class RemoteMobs {
  constructor(onHurt = () => {}) {
    this.map = new Map();
    this.onHurt = onHurt;
  }

  // states: [[id, kind index, x, y, z, yaw, hurt (0/1)], ...]
  apply(states) {
    for (const s of states) {
      if (!Array.isArray(s) || s.length < 7) continue;
      const [id, k, x, y, z, yaw, hurt] = s;
      const kind = MOB_KINDS[k];
      if (!kind || ![x, y, z, yaw].every(Number.isFinite)) continue;
      let e = this.map.get(id);
      if (!e) {
        e = { id, kind, x, y, z, yaw, hurt: 0, hurtFlag: 0 };
        this.map.set(id, e);
      }
      e.tx = x;
      e.ty = y;
      e.tz = z;
      e.tyaw = yaw;
      if (hurt && !e.hurtFlag) {
        e.hurt = HURT_TIME;
        this.onHurt(e);
      }
      e.hurtFlag = hurt;
    }
  }

  // Returns the removed mob, if it was known.
  remove(id) {
    const e = this.map.get(id);
    this.map.delete(id);
    return e || null;
  }

  update(dt) {
    const a = Math.min(1, dt * 10);
    for (const e of this.map.values()) {
      if (e.tx === undefined) continue;
      const ox = e.x, oz = e.z;
      e.x += (e.tx - e.x) * a;
      e.y += (e.ty - e.y) * a;
      e.z += (e.tz - e.z) * a;
      e.yaw = lerpAngle(e.yaw, e.tyaw, a);
      if (e.hurt > 0) e.hurt -= dt;
      animateWalk(e, dt, Math.hypot(e.x - ox, e.z - oz));
    }
  }

  values() {
    return this.map.values();
  }

  clear() {
    this.map.clear();
  }
}
