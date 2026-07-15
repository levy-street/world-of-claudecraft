// Regression for the mobile "frequent disconnection" reports: iOS Safari and
// Android Chrome both suspend JS timers AND kill the underlying socket while
// a tab is backgrounded, often without ever delivering a close event to the
// frozen page, and any pending reconnect setTimeout is itself throttled to
// roughly once a minute in the background. Purely event-driven reconnect
// (onclose -> backoff -> retry) then leaves a player stuck on a zombie
// "connected" socket, or several backoff steps behind, right when they
// foreground the app again. src/net/online.ts's ClientWorld now listens for
// visibilitychange and force-checks the real socket state on resume; this
// file pins that behavior directly (world_api_parity.test.ts's StubWebSocket
// is OPEN-only and never exercises reconnect).
import { afterEach, describe, expect, it, vi } from 'vitest';
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

// Fake document: just enough of the EventTarget + visibilityState surface for
// the ctor's addEventListener / handleVisibilityChange's read / endSession's
// removeEventListener. Exposes setVisible() so a test can flip state and fire
// the listener the way a real 'visibilitychange' event would.
function makeFakeDocument() {
  let visibilityState: 'visible' | 'hidden' = 'visible';
  const listeners = new Set<() => void>();
  return {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: string, cb: () => void) {
      if (type === 'visibilitychange') listeners.add(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      if (type === 'visibilitychange') listeners.delete(cb);
    },
    setVisible(visible: boolean) {
      visibilityState = visible ? 'visible' : 'hidden';
      for (const cb of [...listeners]) cb();
    },
    listenerCount: () => listeners.size,
  };
}

type FakeDocument = ReturnType<typeof makeFakeDocument>;

// One captured, not-yet-fired timer plus the delay it was scheduled with, so a
// test can assert a new short spread timer replaced a cleared long backoff one.
type CapturedTimer = { id: number; fn: () => void; delay: number };

interface TimerHarness {
  // Live timers: scheduled but neither cleared nor fired yet.
  readonly timers: CapturedTimer[];
  // Fire a captured timer the way the event loop would: remove it first (a
  // one-shot timer is gone once it fires), then run its callback (which may
  // itself schedule a fresh timer).
  fire(id: number): void;
}

function withDomStubs<T>(fn: (doc: FakeDocument, harness: TimerHarness) => T): T {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  const prevDocument = g.document;
  const prevClearTimeout = g.clearTimeout as (id?: unknown) => void;
  const timers: CapturedTimer[] = [];
  let nextId = 1;
  const doc = makeFakeDocument();
  const clearById = (id: number): boolean => {
    const idx = timers.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    timers.splice(idx, 1);
    return true;
  };
  g.WebSocket = StubWebSocket as unknown;
  g.document = doc as unknown;
  g.window = {
    setInterval: () => 0,
    clearInterval: () => undefined,
    // Reconnect scheduling under test: capture without auto-firing, recording the
    // delay, so a test can assert whether a NEW timer replaced a cleared one and
    // inspect the scheduled spread.
    setTimeout: (cb: () => void, delay = 0) => {
      const id = nextId++;
      timers.push({ id, fn: cb, delay });
      return id;
    },
    clearTimeout: (id: number) => {
      clearById(id);
    },
  };
  // online.ts clears its reconnect timer via the bare global clearTimeout (in a
  // browser the same object as window.clearTimeout, but not under Node), so route
  // the global at the captured array too; forward any unrelated id to the real
  // clearTimeout so no foreign timer leaks.
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
    return fn(doc, harness);
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
    g.document = prevDocument;
    g.clearTimeout = prevClearTimeout;
  }
}

describe('ClientWorld visibilitychange reconnect (mobile background/foreground)', () => {
  afterEach(() => {
    StubWebSocket.instances = [];
    vi.restoreAllMocks();
  });

  it('registers exactly one visibilitychange listener at construction and removes it on close()', () => {
    withDomStubs((doc) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      expect(doc.listenerCount()).toBe(1);
      world.close();
      expect(doc.listenerCount()).toBe(0);
    });
  });

  it('foregrounding onto a zombie socket (still "open" per JS state, but the real transport is dead) drives a fresh reconnect', () => {
    withDomStubs((doc) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const first = StubWebSocket.instances[0];
      expect(first.readyState).toBe(StubWebSocket.OPEN);

      // Simulate the OS killing the transport out from under the page while
      // backgrounded: the readyState the browser now reports has moved off
      // OPEN, but onclose was never delivered to the frozen page, so
      // ClientWorld.connected is still whatever it was (true, once hello
      // landed) and no reconnect is scheduled.
      (world as unknown as { connected: boolean }).connected = true;
      first.readyState = StubWebSocket.CLOSED;

      doc.setVisible(false);
      expect(StubWebSocket.instances.length).toBe(1); // hidden: no reconnect attempt
      expect((world as unknown as { connected: boolean }).connected).toBe(true);

      doc.setVisible(true);
      // No close event was ever delivered for this zombie socket, so the
      // resume handler must drive the same "connected -> false, schedule a
      // reconnect" path a real close would have, instead of doing nothing
      // because ClientWorld still (wrongly) believes it is connected.
      expect((world as unknown as { connected: boolean }).connected).toBe(false);
      expect((world as unknown as { reconnectTimer: unknown }).reconnectTimer).not.toBeUndefined();
      world.close();
    });
  });

  it('foregrounding while a backoff timer is still pending replaces it with a short spread retry, not the full backoff wait', () => {
    withDomStubs((doc, harness) => {
      // Pin the rng so both scheduled delays are exact values, not just bands:
      // regressions that collapse the spread to a constant, shrink its range, or
      // swap computeBackoffDelay's arguments all change these literals.
      vi.spyOn(Math, 'random').mockReturnValue(0.75);
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const first = StubWebSocket.instances[0];

      // A real close: readyState moves off OPEN and onclose fires, scheduling
      // the long exponential backoff reconnectTimer via the stubbed
      // window.setTimeout above (captured, not auto-fired).
      first.readyState = StubWebSocket.CLOSED;
      first.onclose?.();
      expect(StubWebSocket.instances.length).toBe(1); // still waiting on backoff
      expect(harness.timers.length).toBe(1);
      const backoff = harness.timers[0];
      // Attempt 1 through the real socketClosed wiring: base 1000 * (0.5 + 0.75)
      // = 1250. Feeding the wrong constants or swapping the base/max arguments
      // of computeBackoffDelay lands on a different value.
      expect(backoff.delay).toBe(1_250);

      doc.setVisible(true);
      // Foregrounding does not wait out the long backoff: it clears that pending
      // timer and schedules a NEW one in its place (a short 0 to 1000 ms random
      // spread), rather than opening a socket on the same beat as every other
      // foregrounded tab.
      expect(harness.timers.some((t) => t.id === backoff.id)).toBe(false); // old cleared
      expect(harness.timers.length).toBe(1); // exactly one live timer, the replacement
      const spread = harness.timers[0];
      expect(spread.id).not.toBe(backoff.id);
      // 0.75 * the 1000 ms spread window exactly; the band bounds follow from
      // this linear map for any rng in [0, 1).
      expect(spread.delay).toBe(750);
      expect(spread.delay).toBeGreaterThanOrEqual(0);
      expect(spread.delay).toBeLessThanOrEqual(1_000);
      expect(StubWebSocket.instances.length).toBe(1); // still deferred, not opened yet

      // firing the spread timer by hand performs the deferred retry
      harness.fire(spread.id);
      expect(StubWebSocket.instances.length).toBe(2);
      world.close();
    });
  });

  it('never stacks timers across repeated foreground events while the short retry is pending', () => {
    withDomStubs((doc, harness) => {
      // One rng draw per schedule, in order: the backoff (0.5), then one spread
      // draw per foreground event. Distinct values prove each event re-rolls a
      // fresh spread timer rather than keeping the first one alive.
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.999999)
        .mockReturnValueOnce(0)
        .mockReturnValue(0.42);
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const first = StubWebSocket.instances[0];
      first.readyState = StubWebSocket.CLOSED;
      first.onclose?.(); // long backoff scheduled
      expect(harness.timers.length).toBe(1);

      // Several visibilitychange events in a row (a phone unlock storm): each
      // clears the pending spread timer and schedules a fresh one in the same
      // slot, so there is never a second live timer and never a double open.
      doc.setVisible(true);
      doc.setVisible(true);
      doc.setVisible(true);
      expect(harness.timers.length).toBe(1);
      const only = harness.timers[0];
      // The survivor is the LAST draw's timer (0.42 * 1000), proving the earlier
      // spread timers (999.999..., 0) were each cleared on replacement.
      expect(only.delay).toBe(420);
      expect(only.delay).toBeLessThanOrEqual(1_000);

      harness.fire(only.id);
      expect(StubWebSocket.instances.length).toBe(2); // exactly one new socket
      expect(harness.timers.length).toBe(0);
      world.close();
    });
  });

  it('a zombie-socket manual close followed by the late real onclose is one drop: one timer, one attempt', () => {
    withDomStubs((doc, harness) => {
      vi.spyOn(Math, 'random').mockReturnValue(0.75);
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const first = StubWebSocket.instances[0];
      // Zombie socket: the transport died while backgrounded, no close event was
      // delivered, ClientWorld still believes it is connected.
      (world as unknown as { connected: boolean }).connected = true;
      first.readyState = StubWebSocket.CLOSED;

      // Foregrounding drives socketClosed() manually (the zombie branch), which
      // schedules the first backoff timer.
      doc.setVisible(true);
      expect(harness.timers.length).toBe(1);
      const manual = harness.timers[0];

      // The browser finally delivers the zombie socket's real close event. That
      // is a duplicate signal of the SAME physical drop, so the second entry
      // must be a no-op: the pending timer survives untouched (never two live
      // timers, never a double openSocket) and the attempt is not double-counted
      // (each zombie drop would otherwise burn two of the bounded attempts).
      first.onclose?.();
      expect(harness.timers.length).toBe(1);
      expect(harness.timers[0].id).toBe(manual.id);
      expect((world as unknown as { reconnectAttempts: number }).reconnectAttempts).toBe(1);

      // Firing the survivor opens exactly one replacement socket.
      harness.fire(manual.id);
      expect(StubWebSocket.instances.length).toBe(2);
      expect(harness.timers.length).toBe(0);
      world.close();
    });
  });

  it('a late duplicate close at the attempt cap does not end the session while the final retry is pending', () => {
    withDomStubs((doc, harness) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const first = StubWebSocket.instances[0];
      let disconnected = '';
      world.onDisconnect = (reason) => {
        disconnected = reason;
      };
      // Sit one below RECONNECT_MAX_ATTEMPTS (40 in src/net/online.ts): the
      // manual zombie close below burns the FINAL attempt and schedules the
      // last legitimate retry.
      (world as unknown as { reconnectAttempts: number }).reconnectAttempts = 39;
      (world as unknown as { connected: boolean }).connected = true;
      first.readyState = StubWebSocket.CLOSED;
      doc.setVisible(true);
      expect(harness.timers.length).toBe(1);

      // The zombie socket's real onclose lands late. Counted as a fresh drop it
      // would hit the attempts >= MAX branch: endSession() clears the pending
      // final retry and onDisconnect dumps the player, all on ONE physical drop.
      first.onclose?.();
      expect(disconnected).toBe('');
      expect(harness.timers.length).toBe(1);

      // The final retry actually happens.
      harness.fire(harness.timers[0].id);
      expect(StubWebSocket.instances.length).toBe(2);
      world.close();
    });
  });

  it('does not re-schedule or re-open when foregrounded again while the fresh socket is still connecting', () => {
    withDomStubs((doc, harness) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const first = StubWebSocket.instances[0];
      first.readyState = StubWebSocket.CLOSED;
      first.onclose?.(); // long backoff scheduled
      doc.setVisible(true); // replaced with the short spread timer
      const spread = harness.timers[0];

      // Fire the spread retry by hand: its callback clears reconnectTimer, then
      // opens the second socket. That socket is still CONNECTING (no hello yet).
      harness.fire(spread.id);
      expect(StubWebSocket.instances.length).toBe(2);
      const second = StubWebSocket.instances[1];
      second.readyState = StubWebSocket.CONNECTING;
      expect(harness.timers.length).toBe(0); // the retry timer is spent, none pending

      // Foregrounding again now must be a no-op: reconnectTimer is undefined (the
      // callback cleared its own stale handle) and the socket is not OPEN, so the
      // zombie branch sees connected === false and neither schedules a timer nor
      // opens a third socket.
      doc.setVisible(true);
      expect(StubWebSocket.instances.length).toBe(2);
      expect(harness.timers.length).toBe(0);
      world.close();
    });
  });

  it('does nothing while the socket is genuinely open', () => {
    withDomStubs((doc) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      expect(StubWebSocket.instances.length).toBe(1);
      doc.setVisible(false);
      doc.setVisible(true);
      expect(StubWebSocket.instances.length).toBe(1);
      world.close();
    });
  });

  it('clears the backoff timer handle when it fires, so a foreground during CONNECTING stays a no-op', () => {
    withDomStubs((doc, harness) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const first = StubWebSocket.instances[0];
      first.readyState = StubWebSocket.CLOSED;
      first.onclose?.(); // long backoff scheduled
      expect(harness.timers.length).toBe(1);

      // Fire the BACKOFF timer itself (not a spread replacement): its callback
      // must clear its own reconnectTimer handle before opening the new socket.
      harness.fire(harness.timers[0].id);
      expect(StubWebSocket.instances.length).toBe(2);
      StubWebSocket.instances[1].readyState = StubWebSocket.CONNECTING;
      expect(harness.timers.length).toBe(0);

      // A stale handle here would send this foreground event down the
      // pending-timer branch and schedule a spread retry toward a THIRD socket;
      // the self-clear keeps it a no-op instead.
      doc.setVisible(true);
      expect(harness.timers.length).toBe(0);
      expect(StubWebSocket.instances.length).toBe(2);
      world.close();
    });
  });

  it('close() clears a pending spread retry so nothing opens a socket after the session ends', () => {
    withDomStubs((doc, harness) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const first = StubWebSocket.instances[0];
      first.readyState = StubWebSocket.CLOSED;
      first.onclose?.(); // long backoff scheduled
      doc.setVisible(true); // replaced with the short spread timer, still pending
      expect(harness.timers.length).toBe(1);

      // Ending the session while the spread retry is pending must clear it; a
      // leaked live timer would call openSocket after the session is over.
      world.close();
      expect(harness.timers.length).toBe(0);
      expect(StubWebSocket.instances.length).toBe(1);
    });
  });
});

// The error-frame tolerance wiring: the pure predicates in reconnect_policy.ts
// are unit-tested in linkdead.test.ts, but ClientWorld consuming them is real
// behavior of its own. These drive onMessage with wire frames mid-reconnect and
// pin the tolerate / count-on-own-counter / reset-on-hello loop end to end.
describe('ClientWorld reconnect error-frame tolerance (auth timeout)', () => {
  afterEach(() => {
    StubWebSocket.instances = [];
    vi.restoreAllMocks();
  });

  // Reach the private wiring the way snapshots.test.ts reaches applySnapshot:
  // the members under test are private on purpose (nothing outside ClientWorld
  // consumes them), so the probe goes through an any-cast.
  type WorldProbe = {
    onMessage(raw: string): void;
    timeoutRejections: number;
    conflictRejections: number;
    sessionEnded: boolean;
  };

  it('tolerates the auth-timeout rejection mid-reconnect on its own counter and resets it on hello', () => {
    withDomStubs((doc, harness) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const w = world as unknown as WorldProbe;
      const first = StubWebSocket.instances[0];
      first.readyState = StubWebSocket.CLOSED;
      first.onclose?.(); // reconnectAttempts is now 1: mid-reconnect
      expect(harness.timers.length).toBe(1);

      w.onMessage(JSON.stringify({ t: 'error', error: 'authentication timed out' }));
      // Tolerated: the session survives, counted on the timeout counter and
      // NEVER on the conflict counter (a swapped counter flips both pins).
      expect(w.sessionEnded).toBe(false);
      expect(w.timeoutRejections).toBe(1);
      expect(w.conflictRejections).toBe(0);

      // The post-reconnect hello restores the full tolerance budget for the
      // next drop; without this reset the counter climbs across a session's
      // lifetime and wrongly ends it after 20 cumulative auth timeouts.
      w.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 42 }));
      expect(w.timeoutRejections).toBe(0);
      world.close();
    });
  });

  it('still ends the session for good on any other rejection mid-reconnect', () => {
    withDomStubs((doc, harness) => {
      const world = new ClientWorld('t', 1, PROBE_CLASS, 'http://localhost');
      const w = world as unknown as WorldProbe;
      const reasons: string[] = [];
      world.onDisconnect = (reason) => {
        reasons.push(reason);
      };
      const first = StubWebSocket.instances[0];
      first.readyState = StubWebSocket.CLOSED;
      first.onclose?.(); // mid-reconnect, backoff pending

      w.onMessage(JSON.stringify({ t: 'error', error: 'not authenticated' }));
      expect(w.sessionEnded).toBe(true);
      expect(reasons).toEqual(['not authenticated']); // verbatim server text
      expect(harness.timers.length).toBe(0); // the pending retry died with the session
    });
  });
});
