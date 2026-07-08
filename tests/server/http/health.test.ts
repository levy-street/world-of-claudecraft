// Tests for the drain-aware health + /metrics handlers (server/http/health.ts).
//
// Three layers:
//   a) STATE: markDraining flips readiness (idempotently, one-way), liveness stays
//      true through a drain, resetHealthForTests restores the initial state.
//   b) HANDLERS: drive handleLivez / handleReadyz / handleMetrics against FakeRes,
//      pinning status, body, the no-store header, and the metrics content type with
//      literals; handleMetrics 500s (without throwing) when metricsText rejects.
//   c) MOUNT: replay GET /livez, /readyz, /metrics through the REAL routeHttpRequest
//      under both dispatch modes, proving readyz flips to 503 after markDraining.
//
// Layers (a) and (b) are the required coverage; layer (c) reuses the security-headers
// integration pattern (a dummy DATABASE_URL set BEFORE importing server/main, a
// bounded writableEnded poller) to prove the arms are wired into the live ladder.

import type * as http from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HEALTH_CACHE_CONTROL,
  handleLivez,
  handleMetrics,
  handleReadyz,
  isLive,
  isReady,
  type MetricsSource,
  markDraining,
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

  it('isLive() stays true before and during a drain', () => {
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
