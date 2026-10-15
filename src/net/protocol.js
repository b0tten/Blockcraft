// Multiplayer wire protocol, shared by the browser client and the Node server.
//
// Every WebSocket message is one JSON object with a `t` (type) field.
// Block positions are integers; `id` is a block id from blocks.js.
//
// Client -> server
//   hello  { v, name, bid, opKey? }    first message; v = PROTOCOL_VERSION; bid = this browser's
//                                      random ID (for bans); opKey from an `op`
//   pos    { p: [x, y, z], r: [yaw, pitch], f, ms }   own position, ~20 times a second while
//                                      moving; ms = sender's clock, for smooth playback
//   sub    { c: [cx, cz, cx, cz, ...] } start receiving edits for these chunks
//   unsub  { c: [cx, cz, ...] }        stop receiving edits for these chunks
//   set    { x, y, z, id, r, f }       break (id 0) or place an item; r = facing (0 north,
//                                      1 east, 2 south, 3 west), f = clicked face (0-5)
//   use    { x, y, z, id }             right-click a block (doors, levers, buttons, repeaters, flower pots) holding id
//   sign   { x, y, z, l: [4 lines] }   set the text of a sign
//   ignite { x, y, z }                 light a TNT block
//   swing  {}                          arm swing, shown to other players
//   hit    { id }                      punch a mob (knocked back; gone after two hits)
//   chat   { m }                       chat line, or a /command the server handles
//
// Server -> client
//   welcome { v, id, name, server, motd, seed, gen, time, cycle, spawn: [x, y, z], you, players: [{ id, name }] }
//   bye     { reason }                 sent right before the server closes the connection
//   chunk   { cx, cz, e: [index, id, ...], s: [[index, lines], ...] }   all edits and sign
//                                      text of a subscribed chunk (reply to sub)
//   blocks  { b: [x, y, z, id, ...] }  block changes in subscribed chunks, in the order they happened
//   players { s: [[id, x, y, z, yaw, pitch, f, ms], ...] }   other players that moved
//   join    { id, name }   leave { id, name }
//   chat    { m }
//   time    { v, c }                   time of day (0..1) and whether the cycle runs
//   tnt     { x, y, z, f }             primed TNT appeared (f = fuse seconds)
//   boom    { x, y, z, r, d: [x, y, z, id, ...] }   explosion (d = blocks to show debris for)
//   fx      { k: 'break' | 'place', x, y, z, id }   another player's edit, for particles and sound
//   swing   { id }
//   mobs    { s: [[id, kind, x, y, z, yaw, hurt], ...] }   mobs in loaded chunks that appeared
//                                      or moved; kind indexes MOB_KINDS in mobs.js, hurt is 0/1
//   mobgone { g: [[id, puff], ...] }   mobs removed (puff 1: punched away) or out of view
//   sign    { x, y, z, l }             someone changed a sign's text
//   tp      { p: [x, y, z] }           move the player (e.g. back from the world border)
//   (redstone needs no messages of its own: the server runs it and sends the resulting `blocks`)
//   op      { on, key? }               you became (or stopped being) an operator; send key back
//                                      as opKey when rejoining to keep it for a few minutes

export const PROTOCOL_VERSION = 5;
export const DEFAULT_PORT = 8765;
export const TICK_RATE = 20;
export const REACH = 6;
export const MAX_CHAT = 200;

// Player state flags in `pos` and `players`.
export const F_FLYING = 1;
export const F_SNEAKING = 2;

// Where singleplayer worlds live; the game sends players there when opened from a server.
export const OFFICIAL_SITE = 'https://b0tten.github.io/Blockcraft/';

export const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
export const NAME_RULES = 'Names are 1–16 letters, digits or underscores.';

// Chat commands the server runs (everything else is handled by the client).
export const SERVER_COMMANDS = new Set(['time', 'daycycle', 'list', 'who', 'ophelp', 'kick', 'say', 'op', 'deop', 'save', 'ban', 'unban', 'banlist', 'summon']);
