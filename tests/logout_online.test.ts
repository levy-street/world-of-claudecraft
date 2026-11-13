// The Log Out button's wiring through the online client (src/net/online.ts
// requestLogout / cancelLogout, the `events` hook and the socket-close hook),
// plus source pins for the two coordinator call sites no harness reaches
// (src/main.ts and src/ui/hud.ts). The flow itself is pinned in
// tests/logout_flow.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOGOUT_ACK_TIMEOUT_MS } from '../src/net/logout_flow';
import { ClientWorld } from '../src/net/online';
import type { SimEvent } from '../src/sim/types';

class StubWebSocket {
  static readonly OPEN = 1;
  static last: StubWebSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  readonly sent: string[] = [];
  constructor(public readonly url: string) {
    StubWebSocket.last = this;
  }
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(): void {
    /* no real socket */
  }
}

interface Timer {
  run: () => void;
  ms: number;
}

interface ClientInternals {
  onMessage(raw: string): void;
  socketClosed(): void;
  sessionEnded: boolean;
}

/** A live ClientWorld on a stub socket, with every window timer captured. */
function harness() {
  const g = globalThis as Record<string, unknown>;
  const prev = { WebSocket: g.WebSocket, window: g.window };
  const timers = new Map<number, Timer>();
  let nextTimer = 1;
  g.WebSocket = StubWebSocket as unknown;
  g.window = {
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: (run: () => void, ms: number) => {
      timers.set(nextTimer, { run, ms });
      return nextTimer++;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  };
  const world = new ClientWorld('logout-token', 1, 'warrior', 'http://localhost');
  const socket = StubWebSocket.last as StubWebSocket;
  const wire = world as unknown as ClientInternals;
  let done = 0;
  const logoutFrames = (): unknown[] =>
    socket.sent.map((raw) => JSON.parse(raw)).filter((frame) => frame.t === 'logout');
  const events = (list: SimEvent[]): void => wire.onMessage(JSON.stringify({ t: 'events', list }));
  const fireAckTimer = (): void => {
    for (const [id, timer] of [...timers]) {
      if (timer.ms !== LOGOUT_ACK_TIMEOUT_MS) continue;
      timers.delete(id);
      timer.run();
    }
  };
  const restore = (): void => {
    wire.sessionEnded = true; // no reconnect work after the test
    g.WebSocket = prev.WebSocket;
    g.window = prev.window;
  };
  return {
    world,
    wire,
    events,
    logoutFrames,
    fireAckTimer,
    restore,
    request: () =>
      world.requestLogout(() => {
        done++;
      }),
    done: () => done,
  };
}

describe('the Log Out button through the online client', () => {
  it('a countdown answer keeps the session alive past the legacy fallback; completed ends it once', () => {
    const h = harness();
    try {
      h.request();
      expect(h.logoutFrames()).toEqual([{ t: 'logout' }]);
      h.events([{ type: 'logout', phase: 'started', seconds: 10 }]);
      h.fireAckTimer();
      expect(h.done()).toBe(0);
      expect(h.wire.sessionEnded).toBe(false);

      h.events([{ type: 'logout', phase: 'completed' }]);
      expect(h.done()).toBe(1);
      expect(h.wire.sessionEnded).toBe(true);
    } finally {
      h.restore();
    }
  });

  it('the server events still reach the HUD queue', () => {
    const h = harness();
    try {
      h.request();
      h.events([
        { type: 'logout', phase: 'started', seconds: 10 },
        { type: 'logout', phase: 'countdown', seconds: 9 },
      ]);
      expect(h.world.drainEvents().filter((ev) => ev.type === 'logout')).toEqual([
        { type: 'logout', phase: 'started', seconds: 10 },
        { type: 'logout', phase: 'countdown', seconds: 9 },
      ]);
    } finally {
      h.restore();
    }
  });

  it('with no answer at all (a server from before the countdown) the fallback ends the session', () => {
    const h = harness();
    try {
      h.request();
      h.fireAckTimer();
      expect(h.done()).toBe(1);
    } finally {
      h.restore();
    }
  });

  it('cancelLogout sends the cancel frame while a countdown is up', () => {
    const h = harness();
    try {
      h.request();
      h.events([{ type: 'logout', phase: 'started', seconds: 10 }]);
      h.world.cancelLogout();
      expect(h.logoutFrames()).toEqual([{ t: 'logout' }, { t: 'logout', cancel: true }]);
    } finally {
      h.restore();
    }
  });

  it('a drop mid countdown takes the prompt down, keeps the session, and frees the button', () => {
    const h = harness();
    try {
      h.request();
      h.events([{ type: 'logout', phase: 'started', seconds: 30 }]);
      h.world.drainEvents();
      h.wire.socketClosed();
      expect(h.world.drainEvents()).toContainEqual({
        type: 'logout',
        phase: 'cancelled',
        reason: 'disconnected',
      });
      expect(h.done()).toBe(0);
      expect(h.wire.sessionEnded).toBe(false);
      // The button works again: a fresh press asks the server afresh.
      h.request();
      expect(h.logoutFrames()).toEqual([{ t: 'logout' }, { t: 'logout' }]);
    } finally {
      h.restore();
    }
  });

  it('a close before any answer ends the session; it never reconnects into the world', () => {
    const h = harness();
    try {
      h.request();
      h.wire.socketClosed();
      expect(h.done()).toBe(1);
      expect(h.wire.sessionEnded).toBe(true);
    } finally {
      h.restore();
    }
  });
});

describe('the coordinator call sites of the Log Out button', () => {
  const source = (path: string): string =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  it('main.ts reloads the page only from the completion callback', () => {
    const main = source('src/main.ts');
    expect(main).toMatch(
      /const done = \(\): void => \{\s*clearPlayMarker\(\);\s*location\.reload\(\);\s*\};\s*if \(online\) online\.requestLogout\(done\);\s*else done\(\);/,
    );
    expect(main).toMatch(/cancelLogout: \(\) => online\?\.cancelLogout\(\),/);
    // The old press-time teardown is gone from the game client.
    expect(main).not.toMatch(/sendLogout\(/);
  });

  it('hud.ts routes the server event to the countdown prompt and its Cancel back out', () => {
    const hud = source('src/ui/hud.ts');
    expect(hud).toMatch(/case 'logout':\s*this\.logoutCountdown\.apply\(ev\);\s*break;/);
    expect(hud).toMatch(/\(\) => this\.optionsHooks\?\.cancelLogout\(\),/);
  });
});
