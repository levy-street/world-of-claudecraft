// Pins src/net/guarded_socket.ts: handlers fire only while the socket is its
// owner's current transport.
import { afterEach, describe, expect, it } from 'vitest';
import { openGuardedSocket } from '../src/net/guarded_socket';

class StubWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public readonly url: string) {
    StubWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  static instances: StubWebSocket[] = [];
}

function withStubWebSocket<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const prev = g.WebSocket;
  g.WebSocket = StubWebSocket as unknown;
  try {
    return fn();
  } finally {
    g.WebSocket = prev;
  }
}

afterEach(() => {
  StubWebSocket.instances = [];
});

function makeOwner() {
  const log: string[] = [];
  const owner = { ws: undefined as WebSocket | undefined };
  const open = () =>
    openGuardedSocket('ws://x/ws', () => owner.ws, {
      auth: () => 'AUTH',
      message: (data) => log.push(`message:${data}`),
      close: () => log.push('close'),
    });
  return { log, owner, open };
}

describe('openGuardedSocket', () => {
  it('routes open, message, and close from the current socket to the owner', () => {
    withStubWebSocket(() => {
      const { log, owner, open } = makeOwner();
      owner.ws = open();
      const ws = StubWebSocket.instances[0];
      expect(ws.url).toBe('ws://x/ws');
      ws.onopen?.();
      expect(ws.sent).toEqual(['AUTH']);
      ws.onmessage?.({ data: 42 });
      ws.onclose?.();
      expect(log).toEqual(['message:42', 'close']);
    });
  });

  it('drops every event from a socket the owner has since replaced', () => {
    withStubWebSocket(() => {
      const { log, owner, open } = makeOwner();
      owner.ws = open();
      const stale = StubWebSocket.instances[0];
      owner.ws = open();
      stale.onopen?.();
      stale.onmessage?.({ data: 'late' });
      stale.onclose?.();
      expect(stale.sent).toEqual([]);
      expect(log).toEqual([]);
      const live = StubWebSocket.instances[1];
      live.onclose?.();
      expect(log).toEqual(['close']);
    });
  });
});
