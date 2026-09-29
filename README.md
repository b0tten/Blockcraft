# Blockcraft

A Minecraft-style voxel sandbox that runs in the browser, written from scratch: raw WebGL2, plain JavaScript modules, no engine, no libraries, and no image files. Every texture is painted procedurally at startup.

## Running it

ES modules and web workers must be served over HTTP (opening `index.html` from disk won't work):

```sh
npm start            # zero-dependency Node server on http://localhost:8080
# or
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Any static host (e.g. GitHub Pages) works too; there is no build step.

You need a browser with WebGL2: any current Chrome, Edge, Firefox or Safari.

## Features

- **Infinite procedural worlds** from a seed: continents and oceans, rivers, plains, forests, taiga, snowy tundra, deserts, beaches and 180-block mountains with snow caps
- **Caves**, lava pools, and coal, iron, gold and diamond ores
- **Trees** (oak, birch, spruce), cacti, sugar cane, flowers, grass and mushrooms
- **80 block types**, including glass, TNT, glowstone, torches, bookshelves, 16 wool colours and ore blocks
- **Lighting**: flood-fill sky light and block light (torches, glowstone, lava), smooth lighting and ambient occlusion
- **Day/night cycle** with sunsets, stars, a square sun and moon, and drifting clouds
- **Water and lava** that flow into holes you dig, swimming, and an underwater fog
- **TNT** with chain reactions, debris particles and knockback
- Creative-style building: break, place and pick blocks, an inventory with search, a hotbar, and a held-block view model
- Walking, sprinting, sneaking (it stops you walking off edges), jumping and flying
- Synthesised sound effects (Web Audio, no samples)
- **Multiple save slots** in `localStorage`, with autosave
- Chat commands: `/time set night`, `/tp`, `/give`, `/seed` and more (`/help`)
- Settings: render distance, FOV, sensitivity, render scale, volume, view bobbing, clouds

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Space | Jump / swim up / fly up |
| Space twice | Toggle flying |
| Shift | Sneak / fly down |
| Ctrl, R, or double-tap W | Sprint |
| Left click | Break block |
| Right click | Place block (right click TNT to light it) |
| Middle click | Pick block |
| 1–9, mouse wheel | Select hotbar slot |
| E | Inventory |
| T or / | Chat and commands |
| F1 / F3 | Hide HUD / debug overlay |
| Esc | Pause |

## How it works

```
index.html, style.css      page shell, menus and HUD
server.js                  tiny static file server
src/
  main.js                  game loop, interaction, commands
  constants.js, math.js    shared constants, matrix helpers, frustum culling
  noise.js                 seeded PRNG and simplex noise
  blocks.js                block registry (properties packed into typed arrays)
  textures.js              procedural 16×16 pixel-art painters
  icons.js                 isometric inventory icons
  player.js                movement and swept AABB collision
  raycast.js               voxel DDA for block picking
  fluids.js                flowing water and lava
  entities.js              primed TNT and explosions
  particles.js, hand.js    debris and smoke, first-person held block
  sky.js                   day/night colours and light levels
  audio.js                 Web Audio sound synthesis
  input.js, ui.js          pointer lock, keyboard/mouse, DOM UI
  storage.js               settings and world saves
  world/
    generator.js           terrain, biomes, caves, ores, trees (pure, runs in workers)
    worker.js              terrain generation worker
    world.js               chunk streaming, block edits, save format
    lighting.js            incremental BFS light propagation and removal
    mesher.js              face culling, AO and smooth light into packed vertices
  render/
    renderer.js            WebGL2 pipeline: chunks, sky, clouds, outline, sprites
    shaders.js             GLSL ES 3.0 shaders
```

- The world is split into 16×256×16 chunks. A pool of module workers generates terrain; the main thread lights and meshes chunks within a per-frame time budget, nearest first.
- Structures that cross chunk borders (trees) are placed deterministically from the seed, so every chunk can be generated independently.
- Light is stored per voxel as two 4-bit channels. Edits run incremental removal and propagation BFS passes, so placing a torch or digging only relights the affected area.
- Each vertex packs into 16 bytes (position, texture layer, UV, face, AO, sky and block light). All quads share one index buffer, and textures live in a `TEXTURE_2D_ARRAY` so mipmaps don't bleed.
- Rendering is camera-relative, so precision holds far from the origin. Chunks are frustum-culled and drawn front-to-back; water is drawn back-to-front afterwards.
- Saves store only the blocks you changed, keyed by chunk, and replay them on top of the regenerated terrain.
