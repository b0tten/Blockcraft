// Structure viewer: generates the chunks around a planned structure with the game's own
// generator, and shows them layer by layer. src/world/structures.js is re-imported on change.

import { TerrainGenerator } from '../src/world/generator.js';
import { BLOCKS, faceTextureNames, MODEL } from '../src/blocks.js';
import { paintTexture } from '../src/textures.js';
import { parseSeed } from '../src/storage.js';
import { WORLD_HEIGHT as H } from '../src/constants.js';

const $ = (id) => document.getElementById(id);
const PX = 10; // screen pixels per block
let mod = null; // the current structures.js module
let source = '';
let plan = null;
let area = null; // { x0, z0, w, d, get(x, y, z) }

// Average colour of each block's top texture, for the map.
const colorOf = new Map();
function blockColor(id) {
  if (colorOf.has(id)) return colorOf.get(id);
  const b = BLOCKS[id];
  const name = faceTextureNames(b)?.[2] || MODEL[id]?.parts[0]?.tex[2];
  let c = [255, 0, 255];
  if (name) {
    const d = paintTexture(name);
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    if (n) c = [r / n, g / n, bl / n];
  }
  colorOf.set(id, c);
  return c;
}

async function loadModule() {
  mod = await import(`../src/world/structures.js?v=${Date.now()}`);
}

function generator() {
  // A version-1 generator with this page's (freshly imported) structures plugged in, so
  // edits to structures.js show up without reloading the generator module.
  const gen = new TerrainGenerator(parseSeed($('seed').value), 1);
  gen.version = 2;
  gen.structures = new mod.Structures(gen);
  return gen;
}

function nearest(gen, kind, x, z, n = 8) {
  const out = [];
  const seen = new Set();
  for (let r = 0; r <= 10 && out.length < n; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const rx = Math.floor(x / 128) + dx, rz = Math.floor(z / 128) + dz;
        const p = gen.structures.plan(rx, rz);
        if (!p || p.kind !== kind || seen.has(`${rx},${rz}`)) continue;
        seen.add(`${rx},${rz}`);
        out.push({ p, d: Math.hypot(p.x - x, p.z - z) });
      }
  return out.sort((a, b) => a.d - b.d).slice(0, n);
}

async function find(keep) {
  const t0 = performance.now();
  await loadModule();
  const gen = generator();
  const list = nearest(gen, $('kind').value, Number($('nx').value) || 0, Number($('nz').value) || 0);
  $('list').innerHTML = '';
  if (!list.length) {
    $('status').textContent = 'None found within 10 regions';
    return;
  }
  let pick = list[0].p;
  if (keep && plan) pick = list.find((e) => e.p.x === plan.x && e.p.z === plan.z)?.p || pick;
  for (const { p, d } of list) {
    const b = document.createElement('button');
    b.textContent = `${p.kind} at ${p.x} ${p.y} ${p.z} (${Math.round(d)} away, ${p.pieces.length} pieces)`;
    b.onclick = () => show(gen, p);
    b.dataset.key = `${p.x},${p.z}`;
    $('list').appendChild(b);
  }
  show(gen, pick, keep);
  $('status').textContent = `Built in ${Math.round(performance.now() - t0)} ms`;
}

function show(gen, p, keep) {
  plan = p;
  for (const b of $('list').children) b.classList.toggle('on', b.dataset.key === `${p.x},${p.z}`);
  const [bx0, bz0, bx1, bz1] = p.box;
  const x0 = bx0 - 3, z0 = bz0 - 3, x1 = bx1 + 3, z1 = bz1 + 3;
  const chunks = new Map();
  for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) chunks.set(`${cx},${cz}`, gen.generate(cx, cz).blocks);
  area = {
    x0, z0, w: x1 - x0 + 1, d: z1 - z0 + 1,
    get: (x, y, z) => (y < 0 || y >= H ? 0 : chunks.get(`${x >> 4},${z >> 4}`)[(x & 15) | ((z & 15) << 4) | (y << 8)]),
  };
  $('pieces').textContent =
    `${p.kind}, anchor ${p.x} ${p.y} ${p.z}\n` + p.pieces.map((q) => `${q.name} at ${q.x} ${q.y} ${q.z}, rot ${q.rot}`).join('\n');
  $('layer').min = Math.max(0, p.y - 20);
  $('layer').max = Math.min(H - 1, p.y + 20);
  if (!keep) $('layer').value = p.y + 1;
  draw();
}

function draw() {
  if (!area) return;
  const c = $('view'), ctx = c.getContext('2d');
  c.width = area.w * PX;
  c.height = area.d * PX;
  const y = Number($('layer').value);
  const top = document.querySelector('input[name=mode]:checked').value === 'top';
  $('layerLabel').textContent = top ? '' : `y ${y} (anchor ${y - plan.y >= 0 ? '+' : ''}${y - plan.y})`;
  for (let i = 0; i < area.w; i++)
    for (let j = 0; j < area.d; j++) {
      const x = area.x0 + i, z = area.z0 + j;
      let id = 0, shade = 1;
      if (top) {
        for (let yy = Math.min(H - 1, plan.y + 25); yy > 0; yy--) if ((id = area.get(x, yy, z))) { shade = Math.max(0.35, Math.min(1.25, 1 + (yy - plan.y) * 0.04)); break; }
      } else {
        id = area.get(x, y, z);
        if (!id) {
          for (let k = 1; k <= 3 && !id; k++) if ((id = area.get(x, y - k, z))) shade = 0.45 - k * 0.08;
        }
      }
      const col = id ? blockColor(id) : [16, 18, 21];
      ctx.fillStyle = `rgb(${col.map((v) => Math.round(v * shade)).join(',')})`;
      ctx.fillRect(i * PX, j * PX, PX, PX);
    }
  // The anchor and the structure box.
  const [bx0, bz0, bx1, bz1] = plan.box;
  ctx.strokeStyle = 'rgba(111,191,90,0.7)';
  ctx.strokeRect((bx0 - area.x0) * PX + 0.5, (bz0 - area.z0) * PX + 0.5, (bx1 - bx0 + 1) * PX - 1, (bz1 - bz0 + 1) * PX - 1);
  ctx.strokeStyle = '#ffd34d';
  ctx.strokeRect((plan.x - area.x0) * PX + 1.5, (plan.z - area.z0) * PX + 1.5, PX - 3, PX - 3);
}

$('view').addEventListener('mousemove', (e) => {
  if (!area) return;
  const r = $('view').getBoundingClientRect();
  const i = Math.floor(((e.clientX - r.left) / r.width) * area.w), j = Math.floor(((e.clientY - r.top) / r.height) * area.d);
  const x = area.x0 + i, z = area.z0 + j, y = Number($('layer').value);
  const col = [];
  for (let yy = y + 2; yy >= y - 2; yy--) col.push(`${yy === y ? '>' : ' '} y ${yy} (${yy - plan.y >= 0 ? '+' : ''}${yy - plan.y}): ${BLOCKS[area.get(x, yy, z)].key}`);
  $('hover').textContent = `x ${x} z ${z}  (anchor ${x - plan.x >= 0 ? '+' : ''}${x - plan.x}, ${z - plan.z >= 0 ? '+' : ''}${z - plan.z})\n${col.join('\n')}`;
});

$('layer').oninput = draw;
for (const r of document.querySelectorAll('input[name=mode]')) r.onchange = draw;
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'radio') return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    $('layer').value = Number($('layer').value) + (e.key === 'ArrowUp' ? 1 : -1);
    draw();
  }
});
$('find').onclick = () => find(false);
$('kind').onchange = () => find(false);

async function poll() {
  if ($('auto').checked) {
    try {
      const text = await (await fetch('../src/world/structures.js', { cache: 'no-store' })).text();
      if (source && text !== source) {
        await find(true);
        $('status').textContent = `Rebuilt after an edit at ${new Date().toLocaleTimeString()}`;
      }
      source = text;
    } catch (err) {
      $('status').textContent = `Rebuild failed: ${err.message}`;
    }
  }
  setTimeout(poll, 1000);
}

const q = new URLSearchParams(location.search);
if (q.get('seed')) $('seed').value = q.get('seed');
if (q.get('kind')) $('kind').value = q.get('kind');
await find(false);
poll();
