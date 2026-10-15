# Structures: how they are stored and how to edit them

Villages, desert pyramids and desert wells come from **`src/world/structures.js`**. They aren't stored anywhere. Like the rest of the terrain, they are rebuilt from the world seed every time a chunk is generated, in the browser and on the server alike. "Editing a structure" therefore means editing the code that builds it.

To see your changes at once, run `npm start` and open **`http://localhost:8080/tools/structures.html`**:
- Pick a seed and a kind to view the nearest structure layer by layer.
- Hover a block to see its name and its position relative to the structure.
- Saving `structures.js` rebuilds the view within a second.
- `structures.html?seed=12345&kind=pyramid` opens straight on a pyramid.

---

## How it fits together

1. **Regions.** The world is cut into regions of 8×8 chunks (128×128 blocks). Each region holds at most one structure.
2. **Plan** (`plan(rx, rz)` → `makePlan`):
   - A random generator seeded from the world seed and the region decides whether there is a structure, where its **anchor** is (always at least 24 blocks from the region's edges), and which kind.
   - The kind depends on the biome under the anchor:
     - desert: 35% pyramid, 30% well, 35% village (desert style);
     - plains and forest: 70% village;
     - taiga: 50% village (spruce style).
   - The kind's planner (`planVillage`, `planPyramid`, `planWell`) checks the ground (`site()`: dry land, not too steep) and returns a **plan**. It returns `null` if the spot is no good. Plans are cached.
3. **Build** (`apply(cx, cz, blocks)`): when a chunk is generated, it takes its region's plan and runs every **piece** whose box touches the chunk. Writes outside the chunk are dropped (clipped). The neighbouring chunk runs the same piece later and keeps *its* part, so the structure comes out whole whichever chunk is generated first.
4. **Order inside a chunk:** terrain → caves → ores → plants → **structures** → trees. Trees are skipped within 3 blocks of a structure's box (`occupied()`).

### A plan

```js
{
  kind: 'village', x, y, z,        // anchor: centre column, y = ground height there
  box: [x0, z0, x1, z1],           // everything it touches, in world blocks
  style,                           // village style: block choices (see STYLES)
  pieces: [                        // what gets built
    { name: 'small', build, x, y, z, rot, box, style },  // y = this piece's floor height
    ...
  ],
  path: [[x, z], ...],             // cells whose ground top becomes path (gravel / sandstone)
  level: [[x, z, y], ...],         // path cells set to exactly height y (the two in front of each door)
}
```

### A piece's builder and its coordinates

A piece is built by its `build(ctx, piece)` function, which almost always starts with `const f = frame(ctx, piece)`. Inside a builder everything is in **local coordinates**:

- `ox`, `oz`: blocks from the piece's centre (`piece.x`, `piece.z`).
- `dy`: blocks above the piece's floor (`piece.y`). `dy = 0` is the floor itself, `dy = -1` the block under it.
- The **front faces -Z** (north), where the door is. The piece's `rot` (0–3, quarter turns clockwise seen from above) turns all of it. Villages turn each house to face the well; a pyramid gets a random `rot`.

| Helper | Does |
| --- | --- |
| `f.set(ox, dy, oz, id)` | put a block (use `0` for air) |
| `f.found(ox, oz, dy, id)` | fill downwards from `dy` with `id` until natural solid ground (max 12 blocks), so a building on a slope doesn't float |
| `f.face(f0)` | a facing (0 north, 1 east, 2 south, 3 west) in local terms, turned by the piece's `rot`; use it for doors, beds, ladders |
| `base(f, x0, z0, x1, z1, floor, height)` | floor at `dy 0` over a rectangle, foundation under it, air up to `height` above it |
| `walls(f, r, top, style, rd = r)` | hollow walls from `dy 1` to `top`, half-size `r` (x) by `rd` (z), logs at the corners |
| `roof(f, r, dy, style, rd = r)` | a flat roof at `dy`, stepped up and in when `style.steps` |
| `door(f, ox, oz, facing)` | both halves of an oak door (closed) |
| `bed(f, ox, oz, facing)` | foot at (ox, oz), head one step in `facing` |

Blocks are named through `B` (`B.sandstone`, `B.tnt`, `B.torch`…, every key in `src/blocks.js`). Blocks with several states come from `DECOR`:
- `DECOR.door.lower[open][facing]`
- `DECOR.ladder[facing]`
- `DECOR.pot.byPlant.get(B.poppy)`
- `DECOR.plate[wood][on]`: stone (0) or oak (1) pressure plate.
- `DECOR.lever[mount][on]`: `mount` is the face it sticks out of: 0 +X, 1 -X, 2 top, 3 bottom, 4 +Z, 5 -Z.

Things that need support must have it. A torch or plate needs a solid block under it. A ladder hangs on the block behind it: a facing-0 ladder is against the block on its north side.

---

## Editing the pyramid (the TNT trap, for example)

`buildPyramid` builds, with `dy` relative to the ground and the entrance at the front (-Z):
- **`dy 0`**: the 21×21 floor, with a wool pattern in its middle (`|ox| + |oz| <= 4`) and a blue wool block at the centre.
- **`dy 1–10`**: the stepped shell; layer `k` is a ring of half-size `10 - k`, and `dy 10` caps it. Orange wool runs along the front at `dy 5`.
- **The entrance**: `ox -1..1`, `dy 1..3`, cut from `oz -10` to `-6`.
- **`dy -1..-9`**: a ladder shaft under the centre block.
- **`dy -14..-10`**: the hidden room (walls, floor at `dy -14`, air inside), with gold and diamond blocks and torches in the corners.
- **`dy -15`**: 3×3 TNT under the room's floor.

The TNT lights when it gets redstone power. A pressure plate powers the block it stands on, and that block powers TNT next to it. So a plate on the room floor right above the TNT makes a working trap:

```js
// in buildPyramid, after the room is built:
f.set(0, -13, 0, DECOR.plate[0][0]);   // stone plate on the floor block (dy -14) above the TNT (dy -15)
```

Check it in the structure viewer (the plate shows on layer `-13`), then in a **new** world (see below).

## Adding a new structure kind

1. Write a builder: `function buildTower(ctx, p) { const f = frame(ctx, p); base(...); ... }`.
2. Write a planner that checks the ground and returns a plan with `finish({ kind: 'tower', x, y, z, pieces: [{ name: 'tower', build: buildTower, x, y, z, rot, box }], path: [], level: [] })`. The piece's `box` must cover everything it writes, or chunks outside the box won't build their part. Keep it within 20 blocks of the anchor.
3. Choose it in `makePlan` for some biome, and add `'tower'` to `STRUCTURE_KINDS` so `/locate tower` and the viewer know it.

---

## Changing structures and existing worlds: read this first

The terrain of every world with `gen: 2` (all worlds made since structures were added) is regenerated from the code whenever a chunk loads. Only the blocks players changed are saved. So when you change a builder, **existing version-2 worlds pick the change up as well**:
- Places nobody touched show the new version.
- Places where someone built or broke blocks keep exactly those edited blocks on top of the new structure, which can look odd: half old, half new.
- Changing *where* structures go (the planners, region size, probabilities, `site()` rules) moves them in existing worlds too.

That's fine while you're experimenting, or on a server you're about to reset. To keep released worlds exactly as they are:
1. Bump `GEN_VERSION` in `src/constants.js` (e.g. to 3). Only worlds created afterwards get the new number.
2. Keep the old behaviour for older numbers. Builders get the world's generator version as `ctx.version`, so they can branch on it, e.g. `if (ctx.version >= 3) f.set(0, -13, 0, DECOR.plate[0][0]);`. Planners can read `this.gen.version`.

Version 1 worlds (made before structures existed) never get structures, whatever you change here.
