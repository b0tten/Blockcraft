// Keyboard, mouse and pointer-lock handling.

const GAME_KEYS = new Set(['Space', 'Tab', 'F1', 'F3', 'Slash', 'KeyE', 'ArrowUp', 'ArrowDown', 'Quote']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = [false, false, false];
    this.clicked = [false, false, false];
    this.wheel = 0;
    this.locked = false;
    this.enabled = false; // true while in-game (not in a menu)
    this.onLockChange = null;
    this.lastKeyTime = {};
    this.doubleTapped = new Set();

    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (this.enabled && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      const now = performance.now();
      if (now - (this.lastKeyTime[e.code] || 0) < 280) this.doubleTapped.add(e.code);
      this.lastKeyTime[e.code] = now;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons = [false, false, false];
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.clicked[e.button] = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    document.addEventListener('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.buttons = [false, false, false];
        this.keys.clear();
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  requestLock() {
    const c = this.canvas;
    try {
      const r = c.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) {
        r.catch(() => {
          try {
            const r2 = c.requestPointerLock();
            if (r2 && r2.catch) r2.catch(() => {});
          } catch {
            /* ignored: user must click again */
          }
        });
      }
    } catch {
      try {
        c.requestPointerLock();
      } catch {
        /* ignored */
      }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  wasDoubleTapped(code) {
    return this.doubleTapped.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.doubleTapped.clear();
    this.clicked[0] = this.clicked[1] = this.clicked[2] = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
