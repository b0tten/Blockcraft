// Browser side of the multiplayer connection (see protocol.js for the messages).

import { PROTOCOL_VERSION, DEFAULT_PORT } from './protocol.js';

// Turn what the player typed ("host", "host:port", "ws://…", "https://…") into a WebSocket URL.
export function serverURL(address, page = location) {
  const text = String(address).trim();
  if (!text) throw new Error('Enter the address of a server.');
  const secure = page.protocol === 'https:';
  const hasScheme = /^(wss?|https?):\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text.replace(/^http/i, 'ws') : `${secure ? 'wss' : 'ws'}://${text}`);
  } catch {
    throw new Error(`"${text}" is not a valid server address.`);
  }
  if (!hasScheme && !url.port && !/:\d+(\/|$)/.test(text)) url.port = String(DEFAULT_PORT);
  if (secure && url.protocol === 'ws:') {
    throw new Error(
      'This page was loaded over https, so the browser only allows secure (wss://) connections. ' +
        "Open the game from the server's own address (http://host:port/) instead, or start the server with --tls-cert and --tls-key.",
    );
  }
  return url.href;
}

export class Connection {
  constructor(url, name, { onMessage, onClose }) {
    this.ops = []; // queued chunk subscriptions: kind (1 sub, 0 unsub), cx, cz
    this.reason = null;
    this.opened = false;
    this.closedByUs = false;
    const ws = (this.ws = new WebSocket(url));
    ws.onopen = () => {
      this.opened = true;
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name });
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'bye') this.reason = String(msg.reason || '');
      onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.closedByUs) return;
      const fallback = this.opened ? 'The connection to the server was lost.' : 'Could not reach the server. Check the address and that the server is running.';
      onClose(this.reason || e.reason || fallback);
    };
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(cx, cz) {
    this.ops.push(1, cx, cz);
  }

  unsubscribe(cx, cz) {
    this.ops.push(0, cx, cz);
  }

  // Send queued subscriptions, in order, in as few messages as possible.
  flush() {
    const ops = this.ops;
    if (!ops.length) return;
    this.ops = [];
    let kind = -1;
    let list = [];
    const out = () => {
      if (list.length) this.send({ t: kind ? 'sub' : 'unsub', c: list });
      list = [];
    };
    for (let i = 0; i < ops.length; i += 3) {
      if (ops[i] !== kind || list.length >= 1024) {
        out();
        kind = ops[i];
      }
      list.push(ops[i + 1], ops[i + 2]);
    }
    out();
  }

  close() {
    this.closedByUs = true;
    this.ws.close(1000);
  }
}
