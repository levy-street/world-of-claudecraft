// Tests for the drain-aware health + /metrics handlers (server/http/health.ts).
//
// Three layers:
//   a) STATE: markDraining flips readiness (idempotently, one-way), the four
//      liveness states (fresh loop, stale loop, stale-but-draining, warmup), and
//      resetHealthForTests restoring the initial state + unregistering the source.
//   b) HANDLERS: drive handleLivez / handleReadyz / handleMetrics against FakeRes,
//      pinning status, body, the no-store header, and the metrics content type with
//      literals; handleMetrics 500s (without throwing) when metricsText rejects.
//   c) MOUNT: replay GET /livez, /readyz, /metrics through the REAL routeHttpRequest
//      under both dispatch modes, proving readyz flips to 503 after markDraining and
//      livez flips to 503 on a stalled loop.
//
// Most cases drive the staleness window by the AGE the source reports (a fixed offset
// from Date.now()), so no fake timers are needed; the one exact-boundary case fakes the
// clock to land precisely on 30 s. Every boundary case asserts against the hardcoded
// 30 s rather than against LIVEZ_STALE_MS itself.
//
// Layers (a) and (b) are the required coverage; layer (c) reuses the security-headers
// integration pattern (a dummy DATABASE_URL set BEFORE importing server/main, a
// bounded writableEnded poller) to prove the arms are wired into the live ladder.

import type * as http from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEALTH_CACHE_CONTROL,
  handleLivez,
  handleMetrics,
  handleReadyz,
  isLive,
  isReady,
  LIVEZ_STALE_MS,
  type LivenessSource,
  type MetricsSource,
  markDraining,
  registerLivenessSource,
  resetHealthForTests,
} from '../../../server/http/health';
import { createHttpMetrics } from '../../../server/http/metrics';
import { FakeRes, makeReq } from '../helpers';

/** Drive a synchronous handler over a fresh FakeRes and return it. */
function runSync(handler: (res: http.ServerResponse) => void): FakeRes {
  const res = new FakeRes();
  handler(res as unknown as http.ServerResponse);
  return res;
}

/**
 * Register a loop whose last completed pass was `ageMs` ago (null = no pass yet). The
 * loop-start backstop defaults to the same age, so `null` models a loop that has not
 * started (true warmup); pass `loopStartAgeMs` to model a loop that started `loopStartAgeMs`
 * ago but has completed no pass (the boot-time wedge). Age, not an absolute instant, so
 * the case reads the way the window does.
 */
function registerLoopAged(
  ageMs: number | null,
  loopStartAgeMs: number | null = ageMs,
): LivenessSource {
  const source: LivenessSource = {
    lastTickAt: () => (ageMs === null ? null : Date.now() - ageMs),
    loopStartedAt: () => (loopStartAgeMs === null ? null : Date.now() - loopStartAgeMs),
  };
  registerLivenessSource(source);
  return source;
}

describe('health readiness state', () => {
  beforeEach(() => resetHealthForTests());
  afterEach(() => resetHealthForTests());

  it('isReady() is true at boot and false after markDraining()', () => {
    expect(isReady()).toBe(true);
    markDraining();
    expect(isReady()).toBe(false);
  });

  it('markDraining() is idempotent (a repeat call stays draining)', () => {
    markDraining();
    markDraining();
    expect(isReady()).toBe(false);
  });

  it('isLive() stays true before and during a drain with no loop registered', () => {
    expect(isLive()).toBe(true);
    markDraining();
    expect(isLive()).toBe(true);
  });

  it('resetHealthForTests() restores the ready state', () => {
    markDraining();
    expect(isReady()).toBe(false);
    resetHealthForTests();
    expect(isReady()).toBe(true);
  });
});

describe('health liveness state', () => {
  beforeEach(() => resetHealthForTests());
  afterEach(() => resetHealthForTests());

  it('pins the staleness window at 30 seconds', () => {
    expect(LIVEZ_STALE_MS).toBe(30_000);
  });

  it('is live when the loop completed a pass just now', () => {
    registerLoopAged(0);
    expect(isLive()).toBe(true);
  });

  it('is NOT live when the loop has completed no pass for a minute', () => {
    registerLoopAged(60_000);
    expect(isLive()).toBe(false);
  });

  it('is live at 29 s of silence and dead at 31 s (the 30 s window)', () => {
    registerLoopAged(29_000);
    expect(isLive()).toBe(true);
    registerLoopAged(31_000);
    expect(isLive()).toBe(false);
  });

  // The exact boundary: an age of EXACTLY 30 s is still live (isLive uses `<=`), one
  // millisecond more is dead. A fake clock (Date frozen for the whole check) makes the
  // 30_000 age exact, where real timers would drift a millisecond and flake. If the
  // comparison ever tightened to `<`, a loop stalled exactly at the window would be
  // killed a millisecond early, restarting a container that was still just inside spec.
  it('treats an age of exactly 30 s as still live, and 30 s plus one ms as dead', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      registerLoopAged(30_000);
      expect(isLive()).toBe(true);
      registerLoopAged(30_001);
      expect(isLive()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is live while DRAINING even though the loop is stale (a shutdown is not a wedge)', () => {
    registerLoopAged(60_000);
    expect(isLive()).toBe(false);
    markDraining();
    expect(isLive()).toBe(true);
  });

  it('is live during warmup: no source registered, or a source with no completed pass', () => {
    expect(isLive()).toBe(true);
    registerLoopAged(null);
    expect(isLive()).toBe(true);
  });

  it('is live just after the loop starts, before its first pass completes', () => {
    // Started 1 s ago, no pass completed: the loop-start backstop is within the window.
    registerLoopAged(null, 1_000);
    expect(isLive()).toBe(true);
  });

  it('is NOT live when the loop started but completed no pass past the window', () => {
    // The boot-time wedge: every tick throws, so lastTickAt() stays null but the loop
    // started 31 s ago. Without the loop-start backstop this would read live forever.
    registerLoopAged(null, 31_000);
    expect(isLive()).toBe(false);
  });

  it('reads a FRESH last pass as live even though the loop START is long past the window', () => {
    // The steady production state: loopStartedAt() is stamped once at boot and never
    // refreshed, so on any server with more than 30 s of uptime it is ALWAYS stale;
    // only lastTickAt() keeps moving. The completed pass must take precedence over the
    // loop start, or every healthy long-lived server would read dead and the watchdog
    // would restart a working realm once per cooldown, forever. This is the one case
    // that distinguishes the two operands of the staleness read.
    registerLoopAged(0, 60_000);
    expect(isLive()).toBe(true);
  });

  it('resetHealthForTests() unregisters the source, so a stale loop cannot leak', () => {
    registerLoopAged(60_000);
    expect(isLive()).toBe(false);
    resetHealthForTests();
    expect(isLive()).toBe(true);
  });
});

describe('handleLivez', () => {
  beforeEach(() => resetHealthForTests());
  afterEach(() => resetHealthForTests());

  it('answers 200 ok with the no-store header', () => {
    const res = runSync(handleLivez);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
    expect(res.getHeader('Cache-Control')).toBe('no-store');
    expect(res.getHeader('Content-Type')).toBe('text/plain; charset=utf-8');
  });

  it('stays 200 ok even while draining', () => {
    markDraining();
    const res = runSync(handleLivez);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('answers 200 ok when the loop completed a pass 29 s ago', () => {
    registerLoopAged(29_000);
    const res = runSync(handleLivez);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('answers 503 naming the stall when the loop went quiet 31 s ago, with no-store', () => {
    registerLoopAged(31_000);
    const res = runSync(handleLivez);
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('game loop stalled');
    expect(res.getHeader('Cache-Control')).toBe('no-store');
    expect(res.getHeader('Content-Type')).toBe('text/plain; charset=utf-8');
  });

  it('answers 200 ok for a stale loop once draining (the drain exemption)', () => {
    registerLoopAged(60_000);
    markDraining();
    const res = runSync(handleLivez);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('answers 200 ok during warmup, before the loop completes its first pass', () => {
    registerLoopAged(null);
    const res = runSync(handleLivez);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });
});

describe('handleReadyz', () => {
  beforeEach(() => resetHealthForTests());
  afterEach(() => resetHealthForTests());

  it('answers 200 ok while ready, with the no-store header', () => {
    const res = runSync(handleReadyz);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  it('answers 503 draining after markDraining(), still with the no-store header', () => {
    markDraining();
    const res = runSync(handleReadyz);
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('draining');
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  it('is UNAFFECTED by a stalled loop: 200 ok until markDraining(), drain-only', () => {
    registerLoopAged(60_000);
    const stalled = runSync(handleReadyz);
    expect(stalled.statusCode).toBe(200);
    expect(stalled.body).toBe('ok');

    markDraining();
    const draining = runSync(handleReadyz);
    expect(draining.statusCode).toBe(503);
    expect(draining.body).toBe('draining');
  });
});

describe('handleMetrics', () => {
  beforeEach(() => resetHealthForTests());
  afterEach(() => resetHealthForTests());

  it('serves the prometheus exposition text with the registry content type and no-store', async () => {
    const metrics = createHttpMetrics();
    metrics.sink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 12 });
    const res = new FakeRes();
    await handleMetrics(res as unknown as http.ServerResponse, metrics);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http_requests_total');
    expect(res.getHeader('Content-Type')).toBe(metrics.contentType);
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  it('answers 500 (without throwing) when metricsText rejects', async () => {
    const failing: MetricsSource = {
      metricsText: () => Promise.reject(new Error('registry exploded')),
      contentType: 'text/plain; version=0.0.4; charset=utf-8',
    };
    const res = new FakeRes();
    await expect(
      handleMetrics(res as unknown as http.ServerResponse, failing),
    ).resolves.toBeUndefined();
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('metrics unavailable');
    expect(res.getHeader('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  it('exposes the no-store constant as the literal the handlers use', () => {
    expect(HEALTH_CACHE_CONTROL).toBe('no-store');
  });
});

// -----------------------------------------------------------------------------
// MOUNT: the health/metrics arms through the real routeHttpRequest.
// -----------------------------------------------------------------------------

// db.ts reads DATABASE_URL at module scope; a dummy URL lets the bare server/main
// import resolve. The pool is constructed but never connects: /livez, /readyz, and
// /metrics all answer before touching it.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase23_health';

// routeHttpRequest is synchronous fire-and-forget (void handleMetrics(...)), so a
// dispatch must poll res.writableEnded before the captured body is readable.
const MAX_POLL_TICKS = 5000;

type MainModule = typeof import('../../../server/main');
let main: MainModule;
let savedNodeEnv: string | undefined;

beforeAll(async () => {
  savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  main = (await import('../../../server/main')) as MainModule;
});

afterAll(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

/** Drive the real routeHttpRequest under `mode` and poll until the response ends. */
async function driveRoute(
  mode: 'legacy' | 'new',
  opts: { method?: string; url: string },
): Promise<FakeRes> {
  main.setApiDispatchModeForTests(mode);
  const req = makeReq(opts);
  const res = new FakeRes();
  main.routeHttpRequest(req, res as unknown as http.ServerResponse);
  let ticks = 0;
  while (!res.writableEnded) {
    if (ticks++ > MAX_POLL_TICKS) throw new Error('response never ended');
    await new Promise((r) => setImmediate(r));
  }
  return res;
}

describe('routeHttpRequest health + metrics arms (integration)', () => {
  beforeEach(() => resetHealthForTests());
  afterEach(() => {
    resetHealthForTests();
    main.resetApiDispatchModeForTests();
  });

  it('GET /livez returns 200 ok through the real ladder under both dispatch modes', async () => {
    for (const mode of ['legacy', 'new'] as const) {
      const res = await driveRoute(mode, { url: '/livez' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('ok');
      expect(res.getHeader('Cache-Control')).toBe('no-store');
    }
  });

  it('GET /livez returns 503 through the real ladder when the loop has stalled', async () => {
    for (const mode of ['legacy', 'new'] as const) {
      resetHealthForTests();
      registerLoopAged(31_000);
      const stalled = await driveRoute(mode, { url: '/livez' });
      expect(stalled.statusCode).toBe(503);
      expect(stalled.body).toBe('game loop stalled');
      expect(stalled.getHeader('Cache-Control')).toBe('no-store');

      // The same stalled loop answers 200 once the process is draining: a graceful
      // shutdown must not read as a wedge to whatever restarts the container.
      markDraining();
      const draining = await driveRoute(mode, { url: '/livez' });
      expect(draining.statusCode).toBe(200);
      expect(draining.body).toBe('ok');
    }
  });

  it('GET /readyz returns 200 ok, then 503 after markDraining(), under both dispatch modes', async () => {
    for (const mode of ['legacy', 'new'] as const) {
      resetHealthForTests();
      const ready = await driveRoute(mode, { url: '/readyz' });
      expect(ready.statusCode).toBe(200);
      expect(ready.body).toBe('ok');

      markDraining();
      const draining = await driveRoute(mode, { url: '/readyz' });
      expect(draining.statusCode).toBe(503);
      expect(draining.body).toBe('draining');

      // /livez stays 200 through the drain (liveness is not readiness).
      const live = await driveRoute(mode, { url: '/livez' });
      expect(live.statusCode).toBe(200);
      expect(live.body).toBe('ok');
    }
  });

  it('GET /metrics is feature-off (404) under both dispatch modes when METRICS_TOKEN is unset', async () => {
    // This suite runs with no METRICS_TOKEN, so /metrics is gated off entirely
    // (fail-closed, anti-enumeration). The token-set exposition + 401 arms are
    // covered in metrics_gate.test.ts. The gate response still carries no-store.
    for (const mode of ['legacy', 'new'] as const) {
      const res = await driveRoute(mode, { url: '/metrics' });
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('not found');
      expect(res.getHeader('Cache-Control')).toBe('no-store');
    }
  });
});
