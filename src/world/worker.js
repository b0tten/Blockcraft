// Terrain generation worker: receives chunk coordinates, returns block data.

import { TerrainGenerator } from './generator.js';

let gen = null;

self.onmessage = (e) => {
  const { seed, gen: version = 1, cx, cz } = e.data;
  if (!gen || gen.seed !== (seed | 0) || gen.version !== version) gen = new TerrainGenerator(seed, version);
  const r = gen.generate(cx, cz);
  self.postMessage({ cx, cz, blocks: r.blocks, biomes: r.biomes }, [r.blocks.buffer, r.biomes.buffer]);
};
