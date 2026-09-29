// Tiny synthesiser for block, step and explosion sounds (Web Audio, no sample files).

const MATERIALS = {
  stone: { freq: 1500, q: 0.9, type: 'bandpass' },
  wood: { freq: 650, q: 1.6, type: 'bandpass' },
  grass: { freq: 2600, q: 0.5, type: 'bandpass' },
  gravel: { freq: 950, q: 0.6, type: 'bandpass' },
  sand: { freq: 2200, q: 0.35, type: 'bandpass' },
  snow: { freq: 3200, q: 0.4, type: 'bandpass' },
  cloth: { freq: 1100, q: 0.4, type: 'lowpass' },
  plant: { freq: 3600, q: 0.6, type: 'bandpass' },
  glass: { freq: 3000, q: 1.2, type: 'bandpass' },
  water: { freq: 700, q: 0.5, type: 'lowpass' },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  burst({ freq, q = 1, type = 'bandpass', dur = 0.2, gain = 0.4, attack = 0.004, delay = 0, rate = 1, sweepTo = 0 }) {
    const ctx = this.ensure();
    if (!ctx || this.volume <= 0) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq * (0.9 + Math.random() * 0.2), t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone({ freq, endFreq = freq, dur = 0.1, type = 'sine', gain = 0.2, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx || this.volume <= 0) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  blockBreak(material) {
    const m = MATERIALS[material] || MATERIALS.stone;
    if (material === 'glass') {
      this.burst({ freq: 4000, q: 0.7, type: 'highpass', dur: 0.25, gain: 0.25 });
      for (let i = 0; i < 5; i++) this.tone({ freq: 2500 + Math.random() * 3000, dur: 0.06, gain: 0.05, delay: i * 0.03 + Math.random() * 0.02 });
      return;
    }
    this.burst({ ...m, dur: 0.22, gain: 0.5 });
    this.burst({ ...m, freq: m.freq * 0.7, dur: 0.16, gain: 0.3, delay: 0.035 });
  }

  blockPlace(material) {
    const m = MATERIALS[material] || MATERIALS.stone;
    this.burst({ ...m, freq: m.freq * 0.85, dur: 0.13, gain: 0.42 });
  }

  step(material) {
    const m = MATERIALS[material] || MATERIALS.stone;
    this.burst({ ...m, dur: 0.09, gain: 0.13 });
  }

  splash() {
    this.burst({ freq: 1800, type: 'lowpass', q: 0.5, dur: 0.6, gain: 0.45, sweepTo: 300 });
  }

  swim() {
    this.burst({ freq: 900, type: 'lowpass', q: 0.4, dur: 0.35, gain: 0.12 });
  }

  explosion() {
    this.burst({ freq: 900, type: 'lowpass', q: 0.7, dur: 1.8, gain: 1.0, attack: 0.01, rate: 0.5, sweepTo: 80 });
    this.tone({ freq: 90, endFreq: 30, dur: 0.9, type: 'sine', gain: 0.6 });
  }

  fuse() {
    this.burst({ freq: 5000, type: 'highpass', q: 0.4, dur: 1.2, gain: 0.12, attack: 0.05 });
  }

  click() {
    this.tone({ freq: 900, endFreq: 700, dur: 0.05, type: 'square', gain: 0.05 });
  }

  pop() {
    this.tone({ freq: 500, endFreq: 1100, dur: 0.08, type: 'sine', gain: 0.1 });
  }
}
