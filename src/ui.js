// DOM side of the game: menus, hotbar, inventory, chat and debug overlay.

import { BLOCKS, INVENTORY_BLOCKS } from './blocks.js';
import { listWorlds, deleteWorld, loadMultiplayer } from './storage.js';

const $ = (id) => document.getElementById(id);

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
    if (!/^https?:$/.test(location.protocol)) return;
    fetch('api/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info?.game === 'blockcraft') this.host = info;
      })
      .catch(() => {});
  }

  // The official site to send singleplayer to, if this page is served by a game server.
  officialSite() {
    const home = this.host?.home;
    if (!home) return null;
    try {
      return new URL(home).origin === location.origin ? null : home;
    } catch {
      return null;
    }
  }

  openMultiplayer() {
    const saved = loadMultiplayer();
    $('mp-address').value = saved.address || '';
    $('mp-name').value = saved.name || `Player${Math.floor(100 + Math.random() * 900)}`;
    this.setMpStatus('');
    this.push('multiplayer');
    (saved.address ? $('mp-name') : $('mp-address')).focus();
    // When the page itself comes from a Blockcraft server, offer that server.
    if (!saved.address && /^https?:$/.test(location.protocol)) {
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

  openChat(prefix = '') {
    const form = $('chat');
    form.hidden = false;
    const input = $('chat-input');
    input.value = prefix;
    // Focus after the key event that opened chat, so the key itself isn't typed.
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(prefix.length, prefix.length);
    }, 0);
    for (const d of $('chat-log').children) d.classList.remove('fade');
  }

  closeChat() {
    $('chat').hidden = true;
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

  get inventoryOpen() {
    return !$('inventory').hidden;
  }
}
