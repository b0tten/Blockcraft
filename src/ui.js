// DOM side of the game: menus, hotbar, inventory, chat and debug overlay.

import { BLOCKS, INVENTORY_BLOCKS } from './blocks.js';
import { listWorlds, deleteWorld, loadMultiplayer } from './storage.js';
import { OFFICIAL_SITE } from './net/protocol.js';

const $ = (id) => document.getElementById(id);

// Quick-command buttons above the chat box. With nothing (or just "/...") typed they offer
// commands; tapping one types it, and once a command is typed its options appear.
const QUICK = {
  '/time': [['Day', '/time set day'], ['Noon', '/time set noon'], ['Sunset', '/time set sunset'], ['Night', '/time set night'], ['Midnight', '/time set midnight']],
  '/daycycle': [['On', '/daycycle on'], ['Off', '/daycycle off']],
};
// The game server marks the pages it serves, so other hosts never get asked for /api/info.
const servedByGameServer = () => !!document.querySelector('meta[name="blockcraft-server"]');

export class UI {
  constructor(game) {
    this.game = game;
    this.current = 'title';
    this.stack = [];
    this.selectedWorld = null;
    this.hoveredBlock = 0;

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      game.sound.click();
      this.onAction(btn.dataset.action);
    });

    this.buildHotbar();
    this.buildInventory();
    this.bindSettings();

    $('chat').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = $('chat-input').value.trim();
      this.closeChat();
      if (text) game.runChat(text);
      game.resume();
    });
    $('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeChat();
        game.resume();
      }
      e.stopPropagation();
    });
    $('chat-close').addEventListener('click', () => {
      this.closeChat();
      game.resume();
    });
    // Keep the chat box focused (and the phone keyboard open) when a quick button is tapped.
    $('chat-quick').addEventListener('pointerdown', (e) => e.preventDefault());
    $('chat-quick').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      game.sound.click();
      if (btn.dataset.fill) {
        const input = $('chat-input');
        input.value = `${btn.dataset.fill} `;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        this.renderQuick();
        return;
      }
      this.closeChat();
      game.runChat(btn.dataset.cmd);
      game.resume();
    });
    $('chat-input').addEventListener('input', () => this.renderQuick());
    $('click-to-play').addEventListener('click', () => game.resume());
    $('world-list').addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      this.selectWorld(item.dataset.id);
    });
    $('world-list').addEventListener('dblclick', (e) => {
      const item = e.target.closest('.item');
      if (item) game.playWorld(item.dataset.id);
    });
    $('new-name').addEventListener('keydown', (e) => e.key === 'Enter' && this.onAction('confirm-create'));
    $('new-seed').addEventListener('keydown', (e) => e.key === 'Enter' && this.onAction('confirm-create'));
    $('mp-address').addEventListener('keydown', (e) => e.key === 'Enter' && this.onAction('join-server'));
    $('mp-name').addEventListener('keydown', (e) => e.key === 'Enter' && this.onAction('join-server'));
  }

  setBackground(url) {
    document.documentElement.style.setProperty('--dirt', `url(${url})`);
  }

  // ------------------------------------------------------------ screens

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = true;
    this.current = id;
    if (id) $(`screen-${id}`).hidden = false;
  }

  push(id) {
    this.stack.push(this.current);
    this.show(id);
  }

  back() {
    const leaving = this.current;
    this.show(this.stack.pop() ?? 'title');
    if (leaving === 'settings') this.game.saveSettings();
  }

  reset(id) {
    this.stack = [];
    this.show(id);
  }

  onAction(action) {
    const g = this.game;
    switch (action) {
      case 'singleplayer':
        if (this.officialSite()) {
          $('official-text').textContent =
            `You opened Blockcraft from ${this.host.name}. Browsers keep saved worlds separately for every website, ` +
            'so worlds made here only exist at this address. Play singleplayer on the official site to keep all your worlds in one place.';
          this.push('official');
          break;
        }
        this.renderWorldList();
        this.push('worlds');
        break;
      case 'open-official':
        location.href = this.officialSite();
        break;
      case 'singleplayer-here':
        this.renderWorldList();
        this.push('worlds');
        break;
      case 'multiplayer':
        this.openMultiplayer();
        break;
      case 'join-server':
        this.setMpStatus('');
        g.joinServer($('mp-address').value.trim(), $('mp-name').value.trim());
        break;
      case 'reconnect':
        g.reconnect();
        break;
      case 'settings':
        this.syncSettings();
        this.push('settings');
        break;
      case 'controls':
        this.push('controls');
        break;
      case 'back':
        this.back();
        break;
      case 'create-world':
        $('new-name').value = 'New World';
        $('new-seed').value = '';
        this.push('create');
        $('new-name').focus();
        $('new-name').select();
        break;
      case 'confirm-create':
        g.createWorld($('new-name').value.trim() || 'New World', $('new-seed').value);
        break;
      case 'play-world':
        if (this.selectedWorld) g.playWorld(this.selectedWorld);
        break;
      case 'delete-world': {
        const w = listWorlds().find((x) => x.id === this.selectedWorld);
        if (w && window.confirm(`Delete "${w.name}"? This cannot be undone.`)) {
          deleteWorld(w.id);
          this.selectedWorld = null;
          this.renderWorldList();
        }
        break;
      }
      case 'resume':
        g.resume();
        break;
      case 'quit':
        g.quitToTitle();
        break;
    }
  }

  renderWorldList() {
    const list = listWorlds();
    const el = $('world-list');
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = '<div class="empty">No worlds yet — create one!</div>';
    }
    for (const w of list) {
      const item = document.createElement('div');
      item.className = 'item';
      item.dataset.id = w.id;
      const date = new Date(w.lastPlayed || w.created).toLocaleString();
      item.innerHTML = `<b></b><small></small>`;
      item.querySelector('b').textContent = w.name;
      item.querySelector('small').textContent = `Seed ${w.seed} · last played ${date}`;
      el.appendChild(item);
    }
    if (!list.find((w) => w.id === this.selectedWorld)) this.selectedWorld = list[0]?.id ?? null;
    this.selectWorld(this.selectedWorld);
  }

  // When the page itself comes from a Blockcraft server, remember its details.
  probeHost() {
    if (!servedByGameServer()) return;
    fetch('api/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info?.game === 'blockcraft') this.host = info;
      })
      .catch(() => {});
  }

  // The official site to send singleplayer to, if this page is served by a game server.
  officialSite() {
    if (!this.host || new URL(OFFICIAL_SITE).origin === location.origin) return null;
    return OFFICIAL_SITE;
  }

  openMultiplayer() {
    const saved = loadMultiplayer();
    $('mp-address').value = saved.address || '';
    $('mp-name').value = saved.name || `Player${Math.floor(100 + Math.random() * 900)}`;
    this.setMpStatus('');
    this.push('multiplayer');
    (saved.address ? $('mp-name') : $('mp-address')).focus();
    // When the page itself comes from a Blockcraft server, offer that server.
    if (!saved.address && servedByGameServer()) {
      fetch('api/info')
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => {
          if (info?.game !== 'blockcraft') return;
          this.host = info;
          if ($('mp-address').value) return;
          $('mp-address').value = location.host;
          this.setMpStatus(`${info.name}: ${info.players}/${info.max} players online`, true);
        })
        .catch(() => {});
    }
  }

  setMpStatus(text, info = false) {
    const el = $('mp-status');
    el.textContent = text;
    el.classList.toggle('info', info);
  }

  showDisconnected(title, reason) {
    $('disc-title').textContent = title;
    $('disc-text').textContent = reason;
    this.reset('disconnected');
  }

  setLoadingTitle(text, cancellable) {
    $('load-title').textContent = text;
    $('btn-cancel-load').hidden = !cancellable;
  }

  setQuitLabel(text) {
    $('btn-quit').textContent = text;
  }

  selectWorld(id) {
    this.selectedWorld = id;
    for (const item of document.querySelectorAll('#world-list .item')) item.classList.toggle('selected', item.dataset.id === id);
    $('btn-play').disabled = !id;
    $('btn-delete').disabled = !id;
  }

  // ------------------------------------------------------------ settings

  bindSettings() {
    for (const input of document.querySelectorAll('[data-setting]')) {
      input.addEventListener('input', () => {
        const key = input.dataset.setting;
        const s = this.game.settings;
        s[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
        this.syncSettings();
        this.game.applySettings();
      });
    }
  }

  syncSettings() {
    const s = this.game.settings;
    for (const input of document.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = !!s[key];
      else input.value = s[key];
    }
    for (const out of document.querySelectorAll('[data-out]')) out.textContent = s[out.dataset.out];
  }

  // ------------------------------------------------------------ HUD

  showHud(on) {
    $('hud').hidden = !on;
  }

  setHudVisible(on) {
    for (const id of ['crosshair', 'hotbar', 'item-name', 'nametags']) $(id).style.visibility = on ? '' : 'hidden';
  }

  buildHotbar() {
    const bar = $('hotbar');
    bar.innerHTML = '';
    this.hotbarSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = `<img alt="" hidden><span class="num">${i + 1}</span>`;
      bar.appendChild(s);
      this.hotbarSlots.push(s);
    }
  }

  updateHotbar(slots, selected) {
    const icons = this.game.icons;
    this.hotbarSlots.forEach((s, i) => {
      const img = s.querySelector('img');
      const id = slots[i];
      img.hidden = !id;
      if (id) img.src = icons.get(id) || '';
      s.classList.toggle('selected', i === selected);
    });
    this.renderInventoryHotbar();
  }

  showItemName(name) {
    const el = $('item-name');
    el.textContent = name;
    el.classList.add('show');
    clearTimeout(this.itemNameTimer);
    this.itemNameTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  toast(text, ms = 2000) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  setUnderwater(mode) {
    const el = $('underwater');
    el.classList.toggle('on', !!mode);
    el.classList.toggle('lava', mode === 'lava');
  }

  setDebug(text) {
    const el = $('debug');
    if (text === null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = '';
    for (const line of text.split('\n')) {
      const span = document.createElement('span');
      span.textContent = line;
      el.appendChild(span);
      el.appendChild(document.createTextNode('\n'));
    }
  }

  setFps(text) {
    const el = $('fps');
    el.hidden = text === null;
    if (text !== null) el.textContent = text;
  }

  setClickToPlay(on) {
    $('click-to-play').hidden = !on;
  }

  setLoading(progress, text) {
    $('load-bar').style.width = `${Math.round(progress * 100)}%`;
    $('load-text').textContent = text;
  }

  showError(message) {
    $('error-text').textContent = message;
    this.reset('error');
  }

  // ------------------------------------------------------------ chat

  // `now`: focus at once (from a tap, so phones open their keyboard); otherwise wait until
  // after the key that opened chat, so that key isn't typed.
  openChat(prefix = '', now = false) {
    const form = $('chat');
    form.hidden = false;
    $('hud').classList.add('chatting');
    const input = $('chat-input');
    input.value = prefix;
    const focus = () => {
      input.focus();
      input.setSelectionRange(prefix.length, prefix.length);
    };
    if (now) focus();
    else setTimeout(focus, 0);
    this.renderQuick();
    for (const d of $('chat-log').children) d.classList.remove('fade');
  }

  renderQuick() {
    const el = $('chat-quick');
    const text = $('chat-input').value.trim().toLowerCase();
    el.innerHTML = '';
    const add = (label, data) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.dataset, data);
      el.appendChild(b);
    };
    const quick = { ...QUICK };
    const g = this.game;
    if (g.net && g.isOp) {
      // Operators also get player commands, with the online players as options.
      const names = g.remote ? g.remote.names() : [];
      quick['/kick'] = names.map((n) => [n, `/kick ${n}`]);
      quick['/tp'] = names.map((n) => [n, `/tp ${n}`]);
      quick['/deop'] = [['Give up operator', '/deop']];
    }
    const typed = Object.keys(quick).find((cmd) => text === cmd || text.startsWith(`${cmd} `));
    if (typed) for (const [label, cmd] of quick[typed]) add(label, { cmd });
    else if (text === '' || (text.startsWith('/') && !text.includes(' ')))
      for (const cmd of Object.keys(quick)) if (cmd.startsWith(text)) add(cmd, { fill: cmd });
    el.hidden = !el.children.length;
  }

  closeChat() {
    $('chat').hidden = true;
    $('hud').classList.remove('chatting');
    $('chat-input').blur();
    this.fadeLog();
  }

  get chatOpen() {
    return !$('chat').hidden;
  }

  log(text) {
    const logEl = $('chat-log');
    const d = document.createElement('div');
    d.textContent = text;
    logEl.appendChild(d);
    while (logEl.children.length > 10) logEl.removeChild(logEl.firstChild);
    setTimeout(() => {
      if (!this.chatOpen) d.classList.add('fade');
    }, 8000);
  }

  fadeLog() {
    for (const d of $('chat-log').children) d.classList.add('fade');
  }

  // ------------------------------------------------------------ inventory

  buildInventory() {
    const grid = $('inv-grid');
    const tip = $('tooltip');
    this.invSlots = [];
    grid.innerHTML = '';
    for (const id of INVENTORY_BLOCKS) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.id = id;
      s.innerHTML = '<img alt="">';
      grid.appendChild(s);
      this.invSlots.push(s);
    }
    const hb = $('inv-hotbar');
    this.invHotbar = [];
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.index = i;
      s.innerHTML = '<img alt="" hidden>';
      hb.appendChild(s);
      this.invHotbar.push(s);
    }
    const panel = $('inventory');
    panel.addEventListener('mousemove', (e) => {
      const slot = e.target.closest('.slot');
      let id = 0;
      if (slot?.dataset.id) id = Number(slot.dataset.id);
      else if (slot?.dataset.index) id = this.game.hotbar[Number(slot.dataset.index)];
      this.hoveredBlock = slot?.dataset.id ? id : 0;
      if (id) {
        tip.hidden = false;
        tip.textContent = BLOCKS[id].name;
        tip.style.left = `${e.clientX + 14}px`;
        tip.style.top = `${e.clientY - 28}px`;
      } else tip.hidden = true;
    });
    panel.addEventListener('mouseleave', () => {
      tip.hidden = true;
      this.hoveredBlock = 0;
    });
    panel.addEventListener('mousedown', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot) {
        if (e.target === panel) this.game.closeInventory();
        return;
      }
      e.preventDefault();
      if (slot.dataset.id) this.game.setHotbarSlot(this.game.selected, Number(slot.dataset.id));
      else if (slot.dataset.index) this.game.selectSlot(Number(slot.dataset.index));
      this.game.sound.click();
    });
    $('inv-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const s of this.invSlots) s.hidden = q && !BLOCKS[Number(s.dataset.id)].name.toLowerCase().includes(q);
    });
    $('inv-search').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.game.closeInventory();
      }
      e.stopPropagation();
    });
  }

  setInventoryIcons() {
    for (const s of this.invSlots) s.querySelector('img').src = this.game.icons.get(Number(s.dataset.id)) || '';
  }

  renderInventoryHotbar() {
    if (!this.invHotbar) return;
    const g = this.game;
    this.invHotbar.forEach((s, i) => {
      const img = s.querySelector('img');
      const id = g.hotbar?.[i];
      img.hidden = !id;
      if (id) img.src = g.icons.get(id) || '';
      s.classList.toggle('selected', i === g.selected);
    });
  }

  openInventory() {
    $('inventory').hidden = false;
    $('inv-search').value = '';
    for (const s of this.invSlots) s.hidden = false;
    this.renderInventoryHotbar();
  }

  closeInventory() {
    $('inventory').hidden = true;
    $('tooltip').hidden = true;
    this.hoveredBlock = 0;
  }

  // ------------------------------------------------------------ sign editor

  openSignEditor(lines, onDone) {
    const el = $('sign-editor');
    const inputs = [...el.querySelectorAll('.sign-line')];
    const form = el.querySelector('form');
    inputs.forEach((inp, i) => (inp.value = lines[i] || ''));
    el.hidden = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.activeElement?.blur();
      el.hidden = true;
      form.onsubmit = null;
      for (const inp of inputs) inp.onkeydown = null;
      onDone(inputs.map((inp) => inp.value));
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      finish();
    };
    inputs.forEach((inp, i) => {
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          finish();
        } else if (e.key === 'Enter' && i < inputs.length - 1) {
          e.preventDefault();
          inputs[i + 1].focus();
        }
      };
    });
    this.signFinish = finish;
    inputs[0].focus();
    // Again after the click that opened it, in case leaving pointer lock moved focus.
    setTimeout(() => !done && el.contains(document.activeElement) === false && inputs[0].focus(), 0);
  }

  // Close without saving (leaving the world).
  closeSignEditor() {
    if (!this.signFinish) return;
    const el = $('sign-editor');
    el.querySelector('form').onsubmit = null;
    el.hidden = true;
    this.signFinish = null;
  }

  get inventoryOpen() {
    return !$('inventory').hidden;
  }
}
