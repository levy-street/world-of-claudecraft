// Regression for native-app-specific "frequent disconnection" reports. Inside a
// Capacitor WebView, document.visibilitychange (pinned for the mobile BROWSER
// case by tests/net_online_visibility_reconnect.test.ts) is an indirect signal
// the WebView itself must derive and forward, and real-world Android/iOS
// WebViews are documented as inconsistent about firing it on every OS-level
// backgrounding path (task-switcher swipe, home button, OEM battery
// management), unlike a plain browser tab. Capacitor's App plugin exists
// precisely for this: 'appStateChange' is wired directly to the native
// Activity.onPause/onResume (Android) / UIApplication background-foreground
// notifications (iOS). src/net/online.ts's ClientWorld now also listens for
// that event (NATIVE_APP-gated) and drives the exact same foreground/
// background recovery path the DOM listener drives; this file pins that
// wiring directly (StubWebSocket is OPEN-only and never otherwise exercises
// reconnect, same rationale as the DOM-focused sibling file above).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: nativeMocks.addListener },
}));

// Force the NATIVE_APP build flag on for this file only, so ClientWorld wires
// the appStateChange listener the way a packaged Android/iOS build would.
vi.mock('../src/client_origin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client_origin')>();
  return { ...actual, NATIVE_APP: true };
});

import { ClientWorld } from '../src/net/online';
import type { PlayerClass } from '../src/sim/types';
import type { ActionBarLayout } from '../src/world_api/action_bar';

const STUB_LAYOUT: ActionBarLayout = {
  v: 1,
  forms: { normal: { bar: [{ type: 'ability', id: 'a' }] } },
};

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

type CapturedTimer = { id: number; fn: () => void; delay: number };
interface TimerHarness {
  readonly timers: CapturedTimer[];
  fire(id: number): void;
}

// Same window/WebSocket stub shape as tests/net_online_visibility_reconnect.test.ts,
// minus the document stub: this file drives the NATIVE trigger exclusively, so
// document is left undefined (as it would be in a plain Node/native harness),
// proving the recovery path does not secretly depend on the DOM event too.
async function withNativeStubs<T>(fn: (harness: TimerHarness) => Promise<T> | T): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  const prevClearTimeout = g.clearTimeout as (id?: unknown) => void;
  const timers: CapturedTimer[] = [];
  let nextId = 1;
  const clearById = (id: number): boolean => {
    const idx = timers.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    timers.splice(idx, 1);
    return true;
  };
  g.WebSocket = StubWebSocket as unknown;
  g.window = {
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: (cb: () => void, delay = 0) => {
      const id = nextId++;
      timers.push({ id, fn: cb, delay });
      return id;
    },
    clearTimeout: (id: number) => {
      clearById(id);
    },
  };
  g.clearTimeout = (id: number) => {
    if (!clearById(id)) prevClearTimeout(id);
  };
  const harness: TimerHarness = {
    timers,
    fire(id: number) {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`no live timer with id ${id}`);
      const [timer] = timers.splice(idx, 1);
      timer.fn();
    },
  };
  try {
    return await fn(harness);
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
    g.clearTimeout = prevClearTimeout;
  }
}

// Registers the mock and returns the captured appStateChange listener once the
// constructor's addListener() promise has settled.
async function constructWithCapturedListener(): Promise<{
  world: ClientWorld;
  fireAppState: (isActive: boolean) => void;
}> {
  let captured: ((state: { isActive: boolean }) => void) | undefined;
  nativeMocks.addListener.mockImplementation(
    (eventName: string, listener: (state: { isActive: boolean }) => void) => {
      if (eventName === 'appStateChange') captured = listener;
      return Promise.resolve({ remove: nativeMocks.remove });
    },
  );
  const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
  // addListener() is async (a real Capacitor call crosses the native bridge);
  // flush the microtask queue so the constructor's .then() has run.
  await Promise.resolve();
  await Promise.resolve();
  if (!captured) throw new Error('appStateChange listener was never registered');
  return { world, fireAppState: (isActive) => captured?.({ isActive }) };
}

describe('ClientWorld native App-lifecycle reconnect (Capacitor appStateChange)', () => {
  beforeEach(() => {
    nativeMocks.addListener.mockReset();
    nativeMocks.remove.mockReset();
    nativeMocks.remove.mockResolvedValue(undefined);
  });
  afterEach(() => {
    StubWebSocket.instances = [];
    vi.restoreAllMocks();
  });

  it('registers exactly one appStateChange listener at construction (NATIVE_APP build)', async () => {
    await withNativeStubs(async () => {
      const { world } = await constructWithCapturedListener();
      expect(nativeMocks.addListener).toHaveBeenCalledTimes(1);
      expect(nativeMocks.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));
      world.close();
    });
  });

  it('isActive:false (backgrounding) does not touch the socket, mirroring the DOM hidden branch', async () => {
    await withNativeStubs(async (harness) => {
      const { world, fireAppState } = await constructWithCapturedListener();
      // canSendCommand() requires `connected`, which only flips true once the
      // server's auth ack lands; the stub socket never sends one, so set it
      // directly, matching the isActive:true zombie-socket case below.
      (world as unknown as { connected: boolean }).connected = true;
      // The one thing the background branch actually does is flush a pending
      // action-bar layout save; queue one so the assertion below is decisive
      // rather than just "the socket was left alone".
      world.saveActionBarLayout(STUB_LAYOUT);
      fireAppState(false);
      expect(StubWebSocket.instances.length).toBe(1);
      expect(harness.timers.length).toBe(0);
      const first = StubWebSocket.instances[0];
      const sentHotbarSave = first.sent.some((frame) => {
        const parsed = JSON.parse(frame) as { cmd?: string };
        return parsed.cmd === 'save_hotbar_layout';
      });
      expect(sentHotbarSave).toBe(true);
      world.close();
    });
  });

  it('isActive:true recovers a zombie socket the same way foregrounding a DOM tab does', async () => {
    await withNativeStubs(async () => {
      const { world, fireAppState } = await constructWithCapturedListener();
      const first = StubWebSocket.instances[0];

      // The OS killed the transport while the app was backgrounded (task-switcher
      // swipe, low-memory reclaim): readyState has moved off OPEN, but no onclose
      // ever reached this suspended app, so `connected` is still whatever it was.
      (world as unknown as { connected: boolean }).connected = true;
      first.readyState = StubWebSocket.CLOSED;

      fireAppState(true);

      // appStateChange('resumed'), with no visibilitychange ever having fired,
      // must still drive the zombie-socket recovery: connected flips false and a
      // reconnect is scheduled.
      expect((world as unknown as { connected: boolean }).connected).toBe(false);
      expect((world as unknown as { reconnectTimer: unknown }).reconnectTimer).not.toBeUndefined();
      world.close();
    });
  });

  it('isActive:true while a backoff timer is pending replaces it with the short spread retry', async () => {
    await withNativeStubs(async (harness) => {
      vi.spyOn(Math, 'random').mockReturnValue(0.75);
      const { world, fireAppState } = await constructWithCapturedListener();
      const first = StubWebSocket.instances[0];

      first.readyState = StubWebSocket.CLOSED;
      first.onclose?.();
      expect(harness.timers.length).toBe(1);
      const backoff = harness.timers[0];
      expect(backoff.delay).toBe(1_250); // attempt 1: 1000 * (0.5 + 0.75)

      fireAppState(true);

      expect(harness.timers.some((t) => t.id === backoff.id)).toBe(false);
      expect(harness.timers.length).toBe(1);
      const spread = harness.timers[0];
      expect(spread.delay).toBe(750); // 0.75 * the 0-1000ms spread window
      expect(StubWebSocket.instances.length).toBe(1); // still deferred, not opened yet

      harness.fire(spread.id);
      expect(StubWebSocket.instances.length).toBe(2);
      world.close();
    });
  });

  it('does nothing while the socket is genuinely open', async () => {
    await withNativeStubs(async (harness) => {
      const { world, fireAppState } = await constructWithCapturedListener();
      (world as unknown as { connected: boolean }).connected = true;
      fireAppState(false);
      fireAppState(true);
      // A regression that routed an OPEN socket into socketClosed() would still
      // pass an instance-count-only check (it schedules a reconnect timer rather
      // than opening a second socket): pin that no timer was armed and that
      // `connected` was never flipped, not just that no NEW socket appeared.
      expect(StubWebSocket.instances.length).toBe(1);
      expect(harness.timers.length).toBe(0);
      expect((world as unknown as { connected: boolean }).connected).toBe(true);
      world.close();
    });
  });

  it('close() removes the native listener once addListener has resolved', async () => {
    await withNativeStubs(async () => {
      const { world } = await constructWithCapturedListener();
      world.close();
      expect(nativeMocks.remove).toHaveBeenCalledTimes(1);
    });
  });

  it('a session ended before addListener resolves removes the handle instead of leaking it', async () => {
    await withNativeStubs(async () => {
      let resolveAddListener: ((handle: { remove: () => Promise<void> }) => void) | undefined;
      nativeMocks.addListener.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAddListener = resolve;
          }),
      );
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');

      // Session ends before the native bridge call ever settles (e.g. a fast
      // logout right after login).
      world.close();
      expect(nativeMocks.remove).not.toHaveBeenCalled();

      resolveAddListener?.({ remove: nativeMocks.remove });
      await Promise.resolve();
      await Promise.resolve();

      expect(nativeMocks.remove).toHaveBeenCalledTimes(1);
    });
  });
});
