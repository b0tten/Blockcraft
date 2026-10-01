// Minimal WebSocket server side (RFC 6455) on top of node:http: text messages, ping/pong
// and close. No extensions, no dependencies.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BINARY = 0x2, OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xa;

// Complete the HTTP upgrade handshake. Returns a WebSocket, or null if the request was refused.
export function acceptUpgrade(req, socket, head, options = {}) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (req.method !== 'GET' || upgrade !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const ws = new WebSocket(socket, options);
  if (head && head.length) ws.receive(head);
  return ws;
}

export class WebSocket extends EventEmitter {
  constructor(socket, { maxMessage = 1 << 16, maxBuffered = 8 << 20 } = {}) {
    super();
    this.socket = socket;
    this.maxMessage = maxMessage;
    this.maxBuffered = maxBuffered;
    this.buf = Buffer.alloc(0);
    this.frags = null;
    this.fragBytes = 0;
    this.open = true;
    this.closeSent = false;
    this.alive = true;
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.receive(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  send(text) {
    if (!this.open) return;
    this.writeFrame(OP_TEXT, Buffer.from(text, 'utf8'));
    // A client that stops reading must not make us buffer without limit.
    if (this.socket.writableLength > this.maxBuffered) this.terminate();
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    this.open = false;
    const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this.writeFrame(OP_CLOSE, payload);
    this.closeSent = true;
    // Give the peer a moment to answer, then drop the connection regardless.
    setTimeout(() => this.terminate(), 2000).unref();
  }

  terminate() {
    this.open = false;
    this.socket.destroy();
    this.finish();
  }

  // Heartbeat: call periodically; a peer that didn't answer the previous ping is dropped.
  ping() {
    if (!this.open) return;
    if (!this.alive) return this.terminate();
    this.alive = false;
    this.writeFrame(OP_PING, Buffer.alloc(0));
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
  }

  fail(code, reason) {
    this.close(code, reason);
    this.buf = Buffer.alloc(0);
  }

  writeFrame(op, payload) {
    if (this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
      header.writeUInt32BE(len >>> 0, 6);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  receive(data) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      if (b[0] & 0x70) return this.fail(1002, 'Unexpected reserved bits');
      if (!(b[1] & 0x80)) return this.fail(1002, 'Client frames must be masked');
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this.fail(1009, 'Message too big');
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (len > this.maxMessage) return this.fail(1009, 'Message too big');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.frame(fin, op, payload);
      if (this.closed) return;
    }
  }

  frame(fin, op, payload) {
    if (!this.open && op !== OP_CLOSE) return; // closing: only the peer's close reply matters
    if (op >= 0x8) {
      if (!fin || payload.length > 125) return this.fail(1002, 'Bad control frame');
      if (op === OP_CLOSE) {
        if (!this.closeSent) this.writeFrame(OP_CLOSE, payload.subarray(0, 2));
        this.open = false;
        this.socket.end();
        return;
      }
      if (op === OP_PING) return this.writeFrame(OP_PONG, payload);
      if (op === OP_PONG) {
        this.alive = true;
        return;
      }
      return this.fail(1002, 'Unknown opcode');
    }
    this.alive = true;
    if (op === OP_CONT) {
      if (!this.frags) return this.fail(1002, 'Unexpected continuation frame');
    } else if (op === OP_TEXT || op === OP_BINARY) {
      if (this.frags) return this.fail(1002, 'Expected continuation frame');
      this.frags = [];
      this.fragBytes = 0;
      this.fragOp = op;
    } else return this.fail(1002, 'Unknown opcode');
    this.frags.push(payload);
    this.fragBytes += payload.length;
    if (this.fragBytes > this.maxMessage) return this.fail(1009, 'Message too big');
    if (!fin) return;
    const msg = this.frags.length === 1 ? this.frags[0] : Buffer.concat(this.frags);
    const kind = this.fragOp;
    this.frags = null;
    if (kind !== OP_TEXT) return this.fail(1003, 'Only text messages are supported');
    this.emit('message', msg.toString('utf8'));
  }
}
