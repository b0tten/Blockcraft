// World persistence: a folder of JSON files, written atomically (temp file + rename).
//   world.json    name, seed, spawn, time of day
//   edits.json    every changed block: { "cx,cz": [index, id, ...] }
//   players.json  last position of each player name

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeEdits, deserializeEdits } from '../src/world/edits.js';

async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

async function writeJSON(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

export async function loadWorld(dir) {
  const meta = await readJSON(join(dir, 'world.json'));
  if (!meta) return null;
  return {
    meta,
    edits: deserializeEdits(await readJSON(join(dir, 'edits.json'))),
    players: (await readJSON(join(dir, 'players.json'))) || {},
  };
}

export async function saveWorld(dir, { meta, edits, players }) {
  await mkdir(dir, { recursive: true });
  await writeJSON(join(dir, 'edits.json'), serializeEdits(edits));
  await writeJSON(join(dir, 'players.json'), players);
  await writeJSON(join(dir, 'world.json'), meta);
}
