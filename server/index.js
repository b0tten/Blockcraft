#!/usr/bin/env node
// Blockcraft dedicated server. No dependencies: `node server/index.js --help`.
// Serves the game itself over HTTP and the multiplayer protocol over WebSocket on one port.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { X509Certificate } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { acceptUpgrade } from './websocket.js';
import { GameServer } from './game.js';
import { loadWorld } from './storage.js';
import { parseSeed } from '../src/storage.js';
import { DEFAULT_PORT, PROTOCOL_VERSION } from '../src/net/protocol.js';

const HELP = `Blockcraft dedicated server

Usage: node server/index.js [options]

  --port <n>          port for HTTP + WebSocket (default ${DEFAULT_PORT}, env PORT)
  --host <addr>       interface to listen on (default all, env HOST)
  --world <dir>       world folder, created if missing (default data/world, env WORLD_DIR)
  --seed <text>       seed for a new world (env SEED; ignored for existing worlds)
  --name <text>       server name shown to players (env SERVER_NAME)
  --motd <text>       message shown when players join (env MOTD)
  --max-players <n>   player limit (default 20, env MAX_PLAYERS)
  --border <chunks>   world border: this many chunks each way from spawn (env BORDER)
  --reset-days <n>    start a fresh world every n days, e.g. 7 or 0.5 (env RESET_DAYS)
  --tls-cert <file>   certificate (PEM) to also serve https:// and wss:// (env TLS_CERT);
                      plain http:// keeps working on the same port, and renewed
                      certificate files are picked up automatically
  --tls-key <file>    private key (PEM) for --tls-cert (env TLS_KEY)
  -h, --help          show this help

Console commands: help, list, say <message>, kick <name> [reason], time set <time>,
daycycle <on|off>, reset, cert, save, stop`;

const OPTIONS = {
    port: { type: 'string' },
    host: { type: 'string' },
    world: { type: 'string' },
    seed: { type: 'string' },
    name: { type: 'string' },
    motd: { type: 'string' },
    'max-players': { type: 'string' },
    border: { type: 'string' },
    'reset-days': { type: 'string' },
    'tls-cert': { type: 'string' },
    'tls-key': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
};

function fail(message) {
  console.error(`${message}\nRun with --help to see the options.`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({ options: OPTIONS, allowPositionals: true });
} catch (err) {
  fail(err.message.replace(/^TypeError \[\w+\]: /, ''));
}
const opt = parsed.values;
// `npm run server --x 1` keeps --x for npm itself and passes only "1" on; with `--x=1`
// npm passes nothing but sets npm_config_x. Accept the latter, explain the former.
for (const [name, def] of Object.entries(OPTIONS)) {
  const v = process.env[`npm_config_${name.replace(/-/g, '_')}`];
  if (opt[name] === undefined && def.type === 'string' && v !== undefined && v !== 'true' && v !== '') opt[name] = v;
}
if (parsed.positionals.length) {
  const npm = process.env.npm_lifecycle_event ? ' npm keeps options written straight after "npm run server" for itself; put -- before them: npm run server -- --reset-days 1' : '';
  fail(`Unexpected argument "${parsed.positionals[0]}". Options look like --name value.${npm}`);
}
if (opt.help) {
  console.log(HELP);
  process.exit(0);
}

const env = process.env;
const port = Number(opt.port ?? env.PORT ?? DEFAULT_PORT);
const host = opt.host ?? env.HOST ?? undefined;
const dir = resolve(opt.world ?? env.WORLD_DIR ?? 'data/world');
const config = {
  name: String(opt.name ?? env.SERVER_NAME ?? 'Blockcraft Server').slice(0, 64),
  motd: String(opt.motd ?? env.MOTD ?? '').slice(0, 200),
  maxPlayers: Math.max(1, Number(opt['max-players'] ?? env.MAX_PLAYERS ?? 20) || 20),
  border: Math.max(0, Math.floor(Number(opt.border ?? env.BORDER ?? 0)) || 0),
  resetDays: Math.max(0, Number(opt['reset-days'] ?? env.RESET_DAYS ?? 0) || 0),
  seed: (opt.seed ?? env.SEED) ? parseSeed(opt.seed ?? env.SEED) : null,
};
const tlsCert = opt['tls-cert'] ?? env.TLS_CERT;
const tlsKey = opt['tls-key'] ?? env.TLS_KEY;

const log = (msg) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`);

// ------------------------------------------------------------ world

let loaded = await loadWorld(dir);
if (!loaded) {
  const seed = parseSeed(opt.seed ?? env.SEED ?? '');
  loaded = {
    meta: { name: basename(dir), seed, created: Date.now(), time: 0.03, dayCycle: true, spawn: null },
    edits: new Map(),
    players: {},
  };
  log(`Creating a new world in ${dir} (seed ${seed})`);
} else {
  log(`Loaded world "${loaded.meta.name}" from ${dir} (seed ${loaded.meta.seed}, ${loaded.edits.size} edited chunks)`);
  if (opt.seed ?? env.SEED) log('Note: --seed only applies when a new world is created');
}
const game = new GameServer({ dir, ...loaded, config, log });
await game.save();
game.start();

// ------------------------------------------------------------ HTTP: the game client and a status endpoint

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

// Only the files the browser needs: never the server code or the world data.
function publicPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') return join(root, 'index.html');
  if (pathname === '/style.css') return join(root, 'style.css');
  if (!pathname.startsWith('/src/')) return null;
  const path = normalize(join(root, pathname));
  return path.startsWith(join(root, 'src') + sep) ? path : null;
}

async function handle(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return res.writeHead(400).end();
  }
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(game.info()));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  let path;
  try {
    path = publicPath(decodeURIComponent(url.pathname));
  } catch {
    path = null;
  }
  if (!path || !(await stat(path).catch(() => null))?.isFile()) {
    return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
  const body = await readFile(path);
  res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const secure = !!(tlsCert && tlsKey);

function onUpgrade(req, socket, head) {
  socket.on('error', () => {});
  if (game.clients.size >= config.maxPlayers + 20) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return;
  }
  const ws = acceptUpgrade(req, socket, head, { maxMessage: 1 << 16 });
  if (ws) game.connect(ws, req.socket.remoteAddress || '?');
}

const httpServer = createHttpServer(handle);
httpServer.on('upgrade', onUpgrade);

// ------------------------------------------------------------ TLS (optional) and certificate renewal

const tls = { mtimes: '', expires: 0, warnedDay: '' };

function readCertificate() {
  const cert = readFileSync(tlsCert), key = readFileSync(tlsKey);
  tls.mtimes = `${statSync(tlsCert).mtimeMs}/${statSync(tlsKey).mtimeMs}`;
  tls.expires = Date.parse(new X509Certificate(cert).validTo);
  return { cert, key };
}

function certificateStatus() {
  const days = (tls.expires - Date.now()) / 86400000;
  const when = new Date(tls.expires).toLocaleString();
  if (days <= 0) return `The TLS certificate EXPIRED on ${when}: https/wss joins fail, but http://<this server's IP>:${port}/ still works. Renew it and it is picked up automatically.`;
  return `TLS certificate valid until ${when} (${Math.floor(days)} days left)`;
}

// Load renewed certificate files without a restart, and warn (daily) when expiry is near.
function checkCertificate(force = false) {
  try {
    const mtimes = `${statSync(tlsCert).mtimeMs}/${statSync(tlsKey).mtimeMs}`;
    if (force || mtimes !== tls.mtimes) {
      httpsServer.setSecureContext(readCertificate());
      log(`Loaded the TLS certificate again. ${certificateStatus()}`);
    }
  } catch (err) {
    log(`Could not reload the TLS certificate (keeping the current one): ${err.message}`);
  }
  const days = (tls.expires - Date.now()) / 86400000;
  const today = new Date().toDateString();
  if (days < 14 && tls.warnedDay !== today) {
    tls.warnedDay = today;
    log(days <= 0 ? certificateStatus() : `Warning: the TLS certificate expires in ${Math.max(0, Math.floor(days))} days (${new Date(tls.expires).toLocaleString()}). Renew it soon.`);
  }
}

let httpsServer = null;
let server = httpServer;
if (secure) {
  httpsServer = createHttpsServer(readCertificate(), handle);
  httpsServer.on('upgrade', onUpgrade);
  // One port, both protocols: a TLS connection starts with a handshake record (byte 0x16),
  // anything else is plain HTTP. So http://ip:port keeps working even if the certificate lapses.
  server = createNetServer((socket) => {
    socket.on('error', () => {});
    socket.setTimeout(15000, () => socket.destroy());
    socket.once('data', (first) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(first);
      (first[0] === 0x16 ? httpsServer : httpServer).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  });
  setInterval(() => checkCertificate(), 3600 * 1000).unref();
}

server.on('error', (err) => {
  log(`Server error: ${err.message}`);
  if (err.code === 'EADDRINUSE') process.exit(1);
});

server.listen(port, host, () => {
  log(`${config.name} is running on port ${port} (protocol v${PROTOCOL_VERSION}, up to ${config.maxPlayers} players)`);
  if (config.border) log(`World border: ${config.border} chunks each way from spawn`);
  if (game.nextReset) log(`The world resets every ${config.resetDays} day(s); next reset ${new Date(game.nextReset).toLocaleString()}`);
  log(`Play: open http://<this server's IP or domain>:${port}/ and choose Multiplayer`);
  if (secure) {
    log(`https://<your domain>:${port}/ and wss:// work too, so players can also join from https pages like GitHub Pages`);
    checkCertificate();
    log(certificateStatus());
  } else log('Tip: pages served over https (like GitHub Pages) can only join a server that has --tls-cert/--tls-key');
});

// ------------------------------------------------------------ console and shutdown

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  log('Stopping the server…');
  await game.stop('The server is shutting down');
  server.close();
  log('World saved. Bye!');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

createInterface({ input: process.stdin }).on('line', async (line) => {
  const text = line.trim().replace(/^\//, '');
  const [cmd = '', ...args] = text.split(/\s+/);
  switch (cmd.toLowerCase()) {
    case '':
      return;
    case 'help':
      return log('Commands: list, say <message>, kick <name> [reason], time set <time>, daycycle <on|off>, reset, cert, save, stop');
    case 'say':
      return args.length && game.announce(`[Server] ${args.join(' ')}`);
    case 'kick': {
      const c = [...game.byId.values()].find((o) => o.name.toLowerCase() === (args[0] || '').toLowerCase());
      if (!c) return log(`No player called "${args[0] ?? ''}" is online`);
      game.kick(c, args.slice(1).join(' ') || 'Kicked by an operator');
      return log(`Kicked ${c.name}`);
    }
    case 'reset':
      return game.resetWorld();
    case 'cert':
      if (!secure) return log('TLS is off (start with --tls-cert and --tls-key to enable it)');
      return checkCertificate(true);
    case 'save':
      await game.save();
      return log('World saved');
    case 'stop':
      return shutdown();
    default:
      return game.command(null, text);
  }
});
