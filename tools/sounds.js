// Sound board: plays the game's own sound effects from src/audio.js, re-importing the file on
// every click so edits are heard at once, plus a scratch pad and an oscilloscope.

import { MOB_KINDS } from '../src/mobs.js';

const $ = (id) => document.getElementById(id);
let sound = null; // the current Sound, re-created from a fresh import on every play
let analyser = null;
let last = null; // the last thing played, for "repeat"
let timer = null;

// A Sound from the latest src/audio.js, sharing one AudioContext (browsers allow only a few).
async function fresh() {
  const mod = await import(`../src/audio.js?v=${Date.now()}`);
  const s = new mod.Sound();
  if (sound) Object.assign(s, { ctx: sound.ctx, master: sound.master, noise: sound.noise });
  s.setVolume(Number($('vol').value));
  s.ensure();
  if (!analyser && s.ctx) {
    analyser = s.ctx.createAnalyser();
    analyser.fftSize = 2048;
    s.master.connect(analyser);
    scope();
  }
  sound = s;
  return { s, mod };
}

async function play(label, fn) {
  last = { label, fn };
  try {
    const { s, mod } = await fresh();
    fn(s, mod);
    $('status').textContent = `Played ${label}`;
  } catch (err) {
    $('status').textContent = `Error: ${err.message}`;
  }
}

function button(parent, label, fn, text = label) {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = () => play(label, fn);
  parent.appendChild(b);
  return b;
}

for (const k of MOB_KINDS) {
  button($('animals'), `mob('${k}')`, (s) => s.mob(k), k);
  button($('animals'), `mobHurt('${k}')`, (s) => s.mobHurt(k), `${k} hurt`);
}
const { MATERIALS } = await import(`../src/audio.js?v=${Date.now()}`);
for (const m of Object.keys(MATERIALS)) {
  const box = document.createElement('span');
  box.className = 'mat';
  box.innerHTML = `<span>${m}</span>`;
  button(box, `blockBreak('${m}')`, (s) => s.blockBreak(m), 'break');
  button(box, `blockPlace('${m}')`, (s) => s.blockPlace(m), 'place');
  button(box, `step('${m}')`, (s) => s.step(m), 'step');
  $('blocks').appendChild(box);
}
for (const name of ['splash', 'swim', 'explosion', 'fuse', 'click', 'pop']) button($('other'), `${name}()`, (s) => s[name](), name);

// ------------------------------------------------------------ scratch pad

const EXAMPLES = {
  'A pig (like mob("pig"))': `s.tone({ freq: 230, endFreq: 150, dur: 0.16, type: 'sawtooth', gain: 0.07 });
s.tone({ freq: 210, endFreq: 140, dur: 0.14, type: 'sawtooth', gain: 0.06, delay: 0.2 });`,
  'A cow (like mob("cow"))': `s.tone({ freq: 160, endFreq: 110, dur: 0.9, type: 'sawtooth', gain: 0.08 });
s.burst({ freq: 400, type: 'lowpass', q: 0.6, dur: 0.8, gain: 0.05 });`,
  'Lower, longer moo': `// Two oscillators a little out of tune sound fuller.
s.tone({ freq: 130, endFreq: 95, dur: 1.2, type: 'sawtooth', gain: 0.07 });
s.tone({ freq: 132, endFreq: 97, dur: 1.2, type: 'sawtooth', gain: 0.05 });
s.burst({ freq: 350, type: 'lowpass', q: 0.7, dur: 1.1, gain: 0.05 });`,
  'Sheep bleat': `for (let i = 0; i < 4; i++)
  s.tone({ freq: 420 - i * 15, endFreq: 380 - i * 15, dur: 0.12, type: 'triangle', gain: 0.07, delay: i * 0.1 });`,
  'Noise sweep': `s.burst({ freq: 3000, type: 'lowpass', q: 0.8, dur: 0.8, gain: 0.4, sweepTo: 200 });`,
};
for (const name of Object.keys(EXAMPLES)) $('examples').add(new Option(name, name));
const saved = (() => { try { return localStorage.getItem('blockcraft-tools:pad'); } catch { return null; } })();
$('pad').value = saved || EXAMPLES[Object.keys(EXAMPLES)[0]];
$('examples').onchange = () => ($('pad').value = EXAMPLES[$('examples').value]);

function runPad() {
  const code = $('pad').value;
  try { localStorage.setItem('blockcraft-tools:pad', code); } catch { /* storage blocked */ }
  $('err').textContent = '';
  let fn;
  try {
    fn = new Function('s', code);
  } catch (err) {
    $('err').textContent = err.message;
    return;
  }
  play('scratch pad', (s) => {
    try {
      fn(s);
    } catch (err) {
      $('err').textContent = err.message;
    }
  });
}
$('play').onclick = runPad;
$('pad').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runPad();
  }
});

// ------------------------------------------------------------ repeat, volume, scope

function schedule() {
  clearTimeout(timer);
  if (!$('loop').checked) return;
  timer = setTimeout(async () => {
    if (last) await play(last.label, last.fn);
    schedule();
  }, Math.max(300, Number($('every').value) * 1000));
}
$('loop').onchange = schedule;
$('vol').oninput = () => sound?.setVolume(Number($('vol').value));

function scope() {
  const c = $('scope'), ctx = c.getContext('2d');
  const data = new Uint8Array(analyser.fftSize);
  const draw = () => {
    analyser.getByteTimeDomainData(data);
    ctx.fillStyle = '#111316';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#6fbf5a';
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * c.width, y = (data[i] / 255) * c.height;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    requestAnimationFrame(draw);
  };
  draw();
}
