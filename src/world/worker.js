// Terrain generation worker: receives chunk coordinates, returns block data.

import { TerrainGenerator } from './generator.js';

let gen = null;

self.onmessage = (e) => {
  const { seed, cx, cz } = e.data;
  if (!gen || gen.seed !== (seed | 0)) gen = new TerrainGenerator(seed);
  const r = gen.generate(cx, cz);
  self.postMessage({ cx, cz, blocks: r.blocks, biomes: r.biomes }, [r.blocks.buffer, r.biomes.buffer]);
};
