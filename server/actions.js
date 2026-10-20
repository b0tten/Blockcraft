// Per-player block action log (--log-actions <n>): the last n block interactions of each
// player name, saved as actions.json in the world folder. For moderators: who placed or broke
// what, and who used levers, buttons, pressure plates and TNT.
//
// Breaking a block that the same player placed (and that is still in their log) removes both
// entries, so placing and breaking junk can't push real actions out of the log. Using the same
// lever, button or plate several times in a row is one entry with a count, for the same reason.

import { B, BLOCK_ITEM } from '../src/blocks.js';

const KEY = [];
for (const [key, id] of Object.entries(B)) KEY[id] = key;
const itemKey = (id) => KEY[BLOCK_ITEM[id]] ?? KEY[id] ?? String(id);

export class ActionLog {
  // `saved`: the contents of actions.json, if any.
  constructor(limit, saved) {
    this.limit = limit;
    this.players = {}; // lower-case name -> { name, actions: [{ time, action, block, x, y, z, n? }] }
    for (const [key, p] of Object.entries(saved?.players || {}))
      if (p && Array.isArray(p.actions)) this.players[key] = { name: String(p.name || key), actions: p.actions.slice(-limit) };
    this.dirty = true; // write it once at start, trimmed to this limit
  }

  list(name) {
    const key = name.toLowerCase();
    return (this.players[key] ||= { name, actions: [] }).actions;
  }

  add(name, action, id, x, y, z) {
    const list = this.list(name);
    const block = itemKey(id);
    const last = list[list.length - 1];
    if (action !== 'place' && action !== 'break' && last && last.action === action && last.block === block && last.x === x && last.y === y && last.z === z) {
      last.n = (last.n || 1) + 1;
      last.time = new Date().toISOString();
    } else {
      list.push({ time: new Date().toISOString(), action, block, x, y, z });
      if (list.length > this.limit) list.splice(0, list.length - this.limit);
    }
    this.dirty = true;
  }

  placed(name, id, x, y, z) {
    this.add(name, 'place', id, x, y, z);
  }

  // `id` is the block that was there before the break; `other` the other half of a door or
  // bed that went with it ([x, y, z], or null): a place logged there counts too.
  broke(name, id, x, y, z, other = null) {
    const list = this.list(name);
    const block = itemKey(id);
    const cells = other ? [[x, y, z], other] : [[x, y, z]];
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.action === 'place' && e.block === block && cells.some(([cx, cy, cz]) => e.x === cx && e.y === cy && e.z === cz)) {
        list.splice(i, 1);
        this.dirty = true;
        return;
      }
    }
    this.add(name, 'break', id, x, y, z);
  }

  toJSON() {
    return { limit: this.limit, players: this.players };
  }
}
