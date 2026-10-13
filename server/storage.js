// World persistence: a folder of JSON files, written atomically (temp file + rename).
//   world.json    name, seed, spawn, time of day
//   edits.json    every changed block: { "cx,cz": [index, id, ...] }
//   signs.json    sign text: { "cx,cz": [[index, [four lines]], ...] }
//   players.json  last position of each player name
//   bans.json     bans by name and by browser, and which browsers each name used

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeEdits, deserializeEdits, serializeSigns, deserializeSigns } from '../src/world/edits.js';

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
    signs: deserializeSigns(await readJSON(join(dir, 'signs.json'))),
    players: (await readJSON(join(dir, 'players.json'))) || {},
    bans: (await readJSON(join(dir, 'bans.json'))) || {},
  };
}

export async function saveWorld(dir, { meta, edits, signs, players, bans }) {
  await mkdir(dir, { recursive: true });
  await writeJSON(join(dir, 'edits.json'), serializeEdits(edits));
  await writeJSON(join(dir, 'signs.json'), serializeSigns(signs));
  await writeJSON(join(dir, 'players.json'), players);
  if (bans) await writeJSON(join(dir, 'bans.json'), bans);
  await writeJSON(join(dir, 'world.json'), meta);
}
