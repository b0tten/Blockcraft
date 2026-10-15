# Developer tools

Local helpers for changing how the game looks and sounds without restarting it over and over. They import the game's own modules from `src/`, so what they show and play is exactly what the game does. They aren't part of the GitHub Pages build (`npm run build` copies only `index.html`, `style.css` and `src/`).

```sh
npm start                     # serves the repository on http://localhost:8080
# then open http://localhost:8080/tools/
```

| Tool | What it's for |
| --- | --- |
| [`textures.html`](textures.html) | Every texture as the game paints it, mob previews (front, side, top), live reload while you edit `src/textures.js`, and a pixel editor that exports code you can paste back. `textures.html?t=cow_face` opens one texture straight away. |
| [`structures.html`](structures.html) | Villages, pyramids and wells for any seed, layer by layer or from above. Shows block names and coordinates relative to the structure, and rebuilds when `src/world/structures.js` changes. How structures are stored and edited: [structures.md](structures.md). |
| [`sounds.html`](sounds.html) | A button for every sound effect, re-read from `src/audio.js` on each click; a scratch pad for trying synth parameters; an oscilloscope; "repeat every n seconds" for tweaking. |

The game itself still paints its textures and builds its sounds once at start-up, so reload the game tab (F5) to see a change in the game.

---

## Textures

### Where they come from

There are no image files. Every texture is a 16×16 RGBA picture painted by a small function in `src/textures.js`:

```js
const PAINTERS = {
  stone: (t) => stone(t),
  ...
};
PAINTERS.cow_face = (t) => { ... };   // more are added further down the file
```

At start-up the game asks for every texture name it uses (`allTextureNames()` in `src/blocks.js`, plus `AVATAR_TEXTURES` in `src/net/players.js` and `MOB_TEXTURES` in `src/mobrender.js`). It paints each one with `paintTexture(name)` into one texture array. A name with no painter shows up as a **magenta and black checkerboard**, both in the game and in the texture tool.

### The painter API

A painter gets `t`, a 16×16 canvas. (0, 0) is the **top-left** pixel and y grows downwards, so on a block's side texture row 0 is the top edge of the block.

| Call | Does |
| --- | --- |
| `t.set(x, y, [r, g, b], a = 255)` | set one pixel (`[r, g, b, a]` works too) |
| `t.get(x, y)` | `[r, g, b, a]` of a pixel |
| `t.mul(x, y, f)` | darken (`f < 1`) or lighten (`f > 1`) a pixel |
| `t.speckle([r, g, b], amount)` | fill the whole tile with the colour, each pixel randomly ±`amount/2` brighter or darker |
| `t.clear()` | make every pixel transparent |
| `t.rand()`, `t.rnd(n)`, `t.pick(list)` | random number 0–1, integer 0–n-1, random element |

The random numbers are **seeded by the texture's name**, so a texture comes out the same every time. Change the painter code and the noise pattern changes with it.

Helpers in the same file:
- `scale(color, f)` and `mix(a, b, t)` for colours.
- `drawPattern(t, x0, y0, rows, color)` draws `'#'` characters from strings.
- Ready-made families: `stone`, `planks`, `wool`, `cobble`, `bricks`, `leaves`, `ore`, `metal`, …
- `pixelArt(t, palette, rows)` and `pixelData(t, base64)` take what the pixel editor exports (below).

Transparency: pixels with alpha below half are cut out, as for leaves, flowers and items. `paintTexture` fills transparent pixels with the average colour so mipmaps don't get dark fringes.

### How a texture lands on things

- **Plain blocks** in `src/blocks.js` name one texture (`tex: 'stone'`) or one per side (`tex: { top, bottom, side, front }`, where `front` faces south).
- **Shaped blocks** (doors, levers, pistons…) are box models in 1/16-block units. Each box face shows the part of the tile under it, so a 2-pixel-wide box shows a 2-pixel-wide strip of the texture.
- **Mobs** are boxes too, but **every face shows the whole 16×16 tile stretched over it**. A tile on a cow's 8×8-pixel head front fits pixel for pixel; on its 12×10 body side it is stretched. The models are `MOB_MODELS` in `src/mobrender.js`: one line per box, giving the textures for its 6 faces in the order **+X, -X, +Y (top), -Y (bottom), +Z (back), -Z (front)**, plus pivot, position and size in pixels. Mobs face -Z.

| Mob | Textures |
| --- | --- |
| pig | `pig_skin` (everything), `pig_face` (front of the head), `pig_snout` |
| cow | `cow_hide` (body, legs, sides of the head), `cow_face` (front of the head), `cow_horn` |
| sheep | `sheep_wool` (body, head), `sheep_face` (front of the head), `sheep_skin` (legs) |
| chicken | `chicken_white` (body, wings, head), `chicken_face`, `chicken_beak`, `chicken_wattle`, `chicken_leg` |

### Editing a texture, step by step (e.g. the cow)

1. Run `npm start` and open `http://localhost:8080/tools/textures.html?t=cow_hide`.
2. **To change it in code:** edit `PAINTERS.cow_hide` / `PAINTERS.cow_face` in `src/textures.js` and save. With "reload when src/textures.js changes" ticked, the tool repaints within a second, mob previews included. Hovering a pixel shows its coordinates and a ready-made `t.set(...)` line.
3. **To draw it by hand:** pick the texture and paint with the pencil, eraser and eyedropper. The tiles and mob previews update as you draw. Then press **Copy as code**. You get one of these:
   - `PAINTERS.cow_face = (t) => pixelArt(t, { a: [74, 50, 34], ... }, ['aaaa…', ...]);`, readable and easy to tweak by hand (up to 62 colours);
   - `PAINTERS.cow_face = (t) => pixelData(t, '…base64…');` when the picture has more colours than that, as speckled textures usually do.

   Paste it into `src/textures.js` **below** the texture's current painter (a later assignment wins), or replace the old painter with it.
4. Reload the game tab to see it in the world.

To give a mob a **new** texture, add the name to `MOB_TEXTURES` in `src/mobrender.js`, use it in the mob's model, and add a painter.

---

## Sounds

### Where they come from

There are no sound files either. `src/audio.js` has one `Sound` class built on two Web Audio primitives:

```js
s.tone({ freq, endFreq = freq, dur = 0.1, type = 'sine', gain = 0.2, delay = 0 })
// an oscillator gliding from freq to endFreq Hz; type: 'sine' | 'square' | 'sawtooth' | 'triangle'

s.burst({ freq, q = 1, type = 'bandpass', dur = 0.2, gain = 0.4, attack = 0.004, delay = 0, rate = 1, sweepTo = 0 })
// filtered white noise; type: 'bandpass' | 'lowpass' | 'highpass'; sweepTo glides the filter to that frequency
```

Every effect is a method that combines a few of these:

| Method | Played when |
| --- | --- |
| `mob(kind, gain)` | an animal within 16 blocks calls out (each one about every 10 s, quieter further away) |
| `mobHurt(kind)` | you punch an animal (a thud plus its call) |
| `blockBreak(material)`, `blockPlace(material)`, `step(material)` | breaking, placing, walking. The material is the block's `sound` in `src/blocks.js`, and its filter settings are in `MATERIALS` at the top of `src/audio.js` |
| `splash`, `swim`, `explosion`, `fuse`, `click`, `pop` | water, TNT, UI and the puff when an animal vanishes |

Notes:
- `gain` values add up when several sounds overlap. A single sound should peak well under 1.
- `delay` (seconds from now) is how multi-part calls are spaced out, like the pig's two grunts or the sheep's four-note bleat.
- `burst` randomises its pitch and filter by about ±10–15% every time, so repeated sounds don't feel mechanical.

### Editing a sound, step by step (e.g. the cow's moo)

1. Run `npm start` and open `http://localhost:8080/tools/sounds.html`.
2. Click **cow** under Animals to hear the current moo. It plays `mob('cow')` from `src/audio.js`.
3. To experiment, pick "Lower, longer moo" in the scratch pad (or write your own), change numbers and press ▶ Play (or Ctrl+Enter). The scratch pad is kept between visits.
4. When it sounds right, copy the lines into the `kind === 'cow'` branch of `mob()` in `src/audio.js`. Use `g(...)` round the gains there, so distance still makes it quieter. Save, then click **cow** again: the board re-reads the file on every click.
5. Tick "repeat the last sound" to keep hearing it while you edit and save.
