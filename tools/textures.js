// Texture viewer and pixel editor. Paints every texture with the game's own painters
// (src/textures.js, re-imported on reload) and draws the mobs from src/mobrender.js models.

import { BLOCKS, MODEL, allTextureNames, faceTextureNames } from '../src/blocks.js';
import { MOB_TEXTURES, MOB_MODELS } from '../src/mobrender.js';
import { AVATAR_TEXTURES } from '../src/net/players.js';

const $ = (id) => document.getElementById(id);
const SIZE = 16;

let painter = null; // the current src/textures.js module
let source = ''; // its text, to notice changes
const painted = new Map(); // name -> RGBA pixels as the code paints them
const edits = new Map(); // name -> RGBA pixels edited on this page
let selected = null;
let tool = 'pen';
const undo = [];

const pixels = (name) => edits.get(name) || painted.get(name);

// Which blocks and mobs use each texture, for the "used by" line.
const usedBy = new Map();
const use = (name, what) => {
  if (!usedBy.has(name)) usedBy.set(name, new Set());
  usedBy.get(name).add(what);
};
for (const b of BLOCKS) {
  for (const n of faceTextureNames(b) || []) use(n, b.key);
  for (const p of MODEL[b.id]?.parts || []) for (const n of p.tex) use(n, b.key);
}
for (const [kind, parts] of Object.entries(MOB_MODELS)) for (const [tex] of parts) for (const n of tex) use(n, kind);

const GROUPS = [
  ['Mobs', MOB_TEXTURES],
  ['Blocks and items', allTextureNames()],
  ['Player avatars (multiplayer)', AVATAR_TEXTURES],
];

// ------------------------------------------------------------ loading

async function load(reason) {
  const t0 = performance.now();
  painter = await import(`../src/textures.js?v=${Date.now()}`);
  for (const [, names] of GROUPS) for (const n of names) painted.set(n, painter.paintTexture(n));
  $('status').textContent = `${reason} at ${new Date().toLocaleTimeString()} (${Math.round(performance.now() - t0)} ms)`;
  drawAll();
}

async function poll() {
  if ($('auto').checked) {
    try {
      const text = await (await fetch('../src/textures.js', { cache: 'no-store' })).text();
      if (source && text !== source) await load('Reloaded after an edit');
      source = text;
    } catch (err) {
      $('status').textContent = `Reload failed: ${err.message}`;
    }
  }
  setTimeout(poll, 1000);
}

// ------------------------------------------------------------ drawing

const tileCanvas = new Map();
function toCanvas(data, scale = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE * scale;
  paintCanvas(c, data);
  return c;
}
const scratch = document.createElement('canvas');
scratch.width = scratch.height = SIZE;
function paintCanvas(c, data) {
  scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), SIZE, SIZE), 0, 0);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(scratch, 0, 0, c.width, c.height);
}

function drawAll() {
  const groups = $('groups');
  if (!groups.children.length) {
    for (const [title, names] of GROUPS) {
      const h = document.createElement('h2');
      h.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const n of names) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.name = n;
        const c = document.createElement('canvas');
        c.width = c.height = SIZE;
        c.className = 'pix';
        const label = document.createElement('span');
        label.textContent = n;
        tile.append(c, label);
        tile.onclick = () => select(n);
        tileCanvas.set(n, c);
        grid.appendChild(tile);
      }
      groups.append(h, grid);
    }
  }
  for (const [n, c] of tileCanvas) {
    paintCanvas(c, pixels(n));
    c.parentElement.classList.toggle('edited', edits.has(n));
  }
  drawMobs();
  drawBig();
  applyFilter();
}

function applyFilter() {
  const q = $('filter').value.trim().toLowerCase();
  for (const tile of document.querySelectorAll('.tile')) {
    const n = tile.dataset.name;
    const users = [...(usedBy.get(n) || [])].join(' ');
    tile.hidden = q && !n.includes(q) && !users.includes(q);
  }
}

// Orthographic views of a mob model. Each box face shows the whole 16x16 tile stretched over
// it, exactly like batch.cube() does in the game. Face order: +X, -X, +Y, -Y, +Z, -Z (front).
const PX = 6;
function drawMobs() {
  const root = $('mobs');
  root.innerHTML = '';
  for (const [kind, parts] of Object.entries(MOB_MODELS)) {
    const boxes = parts.map(([tex, pivot, min, size]) => ({ tex, min: [pivot[0] + min[0], pivot[1] + min[1], pivot[2] + min[2]], size }));
    const lo = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a])));
    const hi = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.min[a] + b.size[a])));
    const view = (title, face, hAxis, vAxis, depthAxis, nearIsLow, flipH, flipV) => {
      const w = (hi[hAxis] - lo[hAxis]) * PX + 8, h = (hi[vAxis] - lo[vAxis]) * PX + 8;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      // Far boxes first so near ones cover them.
      const order = [...boxes].sort((a, b) => (nearIsLow ? b.min[depthAxis] - a.min[depthAxis] : a.min[depthAxis] + a.size[depthAxis] - (b.min[depthAxis] + b.size[depthAxis])));
      for (const b of order) {
        let x = (b.min[hAxis] - lo[hAxis]) * PX, y = (b.min[vAxis] - lo[vAxis]) * PX;
        const bw = b.size[hAxis] * PX, bh = b.size[vAxis] * PX;
        if (flipH) x = w - 8 - x - bw;
        if (flipV) y = h - 8 - y - bh;
        ctx.drawImage(toCanvas(pixels(b.tex[face])), x + 4, y + 4, bw, bh);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.strokeRect(x + 4.5, y + 4.5, bw - 1, bh - 1);
      }
      const fig = document.createElement('figure');
      fig.style.margin = 0;
      const cap = document.createElement('figcaption');
      cap.textContent = title;
      fig.append(c, cap);
      return fig;
    };
    const box = document.createElement('div');
    box.className = 'mob';
    const views = document.createElement('div');
    views.className = 'views';
    views.append(
      // Front: looking at the -Z faces from the front, so +X is on the viewer's left.
      view('front', 5, 0, 1, 2, true, true, true),
      // Side: the +X faces, front of the mob on the left.
      view('side', 0, 2, 1, 0, false, false, true),
      // Top: the +Y faces, front at the top.
      view('top', 2, 0, 2, 1, false, false, false),
    );
    const name = document.createElement('b');
    name.textContent = kind;
    box.append(name, views);
    root.appendChild(box);
  }
}

// ------------------------------------------------------------ editor

function select(name) {
  selected = name;
  undo.length = 0;
  for (const t of document.querySelectorAll('.tile')) t.classList.toggle('sel', t.dataset.name === name);
  $('name').textContent = name;
  $('where').textContent = usedBy.has(name) ? `used by ${[...usedBy.get(name)].slice(0, 4).join(', ')}${usedBy.get(name).size > 4 ? '…' : ''}` : '';
  $('code').value = '';
  drawBig();
}

function drawBig() {
  const c = $('big'), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!selected) return;
  paintCanvas(c, pixels(selected));
  const s = c.width / SIZE;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let i = 1; i < SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * s + 0.5, 0);
    ctx.lineTo(i * s + 0.5, c.height);
    ctx.moveTo(0, i * s + 0.5);
    ctx.lineTo(c.width, i * s + 0.5);
    ctx.stroke();
  }
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
function cellAt(e) {
  const r = $('big').getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE), y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE ? [x, y] : null;
}

let drawing = false;
function paintAt(e) {
  const cell = cellAt(e);
  if (!cell || !selected) return;
  const [x, y] = cell;
  const i = (y * SIZE + x) * 4;
  if (tool === 'pick') {
    const d = pixels(selected);
    $('color').value = hex(d[i], d[i + 1], d[i + 2]);
    return;
  }
  if (!edits.has(selected)) edits.set(selected, new Uint8ClampedArray(painted.get(selected)));
  const d = edits.get(selected);
  if (tool === 'erase') d[i + 3] = 0;
  else {
    const v = $('color').value;
    d[i] = parseInt(v.slice(1, 3), 16);
    d[i + 1] = parseInt(v.slice(3, 5), 16);
    d[i + 2] = parseInt(v.slice(5, 7), 16);
    d[i + 3] = 255;
  }
  drawAll();
}

$('big').addEventListener('pointerdown', (e) => {
  if (!selected) return;
  if (tool !== 'pick') undo.push(new Uint8ClampedArray(pixels(selected)));
  drawing = true;
  $('big').setPointerCapture(e.pointerId);
  paintAt(e);
});
$('big').addEventListener('pointermove', (e) => {
  const cell = cellAt(e);
  if (cell && selected) {
    const d = pixels(selected), i = (cell[1] * SIZE + cell[0]) * 4;
    $('info').textContent = `x ${cell[0]}, y ${cell[1]}   rgba(${d[i]}, ${d[i + 1]}, ${d[i + 2]}, ${d[i + 3]})   t.set(${cell[0]}, ${cell[1]}, [${d[i]}, ${d[i + 1]}, ${d[i + 2]}])`;
  }
  if (drawing && tool !== 'pick') paintAt(e);
});
$('big').addEventListener('pointerup', () => (drawing = false));

for (const b of document.querySelectorAll('[data-tool]'))
  b.onclick = () => {
    tool = b.dataset.tool;
    for (const o of document.querySelectorAll('[data-tool]')) o.classList.toggle('on', o === b);
  };
$('undo').onclick = () => {
  if (!selected || !undo.length) return;
  edits.set(selected, undo.pop());
  drawAll();
};
$('revert').onclick = () => {
  if (!selected) return;
  edits.delete(selected);
  undo.length = 0;
  drawAll();
};
$('png').onclick = () => {
  if (!selected) return;
  const a = document.createElement('a');
  a.href = toCanvas(pixels(selected), 16).toDataURL();
  a.download = `${selected}.png`;
  a.click();
};

// Code for src/textures.js that paints exactly these pixels: palette rows when there are few
// enough colours (easy to edit by hand), raw base64 otherwise.
const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function painterCode(name, d) {
  const colors = new Map();
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    let row = '';
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (d[i + 3] < 128) {
        row += '.';
        continue;
      }
      const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      if (!colors.has(key)) colors.set(key, KEYS[colors.size] ?? null);
      row += colors.get(key) ?? '?';
    }
    rows.push(row);
  }
  const id = /^[a-z_$][\w$]*$/i.test(name) ? `PAINTERS.${name}` : `PAINTERS[${JSON.stringify(name)}]`;
  if (colors.size <= KEYS.length) {
    const pal = [...colors].map(([rgb, k]) => `  ${k}: [${rgb.replace(/,/g, ', ')}],`).join('\n');
    return `${id} = (t) => pixelArt(t, {\n${pal}\n}, [\n${rows.map((r) => `  '${r}',`).join('\n')}\n]);\n`;
  }
  let bin = '';
  for (const v of d) bin += String.fromCharCode(v);
  return `${id} = (t) => pixelData(t, '${btoa(bin)}');\n`;
}

$('export').onclick = async () => {
  if (!selected) return;
  const code = painterCode(selected, pixels(selected));
  $('code').value = code;
  try {
    await navigator.clipboard.writeText(code);
    $('status').textContent = 'Painter code copied to the clipboard';
  } catch {
    $('code').select();
  }
};

$('filter').oninput = applyFilter;
$('reload').onclick = () => load('Reloaded');

await load('Loaded');
source = await (await fetch('../src/textures.js', { cache: 'no-store' })).text();
select(new URLSearchParams(location.search).get('t') || 'cow_hide');
poll();
