// Pins the negative arm of the NATIVE_APP gate around the appStateChange
// listener wiring in src/net/online.ts (sibling to
// tests/net_online_native_lifecycle_reconnect.test.ts, which mocks
// NATIVE_APP: true for every case and so cannot catch a deleted
// `if (NATIVE_APP)` guard: a web build would then call the Capacitor plugin
// in a plain browser). This file mocks NATIVE_APP: false and asserts the
// native listener is never registered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: nativeMocks.addListener },
}));

vi.mock('../src/client_origin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client_origin')>();
  return { ...actual, NATIVE_APP: false };
});

import { ClientWorld } from '../src/net/online';
import type { PlayerClass } from '../src/sim/types';

const PROBE_CLASS: PlayerClass = 'warrior';

class StubWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  sent: string[] = [];
  constructor(public readonly url: string) {
    StubWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = StubWebSocket.CLOSED;
  }
  static instances: StubWebSocket[] = [];
}

describe('ClientWorld native App-lifecycle listener (non-native build)', () => {
  beforeEach(() => {
    nativeMocks.addListener.mockReset();
  });
  afterEach(() => {
    StubWebSocket.instances = [];
    vi.restoreAllMocks();
  });

  it('never registers an appStateChange listener when NATIVE_APP is false', async () => {
    const g = globalThis as Record<string, unknown>;
    const prevWebSocket = g.WebSocket;
    const prevWindow = g.window;
    g.WebSocket = StubWebSocket as unknown;
    g.window = {
      setInterval: () => 0,
      clearInterval: () => undefined,
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    };
    try {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      await Promise.resolve();
      await Promise.resolve();
      expect(nativeMocks.addListener).not.toHaveBeenCalled();
      world.close();
    } finally {
      g.WebSocket = prevWebSocket;
      g.window = prevWindow;
    }
  });
});
