// Touch controls: left-side joystick, drag anywhere else to look, tap to place,
// long-press to break, plus on-screen buttons.

const JOY_RADIUS = 56;
const TAP_MS = 260;
const TAP_MOVE = 12;
const HOLD_MS = 320;

const capture = (el, id) => {
  try {
    el.setPointerCapture(id);
  } catch {
    /* synthetic or already-released pointer */
  }
};

export const isTouchDevice = () =>
  ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches;

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.enabled = isTouchDevice();
    this.active = false;
    this.moveX = 0;
    this.moveZ = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.jump = false;
    this.sneak = false;
    this.joyId = null;
    this.looks = new Map();
    this.root = document.getElementById('touch');
    this.joy = document.getElementById('joy');
    this.knob = document.getElementById('joy-knob');
    if (!this.enabled) return;
    document.body.classList.add('touch-mode');

    const area = document.getElementById('touch-area');
    area.addEventListener('pointerdown', (e) => this.down(e));
    area.addEventListener('pointermove', (e) => this.moveEvt(e));
    area.addEventListener('pointerup', (e) => this.up(e));
    area.addEventListener('pointercancel', (e) => this.up(e, true));

    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(el, e.pointerId);
        on();
      });
      const end = () => off && off();
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    };
    let lastJump = 0;
    hold('t-jump', () => {
      const now = performance.now();
      if (now - lastJump < 350) this.game.toggleFly();
      lastJump = now;
      this.jump = true;
    }, () => (this.jump = false));
    hold('t-sneak', () => (this.sneak = true), () => (this.sneak = false));
    hold('t-inv', () => this.game.openInventory());
    hold('t-pause', () => this.game.pause());

    document.getElementById('hotbar').addEventListener('pointerdown', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const i = [...slot.parentNode.children].indexOf(slot);
      this.game.selectSlot(i);
    });
  }

  show(on) {
    this.active = on && this.enabled;
    if (this.root) this.root.hidden = !this.active;
    if (!this.active) this.reset();
  }

  reset() {
    this.joyId = null;
    this.looks.clear();
    this.moveX = this.moveZ = 0;
    this.jump = this.sneak = false;
    if (this.joy) this.joy.hidden = true;
  }

  down(e) {
    e.preventDefault();
    capture(e.target, e.pointerId);
    if (this.joyId === null && e.clientX < window.innerWidth * 0.4) {
      this.joyId = e.pointerId;
      this.joyOrigin = [e.clientX, e.clientY];
      this.joy.hidden = false;
      this.joy.style.left = `${e.clientX}px`;
      this.joy.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, breaking: false, next: 0 });
  }

  moveEvt(e) {
    if (e.pointerId === this.joyId) {
      let dx = e.clientX - this.joyOrigin[0], dy = e.clientY - this.joyOrigin[1];
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        dx = (dx / len) * JOY_RADIUS;
        dy = (dy / len) * JOY_RADIUS;
      }
      this.moveX = dx / JOY_RADIUS;
      this.moveZ = dy / JOY_RADIUS;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const l = this.looks.get(e.pointerId);
    if (!l) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y;
    l.x = e.clientX;
    l.y = e.clientY;
    l.moved += Math.abs(dx) + Math.abs(dy);
    this.lookDX += dx;
    this.lookDY += dy;
  }

  up(e, cancelled = false) {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.moveX = this.moveZ = 0;
      this.joy.hidden = true;
      return;
    }
    const l = this.looks.get(e.pointerId);
    if (!l) return;
    this.looks.delete(e.pointerId);
    if (!cancelled && !l.breaking && l.moved < TAP_MOVE && performance.now() - l.t < TAP_MS) this.game.useBlock();
  }

  // Called every frame while playing: long-press breaks blocks repeatedly.
  update() {
    const now = performance.now();
    for (const l of this.looks.values()) {
      if (l.moved > TAP_MOVE * 2 && !l.breaking) continue;
      if (now - l.t > HOLD_MS && now >= l.next) {
        l.breaking = true;
        l.next = now + 250;
        this.game.breakBlock();
      }
    }
  }

  consumeLook() {
    const d = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return d;
  }
}
