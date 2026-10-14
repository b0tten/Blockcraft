// Block registry. IDs are stored in saves, so only ever append new blocks.

export const R_NONE = 0;
export const R_CUBE = 1; // opaque pass, full cube
export const R_CUTOUT = 2; // opaque pass with alpha test (leaves, glass)
export const R_TRANSLUCENT = 3; // blended pass (water, ice)
export const R_CROSS = 4; // two crossed quads (flowers, grass)
export const R_TORCH = 5; // small upright stick
export const R_MODEL = 6; // box model (doors, beds, signs...), see the decoration blocks below
export const R_ITEM = 7; // inventory item that places other blocks; never in the world
export const R_DUST = 8; // redstone dust: flat wire whose shape depends on its neighbours (see the mesher)

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

// ------------------------------------------------------------ redstone
// Same idea as the decoration blocks: every state (on/off, power level, facing, extended) is
// its own id, reached through an inventory item. world/redstone.js runs the circuits.
// Faces are numbered +X, -X, +Y, -Y, +Z, -Z everywhere below.

export const FACE_DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const WALL_FACE_ROT = { 4: 0, 1: 1, 5: 2, 0: 3 }; // outward face of a wall mount -> model rot
const flipY = (b) => [b[0], 16 - b[4], b[2], b[3], 16 - b[1], b[5]];
const OLD_CENTERS = [[16, 8, 8], [0, 8, 8], [8, 16, 8], [8, 0, 8], [8, 8, 16], [8, 8, 0]];
const faceOfPoint = ([x, y, z]) => (x === 16 ? 0 : x === 0 ? 1 : y === 16 ? 2 : y === 0 ? 3 : z === 16 ? 4 : 5);
// Turns a model built pointing up (+Y) to point out of face `f`: [point -> point] per face.
const TURN_UP = [
  (x, y, z) => [y, 16 - x, z],
  (x, y, z) => [16 - y, x, z],
  (x, y, z) => [x, y, z],
  (x, y, z) => [x, 16 - y, 16 - z],
  (x, y, z) => [x, 16 - z, y],
  (x, y, z) => [x, z, 16 - y],
];
const pointBox = (T, b) => {
  const a = T(b[0], b[1], b[2]), c = T(b[3], b[4], b[5]);
  return [0, 1, 2].map((k) => Math.min(a[k], c[k])).concat([0, 1, 2].map((k) => Math.max(a[k], c[k])));
};
function pointUp(parts, f) {
  const T = TURN_UP[f];
  return parts.map((p) => {
    const tex = Array(6);
    OLD_CENTERS.forEach((c, fo) => (tex[faceOfPoint(T(...c))] = p.tex[fo]));
    return { box: pointBox(T, p.box), tex };
  });
}

const STONE = 'stone';
const leverParts = (mount, on) => {
  if (mount >= 2 && mount <= 3) {
    // Floor lever; the ceiling one is the same upside down.
    const base = [[5, 0, 4, 11, 3, 12]];
    const stick = on ? [[7, 3, 6, 9, 7, 8], [7, 7, 4, 9, 11, 6]] : [[7, 3, 8, 9, 7, 10], [7, 7, 10, 9, 11, 12]];
    const f = mount === 3 ? flipY : (b) => b;
    return [...base.map((b) => box(f(b), 'cobblestone')), ...stick.map((b) => box(f(b), 'lever_handle'))];
  }
  const stick = on ? [[7, 7, 3, 9, 11, 5], [7, 11, 5, 9, 15, 7]] : [[7, 5, 3, 9, 9, 5], [7, 1, 5, 9, 5, 7]];
  return [box([5, 4, 0, 11, 12, 3], 'cobblestone'), ...stick.map((b) => box(b, 'lever_handle'))];
};
const buttonParts = (mount, pressed) => {
  const t = pressed ? 1 : 2;
  if (mount >= 2 && mount <= 3) {
    const b = [5, 0, 6, 11, t, 10];
    return [box(mount === 3 ? flipY(b) : b, STONE)];
  }
  return [box([5, 6, 0, 11, 10, t], STONE)];
};
const mountRot = (mount) => (mount in WALL_FACE_ROT ? WALL_FACE_ROT[mount] : 0);
// Face (0-5) the block hangs on, as seen from the block: opposite of where it sticks out.
const OPPOSITE = [1, 0, 3, 2, 5, 4];

const REDSTONE_ITEMS = [
  ['redstone_lamp', { name: 'Redstone Lamp', tex: 'lamp_off', sound: 'glass', hardness: 0.3, variant: { kind: 'lamp', on: false } }],
  ['redstone_dust', { ...ITEM, name: 'Redstone Dust', tex: 'dust_item', sound: 'stone' }],
  ['lever', { ...ITEM, name: 'Lever', tex: 'lever_item' }],
  ['stone_button', { ...ITEM, name: 'Stone Button', tex: 'button_item', sound: 'stone' }],
  ['repeater', { ...ITEM, name: 'Repeater', tex: 'repeater_item', sound: 'stone' }],
  ['piston', { ...ITEM, name: 'Piston', tex: 'piston_item', sound: 'stone' }],
  ['sticky_piston', { ...ITEM, name: 'Sticky Piston', tex: 'sticky_piston_item', sound: 'stone' }],
];
DEFS.push(...REDSTONE_ITEMS);
DEFS.push(['redstone_lamp_on', { name: 'Redstone Lamp', tex: 'lamp_on', emit: 15, inventory: false, item: 'redstone_lamp', drop: 'redstone_lamp', sound: 'glass', hardness: 0.3, variant: { kind: 'lamp', on: true } }]);
for (let p = 0; p < 16; p++)
  DEFS.push([`redstone_dust_${p}`, {
    ...DEFAULTS, render: R_DUST, name: 'Redstone Dust', tex: `dust_${p}`, item: 'redstone_dust', support: true, hardness: 0, sound: 'stone',
    select: [0, 0, 0, 1, 1 / 16, 1], variant: { kind: 'dust', power: p },
  }]);
for (let mount = 0; mount < 6; mount++)
  for (const on of [false, true])
    DEFS.push([`lever_${mount}_${on ? 'on' : 'off'}`, {
      ...DEFAULTS, name: 'Lever', tex: 'cobblestone', item: 'lever', model: leverParts(mount, on), rot: mountRot(mount), sound: 'stone', hardness: 0.5,
      attach: OPPOSITE[mount], variant: { kind: 'lever', mount, on },
    }]);
for (let mount = 0; mount < 6; mount++)
  for (const pressed of [false, true])
    DEFS.push([`stone_button_${mount}_${pressed ? 'on' : 'off'}`, {
      ...DEFAULTS, name: 'Stone Button', tex: STONE, item: 'stone_button', model: buttonParts(mount, pressed), rot: mountRot(mount), sound: 'stone', hardness: 0.5,
      attach: OPPOSITE[mount], variant: { kind: 'button', mount, pressed },
    }]);
// Repeater: output towards north at rot 0. The moving torch sets the delay (1-4 redstone ticks).
const repeaterParts = (delay, on) => {
  const torch = on ? 'repeater_torch_on' : 'repeater_torch_off';
  const c = 3 + (delay - 1) * 2;
  return [
    box([0, 0, 0, 16, 2, 16], ['stone', 'stone', on ? 'repeater_top_on' : 'repeater_top_off', 'stone', 'stone', 'stone']),
    box([7, 2, 12, 9, 8, 14], torch),
    box([7, 2, c - 1, 9, 8, c + 1], torch),
  ];
};
for (const on of [false, true])
  for (let delay = 1; delay <= 4; delay++)
    for (let r = 0; r < 4; r++)
      DEFS.push([`repeater_${on ? 'on' : 'off'}_${delay}_${r}`, {
        ...DEFAULTS, name: 'Repeater', tex: 'stone', item: 'repeater', model: repeaterParts(delay, on), rot: r, sound: 'stone', hardness: 0,
        collide: [[0, 0, 0, 16, 2, 16]], support: true, variant: { kind: 'repeater', rot: r, delay, on },
      }]);
// Pistons: the base is a full block; extended, a head block with a rod sits in front of it.
const pistonBody = (sticky, extended) => [box([0, 0, 0, 16, 16, 16], ['piston_side', 'piston_side', extended ? 'piston_inner' : sticky ? 'piston_top_sticky' : 'piston_top', 'piston_bottom', 'piston_side', 'piston_side'])];
const pistonHead = (sticky) => [
  box([0, 12, 0, 16, 16, 16], ['piston_side', 'piston_side', sticky ? 'piston_top_sticky' : 'piston_top', 'piston_side', 'piston_side', 'piston_side']),
  box([6, 0, 6, 10, 12, 10], 'piston_rod'),
];
for (const sticky of [false, true])
  for (let f = 0; f < 6; f++)
    for (const extended of [false, true])
      DEFS.push([`${sticky ? 'sticky_' : ''}piston_${f}_${extended ? 'out' : 'in'}`, {
        ...DEFAULTS, name: sticky ? 'Sticky Piston' : 'Piston', tex: 'piston_side', item: sticky ? 'sticky_piston' : 'piston', solid: true, opaque: false,
        model: pointUp(pistonBody(sticky, extended), f), rot: 0, sound: 'stone', hardness: 1.5, variant: { kind: 'piston', sticky, facing: f, extended },
      }]);
for (const sticky of [false, true])
  for (let f = 0; f < 6; f++)
    DEFS.push([`${sticky ? 'sticky_' : ''}piston_head_${f}`, {
      ...DEFAULTS, name: sticky ? 'Sticky Piston' : 'Piston', tex: 'piston_side', item: sticky ? 'sticky_piston' : 'piston', model: pointUp(pistonHead(sticky), f), rot: 0,
      sound: 'stone', hardness: 1.5, collide: [[0, 12, 0, 16, 16, 16], [6, 0, 6, 10, 12, 10]].map((b) => pointBox(TURN_UP[f], b)).map((b) => b), variant: { kind: 'pistonHead', sticky, facing: f },
    }]);

export const WOOL_COLORS = WOOLS.map(([id]) => id);

// Ids are 16-bit everywhere (chunks, tables); the tables below are sized with headroom.
export const MAX_IDS = 1024;
export const BLOCKS = [];
export const B = {};

export const OPAQUE = new Uint8Array(MAX_IDS);
export const SOLID = new Uint8Array(MAX_IDS);
export const RENDER = new Uint8Array(MAX_IDS);
export const LIQUID = new Uint8Array(MAX_IDS);
export const EMIT = new Uint8Array(MAX_IDS);
export const FILTER = new Uint8Array(MAX_IDS);
export const CULL_SELF = new Uint8Array(MAX_IDS);
export const WAVE = new Uint8Array(MAX_IDS);
export const REPLACEABLE = new Uint8Array(MAX_IDS);
export const NEEDS_SUPPORT = new Uint8Array(MAX_IDS);
export const CLIMB = new Uint8Array(MAX_IDS);
// Shaped blocks: MODEL[id] = { parts, rot }; COLLIDE[id] / SELECT[id] = boxes in block units.
export const MODEL = [];
export const COLLIDE = [];
export const SELECT = [];
export const VARIANT = []; // id -> { kind: 'door' | 'ladder' | 'bed' | 'sign' | 'pot', ... }
export const ATTACH = new Int8Array(MAX_IDS).fill(-1); // face (0-5) a lever or button hangs on, else -1
export const BLOCK_ITEM = new Uint16Array(MAX_IDS); // what you get when you pick the block
export const FULL_BOX = [[0, 0, 0, 1, 1, 1]];
// Texture layer per face (6 per block); filled in by resolveTextures().
export const FACE_TEX = new Uint16Array(MAX_IDS * 6);

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

export const DECOR = { door: { lower: [[], []], upper: [[], []] }, ladder: [], bed: { foot: [], head: [] }, sign: { wall: [], stand: [] }, pot: { empty: 0, byPlant: new Map() },
  lamp: [0, 0], dust: [], lever: [], button: [], repeater: [], piston: [[], []], pistonHead: [[], []] };
DEFS.forEach(([, def], id) => {
  if (def.item) BLOCK_ITEM[id] = B[def.item];
  if (def.attach !== undefined) ATTACH[id] = def.attach;
  if (def.collide) COLLIDE[id] = def.collide.map((b) => rotateBox(b, def.rot));
  if (def.model) {
    const boxes = def.model.map((p) => rotateBox(p.box || p.cross, def.rot));
    SELECT[id] = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b[k]))).concat([3, 4, 5].map((k) => Math.min(1, Math.max(...boxes.map((b) => b[k])))));
  }
  if (def.select) SELECT[id] = def.select;
  const v = def.variant;
  if (!v) return;
  VARIANT[id] = { ...v, plant: v.plant ? B[v.plant] : 0 };
  if (v.kind === 'door') DECOR.door[v.half][v.open ? 1 : 0][v.rot] = id;
  else if (v.kind === 'ladder') DECOR.ladder[v.rot] = id;
  else if (v.kind === 'bed') DECOR.bed[v.part][v.rot] = id;
  else if (v.kind === 'sign') DECOR.sign[v.wall ? 'wall' : 'stand'][v.rot] = id;
  else if (v.kind === 'lamp') DECOR.lamp[v.on ? 1 : 0] = id;
  else if (v.kind === 'dust') DECOR.dust[v.power] = id;
  else if (v.kind === 'lever') (DECOR.lever[v.mount] ||= [])[v.on ? 1 : 0] = id;
  else if (v.kind === 'button') (DECOR.button[v.mount] ||= [])[v.pressed ? 1 : 0] = id;
  else if (v.kind === 'repeater') ((DECOR.repeater[v.rot] ||= [])[v.delay - 1] ||= [])[v.on ? 1 : 0] = id;
  else if (v.kind === 'piston') (DECOR.piston[v.sticky ? 1 : 0][v.facing] ||= [])[v.extended ? 1 : 0] = id;
  else if (v.kind === 'pistonHead') DECOR.pistonHead[v.sticky ? 1 : 0][v.facing] = id;
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
