// permessage-deflate on the game WebSocket (server/ws_compression.ts).
//
// The wire suites run a real ws WebSocketServer behind the same noServer +
// handleUpgrade path server/main.ts uses, then read the server's frames off a raw
// TCP socket so the RSV1 bit (set on a compressed message, RFC 7692) and the
// on-wire payload length are visible. The deploy suite pins the switch's path
// from the host .env to the process, like the deploy_*.test.ts family.

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket as WsSocket } from 'ws';
import { wsPerMessageDeflateOptions } from '../server/ws_compression';

// Vitest workers run with `--conditions browser`, so a bare 'ws' specifier (an
// import or a require) resolves to ws's browser stub, a function that throws.
// Load the Node build the bundled server uses by its file path instead.
const requireFromHere = createRequire(import.meta.url);
const wsNodeEntry = join(dirname(requireFromHere.resolve('ws/package.json')), 'index.js');
const { WebSocket, WebSocketServer } = requireFromHere(wsNodeEntry) as typeof import('ws');

// server/main.ts WS_MAX_PAYLOAD_BYTES (pinned by tests/server/tunables.test.ts).
const WS_MAX_PAYLOAD_BYTES = 16 * 1024;

interface Frame {
  compressed: boolean;
  opcode: number;
  length: number;
}

interface Harness {
  port: number;
  serverSocket: Promise<WsSocket>;
  close: () => Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function startServer(deflate: boolean): Promise<Harness> {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD_BYTES,
    perMessageDeflate: wsPerMessageDeflateOptions(deflate),
  });
  const server = http.createServer();
  let resolveSocket: (ws: WsSocket) => void = () => {};
  const serverSocket = new Promise<WsSocket>((resolve) => {
    resolveSocket = resolve;
  });
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      // A receiver error (the max-payload close) is emitted on the socket; the
      // game server listens for it too, so an unlistened one must not throw here.
      ws.on('error', () => {});
      resolveSocket(ws);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const close = async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  cleanups.push(close);
  return { port, serverSocket, close };
}

// A raw RFC 6455 client: sends the upgrade by hand and parses the server's
// (unmasked) frames, so the test sees exactly what crossed the wire.
async function rawClient(port: number, offerDeflate: boolean) {
  const socket = net.connect(port, '127.0.0.1');
  cleanups.push(async () => {
    socket.destroy();
  });
  const extensionHeader = offerDeflate
    ? 'Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n'
    : '';
  socket.write(
    'GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
      `${extensionHeader}\r\n`,
  );
  let buffer = Buffer.alloc(0);
  let headers: string | null = null;
  const frames: Frame[] = [];
  const waiters: (() => void)[] = [];
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (headers === null) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      headers = buffer.subarray(0, end).toString('latin1');
      buffer = buffer.subarray(end + 4);
    }
    while (buffer.length >= 2) {
      const short = buffer[1] & 0x7f;
      const offset = short === 126 ? 4 : short === 127 ? 10 : 2;
      if (buffer.length < offset) break;
      const length =
        short === 126
          ? buffer.readUInt16BE(2)
          : short === 127
            ? Number(buffer.readBigUInt64BE(2))
            : short;
      if (buffer.length < offset + length) break;
      frames.push({ compressed: (buffer[0] & 0x40) !== 0, opcode: buffer[0] & 0x0f, length });
      buffer = buffer.subarray(offset + length);
    }
    for (const wake of waiters.splice(0)) wake();
  });
  const until = async (done: () => boolean) => {
    while (!done()) await new Promise<void>((resolve) => waiters.push(resolve));
  };
  await until(() => headers !== null);
  return {
    headers: headers as unknown as string,
    frames,
    nextFrames: async (count: number) => {
      const start = frames.length;
      await until(() => frames.length >= start + count);
      return frames.slice(start, start + count);
    },
  };
}

// A snapshot-shaped frame under 1 KiB: the size class of a solo player's snapshot,
// below ws's default threshold (1024), which context takeover must not apply.
function snapshotFrame(tick: number): string {
  const ents = [101, 102, 103, 104, 105, 106].map((id, i) => ({
    id,
    x: round2(12.5 + i * 3.1 + tick * 0.05),
    y: -1.81,
    z: round2(128.97 - i * 2.4),
    f: 1.94,
    hp: 347 - i,
    mhp: 347,
    h: 1,
  }));
  return JSON.stringify({
    t: 'snap',
    tick,
    time: round2(tick / 20),
    tw: 1,
    self: {
      id: 7,
      x: round2(10 + tick * 0.35),
      y: -1.5,
      z: 130.25,
      f: 0.5,
      hp: 512,
      mhp: 512,
      res: 100,
      mres: 100,
      rtype: 'rage',
      tid: 101,
      auto: 1,
      queued: null,
      combo: 0,
      gcd: 0,
    },
    ents,
    keep: [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217],
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('wsPerMessageDeflateOptions', () => {
  it('returns the tuned options when enabled', () => {
    expect(wsPerMessageDeflateOptions(true)).toEqual({ zlibDeflateOptions: { level: 3 } });
  });

  it('returns false when the kill switch is thrown', () => {
    expect(wsPerMessageDeflateOptions(false)).toBe(false);
  });
});

describe('permessage-deflate on the wire', () => {
  it('negotiates the extension when the client offers it', async () => {
    const { port } = await startServer(true);
    const client = await rawClient(port, true);
    expect(client.headers).toMatch(/^HTTP\/1\.1 101 /);
    expect(client.headers.toLowerCase()).toContain('sec-websocket-extensions: permessage-deflate');
  });

  it('compresses a sub-1KiB snapshot and reuses context across frames', async () => {
    const { port, serverSocket } = await startServer(true);
    const client = await rawClient(port, true);
    const ws = await serverSocket;
    const first = snapshotFrame(100);
    const second = snapshotFrame(101);
    // Decisive size class: a solo player's snapshot, under the ws default threshold.
    expect(first.length).toBeGreaterThan(600);
    expect(first.length).toBeLessThan(1024);
    ws.send(first);
    ws.send(second);
    const [a, b] = await client.nextFrames(2);
    expect(a.opcode).toBe(1);
    expect(a.compressed).toBe(true);
    expect(a.length).toBeLessThan(first.length * 0.7);
    // Context takeover: the next tick is mostly back-references to this one.
    expect(b.compressed).toBe(true);
    expect(b.length).toBeLessThan(second.length * 0.25);
  });

  it('compresses even a tiny frame while context takeover is on', async () => {
    const { port, serverSocket } = await startServer(true);
    const client = await rawClient(port, true);
    const ws = await serverSocket;
    const tiny = JSON.stringify({ t: 'commandOutcome', rid: 42, ok: true });
    ws.send(tiny);
    ws.send(tiny);
    const [first, repeat] = await client.nextFrames(2);
    expect(first.compressed).toBe(true);
    expect(repeat.compressed).toBe(true);
    // The repeat is a back-reference into the shared window.
    expect(repeat.length).toBeLessThan(tiny.length / 4);
  });

  it('falls back to plain frames for a client that does not offer it', async () => {
    const { port, serverSocket } = await startServer(true);
    const client = await rawClient(port, false);
    expect(client.headers.toLowerCase()).not.toContain('sec-websocket-extensions');
    const ws = await serverSocket;
    const frame = snapshotFrame(100);
    ws.send(frame);
    const [received] = await client.nextFrames(1);
    expect(received.compressed).toBe(false);
    expect(received.length).toBe(frame.length);
  });

  it('declines the extension and sends plain frames with the kill switch thrown', async () => {
    const { port, serverSocket } = await startServer(false);
    const client = await rawClient(port, true);
    expect(client.headers.toLowerCase()).not.toContain('sec-websocket-extensions');
    const ws = await serverSocket;
    const frame = snapshotFrame(100);
    ws.send(frame);
    const [received] = await client.nextFrames(1);
    expect(received.compressed).toBe(false);
    expect(received.length).toBe(frame.length);
  });

  it('still caps a compressed client message at maxPayload after inflation', async () => {
    const { port, serverSocket } = await startServer(true);
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { perMessageDeflate: true });
    cleanups.push(async () => {
      client.terminate();
    });
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });
    expect(client.extensions).toContain('permessage-deflate');
    const ws = await serverSocket;
    let delivered = false;
    ws.on('message', () => {
      delivered = true;
    });
    // 20 KiB of one byte deflates to a few dozen bytes on the wire, so only the
    // inflated length can trip the cap.
    client.send('a'.repeat(20 * 1024));
    const code = await new Promise<number>((resolve) => client.once('close', resolve));
    expect(code).toBe(1009);
    expect(delivered).toBe(false);
  });
});

describe('the WebSocket compression switch reaches the server', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('server/main.ts builds the game WebSocketServer from the boot Config', () => {
    expect(read('server/main.ts')).toContain(
      'perMessageDeflate: wsPerMessageDeflateOptions(config.wsPerMessageDeflate)',
    );
  });

  it('docker-compose forwards WS_PERMESSAGE_DEFLATE to the game service, empty when unset', () => {
    const compose = read('docker-compose.yml');
    const service = compose.indexOf('\n  game:\n');
    const env = compose.indexOf('    environment:\n', service);
    const next = compose.slice(env + 1).search(/\n {4}[a-z_]+:/);
    const block = next === -1 ? compose.slice(env) : compose.slice(env, env + 1 + next);
    expect(service).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(service);
    expect(block).toContain('WS_PERMESSAGE_DEFLATE: ${WS_PERMESSAGE_DEFLATE:-}');
  });

  it('documents the switch where an operator looks for it', () => {
    expect(read('DEPLOY.md')).toContain('`WS_PERMESSAGE_DEFLATE` is a kill switch');
    expect(read('.env.example')).toContain('#WS_PERMESSAGE_DEFLATE=0');
  });
});
