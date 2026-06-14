import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientWorld } from '../src/net/online';
import { emptyMoveInput } from '../src/sim/types';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  failSends: Error | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    sockets.push(this);
  }

  send(payload: string): void {
    if (this.failSends) throw this.failSends;
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('no-open-ws');
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }

  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

let sockets: FakeWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;
const hadWindow = 'window' in globalThis;
const originalWindow = (globalThis as any).window;

function makeWorld(): { world: ClientWorld; socket: FakeWebSocket } {
  const world = new ClientWorld('token', 42, 'warrior', 'http://realm.test');
  return { world, socket: sockets[0] };
}

function connect(world: ClientWorld, socket: FakeWebSocket): void {
  socket.open();
  socket.receive({ t: 'hello', pid: 7, seed: 20061, realm: 'Test Realm' });
  expect(world.connected).toBe(true);
}

describe('ClientWorld connection status', () => {
  beforeEach(() => {
    sockets = [];
    (globalThis as any).WebSocket = FakeWebSocket;
    (globalThis as any).window = { setInterval: vi.fn(() => 1) };
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    if (hadWindow) (globalThis as any).window = originalWindow;
    else delete (globalThis as any).window;
    vi.restoreAllMocks();
  });

  it('reports connection phase and sendability as the socket authenticates', () => {
    const { world, socket } = makeWorld();

    expect(socket.url).toBe('ws://realm.test/ws');
    expect(world.getConnectionStatus()).toMatchObject({
      phase: 'connecting',
      connected: false,
      canSend: false,
      socketState: 'connecting',
    });

    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ t: 'auth', token: 'token', character: 42 });
    expect(world.getConnectionStatus()).toMatchObject({
      phase: 'authenticating',
      connected: false,
      canSend: false,
      socketState: 'open',
    });

    socket.receive({ t: 'hello', pid: 7, seed: 20061, realm: 'Test Realm' });
    expect(world.getConnectionStatus()).toMatchObject({
      phase: 'connected',
      connected: true,
      canSend: true,
      socketState: 'open',
      reason: 'Connected to the realm.',
    });
  });

  it('rejects movement updates after the socket closes and reports why', () => {
    const { world, socket } = makeWorld();
    connect(world, socket);

    socket.serverClose();
    const accepted = world.setMoveInput({ ...emptyMoveInput(), forward: true });

    expect(accepted).toBe(false);
    expect(world.moveInput).toEqual(emptyMoveInput());
    expect(socket.sent).toHaveLength(1);
    expect(world.getConnectionStatus()).toMatchObject({
      phase: 'disconnected',
      connected: false,
      canSend: false,
      socketState: 'closed',
      lastSendFailure: {
        kind: 'input',
        reason: 'socket-not-open',
        phase: 'disconnected',
        socketState: 'closed',
      },
    });
  });

  it('turns no-open-ws send exceptions into explicit disconnected status', () => {
    const { world, socket } = makeWorld();
    const disconnects: string[] = [];
    world.onDisconnect = (reason) => disconnects.push(reason);
    connect(world, socket);
    world.setMoveInput({ ...emptyMoveInput(), forward: true });

    socket.failSends = new Error('no-open-ws');
    (world as any).sendInput();
    socket.serverClose();
    world.setMoveInput({ ...emptyMoveInput(), forward: true });

    expect(disconnects).toEqual(['Connection to the server stopped accepting messages.']);
    expect(world.moveInput).toEqual(emptyMoveInput());
    expect(world.getConnectionStatus()).toMatchObject({
      phase: 'disconnected',
      connected: false,
      canSend: false,
      socketState: 'closed',
      reason: 'Connection to the server stopped accepting messages.',
      lastSendFailure: {
        kind: 'input',
        reason: 'send-failed',
        message: 'no-open-ws',
      },
    });
  });

  it('keeps the rejected status when the server closes after an error frame', () => {
    const { world, socket } = makeWorld();
    const disconnects: string[] = [];
    world.onDisconnect = (reason) => disconnects.push(reason);

    socket.open();
    socket.receive({ t: 'error', error: 'character already in world' });
    socket.serverClose();

    expect(disconnects).toEqual(['character already in world']);
    expect(world.getConnectionStatus()).toMatchObject({
      phase: 'rejected',
      connected: false,
      canSend: false,
      socketState: 'closed',
      reason: 'character already in world',
    });
  });
});
