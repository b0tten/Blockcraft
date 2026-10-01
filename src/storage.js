// Settings and world saves in localStorage.

const PREFIX = 'blockcraft:';

export const DEFAULT_SETTINGS = {
  renderDistance: 8,
  fov: 75,
  sensitivity: 100,
  invertY: false,
  viewBobbing: true,
  clouds: true,
  volume: 60,
  renderScale: 100,
  showFps: false,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Could not save', key, err);
    return false;
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
}

export function saveSettings(s) {
  write('settings', s);
}

// Last server address and player name used for multiplayer.
export function loadMultiplayer() {
  return read('multiplayer', {});
}

export function saveMultiplayer(v) {
  write('multiplayer', v);
}

export function listWorlds() {
  const list = read('worlds', []);
  return list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

export function createWorldMeta(name, seed) {
  const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const meta = { id, name, seed, created: Date.now(), lastPlayed: Date.now() };
  const list = read('worlds', []);
  list.push(meta);
  write('worlds', list);
  return meta;
}

export function updateWorldMeta(meta) {
  const list = read('worlds', []);
  const i = list.findIndex((w) => w.id === meta.id);
  if (i >= 0) list[i] = meta;
  else list.push(meta);
  write('worlds', list);
}

export function loadWorldData(id) {
  return read(`world:${id}`, null);
}

export function saveWorldData(id, data) {
  return write(`world:${id}`, data);
}

export function deleteWorld(id) {
  write(
    'worlds',
    read('worlds', []).filter((w) => w.id !== id),
  );
  try {
    localStorage.removeItem(`${PREFIX}world:${id}`);
  } catch {
    /* ignore */
  }
}

// Turn a seed string into a 32-bit integer (numbers are used as-is).
export function parseSeed(text) {
  const t = String(text ?? '').trim();
  if (!t) return Math.floor(Math.random() * 2147483647);
  if (/^-?\d+$/.test(t)) return Number(BigInt.asIntN(32, BigInt(t)));
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return h;
}
