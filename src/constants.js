// World dimensions and shared constants.

export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;
export const WORLD_HEIGHT = 256;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * WORLD_HEIGHT;
export const SEA_LEVEL = 62;

// Voxel index inside a chunk: x + z * 16 + y * 256
export const blockIndex = (x, y, z) => x | (z << 4) | (y << 8);

// Faces: 0 +X (east), 1 -X (west), 2 +Y (up), 3 -Y (down), 4 +Z (south), 5 -Z (north)
export const FACE_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Numeric chunk key usable as a Map key.
export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

export const DAY_LENGTH_SECONDS = 20 * 60;
