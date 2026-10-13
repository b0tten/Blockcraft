// Block registry. IDs are stored in saves, so only ever append new blocks.

export const R_NONE = 0;
export const R_CUBE = 1; // opaque pass, full cube
export const R_CUTOUT = 2; // opaque pass with alpha test (leaves, glass)
export const R_TRANSLUCENT = 3; // blended pass (water, ice)
export const R_CROSS = 4; // two crossed quads (flowers, grass)
export const R_TORCH = 5; // small upright stick
export const R_MODEL = 6; // box model (doors, beds, signs...), see the decoration blocks below
export const R_ITEM = 7; // inventory item that places other blocks; never in the world

const WOOLS = [
  ['white', 'White'], ['light_gray', 'Light Gray'], ['gray', 'Gray'], ['black', 'Black'],
  ['brown', 'Brown'], ['red', 'Red'], ['orange', 'Orange'], ['yellow', 'Yellow'],
  ['lime', 'Lime'], ['green', 'Green'], ['cyan', 'Cyan'], ['light_blue', 'Light Blue'],
  ['blue', 'Blue'], ['purple', 'Purple'], ['magenta', 'Magenta'], ['pink', 'Pink'],
];

const PLANT = { render: R_CROSS, solid: false, opaque: false, replaceable: false, support: true, wave: true, sound: 'plant', hardness: 0 };

const DEFS = [
  ['air', { name: 'Air', render: R_NONE, solid: false, opaque: false, replaceable: true, inventory: false }],
  ['stone', { name: 'Stone', tex: 'stone', sound: 'stone', hardness: 1.5, drop: 'cobblestone' }],
  ['grass', { name: 'Grass Block', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, sound: 'grass', hardness: 0.6, drop: 'dirt' }],
  ['dirt', { name: 'Dirt', tex: 'dirt', sound: 'gravel', hardness: 0.5 }],
  ['cobblestone', { name: 'Cobblestone', tex: 'cobblestone', sound: 'stone', hardness: 2 }],
  ['oak_planks', { name: 'Oak Planks', tex: 'planks_oak', sound: 'wood', hardness: 2 }],
  ['bedrock', { name: 'Bedrock', tex: 'bedrock', sound: 'stone', hardness: -1 }],
  ['sand', { name: 'Sand', tex: 'sand', sound: 'sand', hardness: 0.5 }],
  ['gravel', { name: 'Gravel', tex: 'gravel', sound: 'gravel', hardness: 0.6 }],
  ['oak_log', { name: 'Oak Log', tex: { top: 'log_oak_top', bottom: 'log_oak_top', side: 'log_oak' }, sound: 'wood', hardness: 2 }],
  ['oak_leaves', { name: 'Oak Leaves', tex: 'leaves_oak', render: R_CUTOUT, opaque: false, filter: 1, wave: true, sound: 'grass', hardness: 0.2, drop: null }],
  ['glass', { name: 'Glass', tex: 'glass', render: R_CUTOUT, opaque: false, cullSelf: true, sound: 'glass', hardness: 0.3, drop: null }],
  ['water', { name: 'Water', tex: 'water', render: R_TRANSLUCENT, solid: false, opaque: false, liquid: true, cullSelf: true, filter: 1, replaceable: true, sound: 'water', inventory: false }],
  ['lava', { name: 'Lava', tex: 'lava', render: R_CUBE, solid: false, opaque: false, liquid: true, cullSelf: true, emit: 15, replaceable: true, sound: 'water', inventory: false }],
  ['coal_ore', { name: 'Coal Ore', tex: 'ore_coal', sound: 'stone', hardness: 3 }],
  ['iron_ore', { name: 'Iron Ore', tex: 'ore_iron', sound: 'stone', hardness: 3 }],
  ['gold_ore', { name: 'Gold Ore', tex: 'ore_gold', sound: 'stone', hardness: 3 }],
  ['diamond_ore', { name: 'Diamond Ore', tex: 'ore_diamond', sound: 'stone', hardness: 3 }],
  ['bricks', { name: 'Bricks', tex: 'bricks', sound: 'stone', hardness: 2 }],
  ['snowy_grass', { name: 'Snowy Grass', tex: { top: 'snow', bottom: 'dirt', side: 'grass_snow_side' }, sound: 'snow', hardness: 0.6, drop: 'dirt' }],
  ['snow', { name: 'Snow Block', tex: 'snow', sound: 'snow', hardness: 0.2 }],
  ['ice', { name: 'Ice', tex: 'ice', render: R_TRANSLUCENT, opaque: false, cullSelf: true, filter: 1, sound: 'glass', hardness: 0.5, drop: null }],
  ['cactus', { name: 'Cactus', tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, sound: 'cloth', hardness: 0.4 }],
  ['birch_log', { name: 'Birch Log', tex: { top: 'log_birch_top', bottom: 'log_birch_top', side: 'log_birch' }, sound: 'wood', hardness: 2 }],
  ['birch_leaves', { name: 'Birch Leaves', tex: 'leaves_birch', render: R_CUTOUT, opaque: false, filter: 1, wave: true, sound: 'grass', hardness: 0.2, drop: null }],
  ['spruce_log', { name: 'Spruce Log', tex: { top: 'log_spruce_top', bottom: 'log_spruce_top', side: 'log_spruce' }, sound: 'wood', hardness: 2 }],
  ['spruce_leaves', { name: 'Spruce Leaves', tex: 'leaves_spruce', render: R_CUTOUT, opaque: false, filter: 1, wave: true, sound: 'grass', hardness: 0.2, drop: null }],
  ['sandstone', { name: 'Sandstone', tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, sound: 'stone', hardness: 0.8 }],
  ['glowstone', { name: 'Glowstone', tex: 'glowstone', emit: 15, sound: 'glass', hardness: 0.3 }],
  ['torch', { name: 'Torch', tex: 'torch', render: R_TORCH, solid: false, opaque: false, emit: 14, support: true, sound: 'wood', hardness: 0 }],
  ['tnt', { name: 'TNT', tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, sound: 'grass', hardness: 0 }],
  ['bookshelf', { name: 'Bookshelf', tex: { top: 'planks_oak', bottom: 'planks_oak', side: 'bookshelf' }, sound: 'wood', hardness: 1.5 }],
  ['crafting_table', { name: 'Crafting Table', tex: { top: 'crafting_table_top', bottom: 'planks_oak', side: 'crafting_table_side', front: 'crafting_table_front' }, sound: 'wood', hardness: 2.5 }],
  ['furnace', { name: 'Furnace', tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, sound: 'stone', hardness: 3.5 }],
  ['obsidian', { name: 'Obsidian', tex: 'obsidian', sound: 'stone', hardness: 10 }],
  ['mossy_cobblestone', { name: 'Mossy Cobblestone', tex: 'mossy_cobblestone', sound: 'stone', hardness: 2 }],
  ['stone_bricks', { name: 'Stone Bricks', tex: 'stone_bricks', sound: 'stone', hardness: 1.5 }],
  ['pumpkin', { name: 'Pumpkin', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' }, sound: 'wood', hardness: 1 }],
  ['jack_o_lantern', { name: "Jack o'Lantern", tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_lit' }, emit: 15, sound: 'wood', hardness: 1 }],
  ['melon', { name: 'Melon', tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, sound: 'wood', hardness: 1 }],
  ['clay', { name: 'Clay', tex: 'clay', sound: 'gravel', hardness: 0.6 }],
  ['iron_block', { name: 'Block of Iron', tex: 'iron_block', sound: 'stone', hardness: 5 }],
  ['gold_block', { name: 'Block of Gold', tex: 'gold_block', sound: 'stone', hardness: 3 }],
  ['diamond_block', { name: 'Block of Diamond', tex: 'diamond_block', sound: 'stone', hardness: 5 }],
  ['birch_planks', { name: 'Birch Planks', tex: 'planks_birch', sound: 'wood', hardness: 2 }],
  ['spruce_planks', { name: 'Spruce Planks', tex: 'planks_spruce', sound: 'wood', hardness: 2 }],
  ['tall_grass', { ...PLANT, name: 'Grass', tex: 'tall_grass', replaceable: true, drop: null }],
  ['fern', { ...PLANT, name: 'Fern', tex: 'fern', replaceable: true, drop: null }],
  ['dandelion', { ...PLANT, name: 'Dandelion', tex: 'dandelion' }],
  ['poppy', { ...PLANT, name: 'Poppy', tex: 'poppy' }],
  ['cornflower', { ...PLANT, name: 'Cornflower', tex: 'cornflower' }],
  ['dead_bush', { ...PLANT, name: 'Dead Bush', tex: 'dead_bush', replaceable: true, wave: false, drop: null }],
  ['red_mushroom', { ...PLANT, name: 'Red Mushroom', tex: 'mushroom_red', wave: false, emit: 0 }],
  ['brown_mushroom', { ...PLANT, name: 'Brown Mushroom', tex: 'mushroom_brown', wave: false, emit: 1 }],
  ...WOOLS.map(([id, label]) => [`${id}_wool`, { name: `${label} Wool`, tex: `wool_${id}`, sound: 'cloth', hardness: 0.8 }]),
  ['sugar_cane', { ...PLANT, name: 'Sugar Cane', tex: 'sugar_cane', wave: false }],
];

// ------------------------------------------------------------ decoration blocks
// Shaped blocks are drawn from box models in 1/16 units, built facing north (rot 0) and
// turned in quarter turns clockwise (seen from above). Every facing, door half, open state
// and pot contents is its own block id; players place them through an inventory item
// (render R_ITEM). world/rules.js decides how they are placed and used.

const PL = 'planks_oak';
// Face textures in the order +X, -X, +Y, -Y, +Z (south), -Z (north).
const box = (b, tex) => ({ box: b, tex: typeof tex === 'string' ? Array(6).fill(tex) : tex });
const DOOR_BOX = [[0, 0, 0, 16, 16, 3]];
const MODELS = {
  doorLower: [box(DOOR_BOX[0], [PL, PL, PL, PL, 'door_bottom', 'door_bottom'])],
  doorUpper: [box(DOOR_BOX[0], [PL, PL, PL, PL, 'door_top', 'door_top'])],
  ladder: [box([0, 0, 0, 16, 16, 1], 'ladder')],
  signWall: [box([0, 4, 0, 16, 12, 2], 'sign')],
  signStand: [box([0, 7, 7, 16, 15, 9], 'sign'), box([7, 0, 7, 9, 7, 9], 'log_oak')],
  // Head towards north: the head half is north of the foot half.
  bedFoot: [box([0, 3, 0, 16, 9, 16], ['bed_side', 'bed_side', 'bed_foot_top', PL, 'bed_end', 'bed_side']), box([0, 0, 13, 3, 3, 16], PL), box([13, 0, 13, 16, 3, 16], PL)],
  bedHead: [box([0, 3, 0, 16, 9, 16], ['bed_side', 'bed_side', 'bed_head_top', PL, 'bed_side', 'bed_end']), box([0, 0, 0, 3, 3, 3], PL), box([13, 0, 0, 16, 3, 3], PL)],
  pot: [box([5, 0, 5, 11, 6, 11], ['flower_pot', 'flower_pot', 'flower_pot_top', 'flower_pot', 'flower_pot', 'flower_pot'])],
};
// Where sign text goes, in the same units: the board's front (+Z in the model) at depth z.
export const SIGN_TEXT = { wall: { x0: 1, x1: 15, y0: 4.5, y1: 11.5, z: 2.08 }, stand: { x0: 1, x1: 15, y0: 7.5, y1: 14.5, z: 9.08 } };
const POTTABLE = ['dandelion', 'poppy', 'cornflower', 'red_mushroom', 'brown_mushroom', 'fern', 'dead_bush'];
const DEFAULTS = { render: R_MODEL, solid: false, opaque: false, inventory: false, sound: 'wood', hardness: 1 };
const ITEM = { render: R_ITEM, solid: false, opaque: false, sound: 'wood', hardness: 1 };

DEFS.push(
  ['oak_door', { ...ITEM, name: 'Oak Door', tex: 'door_item' }],
  ['ladder', { ...ITEM, name: 'Ladder', tex: 'ladder' }],
  ['red_bed', { ...ITEM, name: 'Red Bed', tex: 'bed_item', sound: 'cloth' }],
  ['oak_sign', { ...ITEM, name: 'Oak Sign', tex: 'sign_item' }],
  ['flower_pot', { ...ITEM, name: 'Flower Pot', tex: 'flower_pot_item', sound: 'stone' }],
);
for (const open of [false, true])
  for (const half of ['lower', 'upper'])
    for (let r = 0; r < 4; r++)
      DEFS.push([`oak_door_${half}${open ? '_open' : ''}_${r}`, {
        ...DEFAULTS, name: 'Oak Door', tex: PL, item: 'oak_door', model: half === 'lower' ? MODELS.doorLower : MODELS.doorUpper,
        // An open door is the closed one swung a quarter turn about its hinge.
        rot: open ? (r + 3) % 4 : r, collide: DOOR_BOX, support: half === 'lower', variant: { kind: 'door', half, open, rot: r },
      }]);
for (let r = 0; r < 4; r++) DEFS.push([`ladder_${r}`, { ...DEFAULTS, name: 'Ladder', tex: 'ladder', item: 'ladder', model: MODELS.ladder, rot: r, climb: true, variant: { kind: 'ladder', rot: r } }]);
for (const part of ['foot', 'head'])
  for (let r = 0; r < 4; r++)
    DEFS.push([`red_bed_${part}_${r}`, {
      ...DEFAULTS, name: 'Red Bed', tex: 'wool_red', item: 'red_bed', sound: 'cloth', model: part === 'foot' ? MODELS.bedFoot : MODELS.bedHead,
      rot: r, collide: [[0, 0, 0, 16, 9, 16]], support: true, variant: { kind: 'bed', part, rot: r },
    }]);
for (const wall of [true, false])
  for (let r = 0; r < 4; r++)
    DEFS.push([`oak_sign_${wall ? 'wall' : 'stand'}_${r}`, {
      ...DEFAULTS, name: 'Oak Sign', tex: 'sign', item: 'oak_sign', model: wall ? MODELS.signWall : MODELS.signStand,
      rot: r, support: !wall, variant: { kind: 'sign', wall, rot: r },
    }]);
for (const plant of [null, ...POTTABLE]) {
  const plantDef = plant && DEFS.find(([k]) => k === plant)[1];
  DEFS.push([plant ? `potted_${plant}` : 'flower_pot_placed', {
    ...DEFAULTS, name: plant ? `Potted ${plantDef.name}` : 'Flower Pot', tex: 'flower_pot', item: 'flower_pot', sound: 'stone', hardness: 0,
    model: plant ? [...MODELS.pot, { cross: [2, 4, 2, 14, 20, 14], tex: Array(6).fill(plantDef.tex) }] : MODELS.pot,
    rot: 0, collide: [[5, 0, 5, 11, 6, 11]], support: true, variant: { kind: 'pot', plant },
  }]);
}

export const WOOL_COLORS = WOOLS.map(([id]) => id);

export const BLOCKS = [];
export const B = {};

export const OPAQUE = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const RENDER = new Uint8Array(256);
export const LIQUID = new Uint8Array(256);
export const EMIT = new Uint8Array(256);
export const FILTER = new Uint8Array(256);
export const CULL_SELF = new Uint8Array(256);
export const WAVE = new Uint8Array(256);
export const REPLACEABLE = new Uint8Array(256);
export const NEEDS_SUPPORT = new Uint8Array(256);
export const CLIMB = new Uint8Array(256);
// Shaped blocks: MODEL[id] = { parts, rot }; COLLIDE[id] / SELECT[id] = boxes in block units.
export const MODEL = [];
export const COLLIDE = [];
export const SELECT = [];
export const VARIANT = []; // id -> { kind: 'door' | 'ladder' | 'bed' | 'sign' | 'pot', ... }
export const BLOCK_ITEM = new Uint8Array(256); // what you get when you pick the block
export const FULL_BOX = [[0, 0, 0, 1, 1, 1]];
// Texture layer per face (6 per block); filled in by resolveTextures().
export const FACE_TEX = new Uint16Array(256 * 6);

DEFS.forEach(([key, def], id) => {
  const render = def.render ?? R_CUBE;
  const block = {
    id,
    key,
    name: def.name,
    tex: def.tex,
    render,
    solid: def.solid ?? true,
    opaque: def.opaque ?? true,
    liquid: !!def.liquid,
    emit: def.emit ?? 0,
    filter: def.filter ?? 0,
    sound: def.sound ?? 'stone',
    hardness: def.hardness ?? 1,
    inventory: def.inventory ?? true,
    drop: def.drop === undefined ? key : def.drop,
  };
  BLOCKS.push(block);
  B[key] = id;
  OPAQUE[id] = block.opaque ? 1 : 0;
  SOLID[id] = block.solid ? 1 : 0;
  RENDER[id] = render;
  LIQUID[id] = block.liquid ? 1 : 0;
  EMIT[id] = block.emit;
  FILTER[id] = block.filter;
  CULL_SELF[id] = def.cullSelf ? 1 : 0;
  WAVE[id] = def.wave ? 1 : 0;
  REPLACEABLE[id] = def.replaceable ? 1 : 0;
  NEEDS_SUPPORT[id] = def.support ? 1 : 0;
  CLIMB[id] = def.climb ? 1 : 0;
  BLOCK_ITEM[id] = id;
  if (def.model) MODEL[id] = { parts: def.model, rot: def.rot };
});

// Quarter turns about the block's vertical axis, in 1/16 units: (x, z) -> (16 - z, x).
export function rotateXZ(x, z, rot) {
  for (let i = 0; i < rot; i++) [x, z] = [16 - z, x];
  return [x, z];
}
// Face index after a quarter turn: +X -> +Z -> -X -> -Z -> +X.
const TURN = [4, 5, 2, 3, 1, 0];
export const ROT_FACE = [[0, 1, 2, 3, 4, 5]];
for (let r = 1; r < 4; r++) ROT_FACE.push(ROT_FACE[r - 1].map((f) => TURN[f]));

function rotateBox(b, rot) {
  const [ax, az] = rotateXZ(b[0], b[2], rot), [bx, bz] = rotateXZ(b[3], b[5], rot);
  return [Math.min(ax, bx) / 16, b[1] / 16, Math.min(az, bz) / 16, Math.max(ax, bx) / 16, b[4] / 16, Math.max(az, bz) / 16];
}

export const DECOR = { door: { lower: [[], []], upper: [[], []] }, ladder: [], bed: { foot: [], head: [] }, sign: { wall: [], stand: [] }, pot: { empty: 0, byPlant: new Map() } };
DEFS.forEach(([, def], id) => {
  if (def.item) BLOCK_ITEM[id] = B[def.item];
  if (def.collide) COLLIDE[id] = def.collide.map((b) => rotateBox(b, def.rot));
  if (def.model) {
    const boxes = def.model.map((p) => rotateBox(p.box || p.cross, def.rot));
    SELECT[id] = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b[k]))).concat([3, 4, 5].map((k) => Math.min(1, Math.max(...boxes.map((b) => b[k])))));
  }
  const v = def.variant;
  if (!v) return;
  VARIANT[id] = { ...v, plant: v.plant ? B[v.plant] : 0 };
  if (v.kind === 'door') DECOR.door[v.half][v.open ? 1 : 0][v.rot] = id;
  else if (v.kind === 'ladder') DECOR.ladder[v.rot] = id;
  else if (v.kind === 'bed') DECOR.bed[v.part][v.rot] = id;
  else if (v.kind === 'sign') DECOR.sign[v.wall ? 'wall' : 'stand'][v.rot] = id;
  else if (v.kind === 'pot') {
    if (v.plant) DECOR.pot.byPlant.set(B[v.plant], id);
    else DECOR.pot.empty = id;
  }
});

// Face order: +X, -X, +Y, -Y, +Z, -Z. "front" faces +Z (south).
export function faceTextureNames(block) {
  const t = block.tex;
  if (!t) return null;
  if (typeof t === 'string') return [t, t, t, t, t, t];
  const side = t.side ?? t.top;
  return [side, side, t.top ?? side, t.bottom ?? side, t.front ?? side, side];
}

export function allTextureNames() {
  const names = new Set();
  for (const b of BLOCKS) {
    const faces = faceTextureNames(b);
    if (faces) faces.forEach((n) => names.add(n));
    for (const part of MODEL[b.id]?.parts || []) part.tex.forEach((n) => names.add(n));
  }
  return [...names];
}

export function resolveTextures(layerOf) {
  for (const b of BLOCKS) {
    const faces = faceTextureNames(b);
    if (!faces) continue;
    for (let f = 0; f < 6; f++) FACE_TEX[b.id * 6 + f] = layerOf(faces[f]);
    for (const part of MODEL[b.id]?.parts || []) part.layers = part.tex.map(layerOf);
  }
}

export const INVENTORY_BLOCKS = BLOCKS.filter((b) => b.inventory).map((b) => b.id);
