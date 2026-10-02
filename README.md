# Blockcraft

A Minecraft-style voxel sandbox that runs in the browser, written from scratch: raw WebGL2, plain JavaScript modules, no engine, no libraries, and no image files. Every texture is painted procedurally at startup.

## Play online (GitHub Pages)

Every push to the repository's default branch is built and published by `.github/workflows/pages.yml`, so the game is served at `https://<user>.github.io/<repo>/`. To turn it on for a fork or new repo, open **Settings → Pages** and set **Source** to **GitHub Actions** (one time); the next push deploys it. The workflow can also be run by hand from the **Actions** tab.

`npm run build` produces the exact folder that gets published (`dist/`: just the HTML, CSS and `src/`), so you can check it locally or drop it on any other static host.

## Running it locally

ES modules and web workers must be served over HTTP (opening `index.html` from disk won't work):

```sh
npm start            # zero-dependency Node server on http://localhost:8080
# or
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Any static host (e.g. GitHub Pages) works too; there is no build step. For multiplayer, see [Multiplayer server](#multiplayer-server).

You need a browser with WebGL2: any current Chrome, Edge, Firefox or Safari.

## Multiplayer server

`server/` is a dedicated server you can run on your own machine or VPS. It needs Node.js 20 or newer and nothing else (no `npm install`):

```sh
npm run server                        # same as: node server/index.js
node server/index.js --port 8765 --world data/world --name "My Server" --motd "Be nice!"
```

With `npm run server`, put `--` before the options (`npm run server -- --border 32`), because npm keeps options written straight after the script name for itself.

Open the port (TCP 8765 by default) in your firewall or router. The server also hosts the game itself, so players just open `http://your-server:8765/`, click **Multiplayer**, pick a name and join (the address is filled in for them). From a copy of the game hosted anywhere else, type the server's address (`host`, `host:port` or a full `ws://` / `wss://` URL).

| Option | Environment | Default | |
| --- | --- | --- | --- |
| `--port` | `PORT` | `8765` | HTTP and WebSocket port |
| `--host` | `HOST` | all interfaces | address to listen on |
| `--world` | `WORLD_DIR` | `data/world` | world folder (created if missing) |
| `--seed` | `SEED` | random | seed for a new world |
| `--name`, `--motd` | `SERVER_NAME`, `MOTD` | | shown to players |
| `--max-players` | `MAX_PLAYERS` | `20` | |
| `--border` | `BORDER` | off | world border: chunks each way from spawn |
| `--reset-days` | `RESET_DAYS` | off | start a fresh world every *n* days (`7`, `0.5`, …) |
| `--tls-cert`, `--tls-key` | `TLS_CERT`, `TLS_KEY` | | also serve `https://` and `wss://` |

**World border.** With `--border 32`, the world is a 64×64-chunk square (1024×1024 blocks) centred on spawn. Players who walk or teleport past it are sent back to spawn, and blocks outside it can't be changed (water and explosions stop at it too). Since only changed blocks are stored, this caps how big the world files can get.

**Scheduled resets.** With `--reset-days 7`, the world starts over a week after it was created: everyone is warned in chat (1 hour, 10 minutes, 1 minute and 10 seconds before), then disconnected, and all edits and saved positions are wiped. The new world gets a random seed, or `--seed`'s if you set one. The schedule survives server restarts, and typing `reset` in the console resets right away.

Type `help` in the server's terminal for console commands: `list`, `say`, `kick`, `time set`, `daycycle`, `reset`, `cert`, `save` and `stop`. The world is saved every minute and when the server stops (Ctrl+C or `SIGTERM`), as JSON files in the world folder; back that folder up.

**Joining from GitHub Pages.** Pages are served over `https`, and browsers only let `https` pages open *secure* WebSocket connections. Either play from the server's own address (above), or give the server a TLS certificate for its domain, for example from Let's Encrypt: `--tls-cert /etc/letsencrypt/live/example.com/fullchain.pem --tls-key /etc/letsencrypt/live/example.com/privkey.pem`. A reverse proxy (Caddy, nginx) that terminates TLS and forwards WebSocket upgrades works too.

With a certificate, the port serves **both** `https://` and plain `http://`. So if the certificate ever lapses, players can still open `http://<server IP>:8765/` and play. The server checks the certificate files every hour and loads renewed ones without a restart, so a `certbot renew` cron job is enough. It also warns in its log daily during the last 14 days before expiry. Type `cert` in the console to see the expiry date, or to reload the files right away.

To keep it running, use a process manager, for example a systemd unit:

```ini
[Unit]
Description=Blockcraft server
After=network.target

[Service]
WorkingDirectory=/opt/blockcraft
ExecStart=/usr/bin/node server/index.js --port 8765 --name "My Server"
Restart=on-failure
User=blockcraft

[Install]
WantedBy=multi-user.target
```

What is shared: block edits, explosions, flowing water and lava, the time of day, chat and everyone's position (other players appear as blocky avatars with name tags). The server checks every edit (reach, block type, not inside another player) and has the final say. You see your own edits immediately, and the server corrects them if it refuses one. Chat commands in multiplayer: `/list`; `/time` and `/daycycle` change the time for everyone.

Current limits:

- **No accounts.** Anyone who can reach the port can join under any name that isn't already online, and a player's saved position belongs to their name. Don't expose a server you care about to the whole internet; restrict the port with a firewall if needed.
- Movement is trusted from each player's browser, so flying and `/tp` work as in singleplayer.
- Hotbars are kept in each player's browser.

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
- **Multiplayer** through a dependency-free dedicated server (see above)
- Chat commands: `/time set night`, `/tp`, `/give`, `/seed` and more (`/help`)
- Settings: render distance, FOV, sensitivity, render scale, volume, view bobbing, clouds
- Touch controls for phones and tablets
- A live, slowly rotating world behind the title screen

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

On phones and tablets: use the left-side joystick to move, drag anywhere to look, tap to place, press and hold to break, ↑ to jump (double-tap to fly), ↓ to sneak or fly down, and tap hotbar slots to select them.

## How it works

```
index.html, style.css      page shell, menus and HUD
server.js                  tiny static file server for local play
scripts/build-site.mjs     copies the game files into dist/ for hosting
.github/workflows/         GitHub Pages deployment
server/                    multiplayer server (Node, imports the game code from src/)
  index.js                 options, HTTP hosting of the game, console, shutdown
  game.js                  sessions, edit checks, liquids, TNT, time, chat, 20 Hz tick
  world.js                 server-side world: terrain from the seed plus edits
  websocket.js             minimal WebSocket (RFC 6455) server
  storage.js               world folder persistence
src/
  net/
    protocol.js            multiplayer message reference, shared with the server
    client.js              connection and server address handling
    players.js             other players: smoothed movement, avatars, name tags
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
  touch.js                 on-screen joystick and buttons
  storage.js               settings and world saves
  world/
    generator.js           terrain, biomes, caves, ores, trees (pure, runs in workers)
    worker.js              terrain generation worker
    world.js               chunk streaming, block edits, save format
    edits.js               edit maps and their compact JSON form
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
- Multiplayer never sends terrain. The browser and the server both generate it from the seed; when a player loads a chunk the server sends that chunk's edits, then streams every later change in order, so all players converge on the server's copy. The server runs the same generator, liquid and TNT code as the browser. Messages are JSON over WebSocket and are listed in `src/net/protocol.js`.
- Other players' positions are stamped with the sender's clock and replayed 120 ms behind, so their movement stays smooth even when packets arrive unevenly.
