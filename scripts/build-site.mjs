// Copies just the files the browser needs into dist/, ready for any static host
// (this is what the GitHub Pages workflow publishes): `node scripts/build-site.mjs`.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const file of ['index.html', 'style.css']) {
  if (!existsSync(join(root, file))) throw new Error(`Missing ${file}`);
  cpSync(join(root, file), join(out, file));
}
cpSync(join(root, 'src'), join(out, 'src'), { recursive: true });

// Tell GitHub Pages not to run Jekyll over the files.
writeFileSync(join(out, '.nojekyll'), '');

console.log('Built site into dist/');
