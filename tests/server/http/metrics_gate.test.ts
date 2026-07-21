// Tests for the /metrics exposure gate plus the two boot-wiring effects
// it rides in with:
//   a) UNIT: handleMetricsGate (server/http/health.ts) directly over FakeRes: the
//      feature-off 404 (token unset), the exposition on a correct Bearer, and the
//      opaque 401 on a missing / wrong / same-length-wrong / no-scheme credential.
//   b) MOUNT: the same gate through the REAL routeHttpRequest, driving METRICS_TOKEN
//      via resetActiveConfigForTests, and proving /livez + /readyz stay open.
//   c) BOOT LOG: logApiDispatchSelection (server/main.ts) logs the mode and emits the
//      legacy-in-production ALERT only for legacy + production.
//   d) PG SINK: createPgRateLimitStore counts each pg upsert on the real
//      pg_limiter_writes_total{policy} series via the process-wide attack-signal
//      slot (server/http/attack_signals.ts), one write per hit for both the allowed
//      and the tripped case, with the old ratelimit.pg.hit http_requests_total proxy
//      row gone; plus the /metrics exposition lists all six RED + attack-signal series.
//   e) BOOT WIRING: importing main installs the exporter-backed attack-signal sink
//      on the process-wide slot (setAttackSignalSink(httpMetrics.attackSignals)), so
//      an emission through attackSignalSink() surfaces in a real /metrics scrape.

import type * as http from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AttackSignalSink,
  attackSignalSink,
  setAttackSignalSink,
} from '../../../server/http/attack_signals';
import { handleMetricsGate, resetHealthForTests } from '../../../server/http/health';
import { createHttpMetrics } from '../../../server/http/metrics';
import { createPgRateLimitStore } from '../../../server/ratelimit_db';
import { FakeRes, makeReq } from '../helpers/fake_http';

const TOKEN = 'scrape-secret-abc123';

/** A metrics source with one recorded sample so the exposition text is non-trivial. */
function metricsWithSample() {
  const m = createHttpMetrics();
  m.sink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 5 });
  return m;
}

/** A recording AttackSignalSink: captures the policy label of every pgLimiterWrite. */
function recordingAttackSignalSink(): AttackSignalSink & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    rateLimitHit() {},
    authFailure() {},
    bolaDenied() {},
    pgLimiterWrite(policy) {
      writes.push(policy);
    },
  };
}

describe('handleMetricsGate (unit)', () => {
  it('is feature-off (404 not found + no-store) when the token is empty', async () => {
    const res = new FakeRes();
    await handleMetricsGate(
      makeReq({ url: '/metrics' }),
      res as unknown as http.ServerResponse,
      metricsWithSample(),
      '',
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('not found');
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  it('serves the exposition on a correct Bearer token (200 + registry content type + no-store)', async () => {
    const m = metricsWithSample();
    const res = new FakeRes();
    await handleMetricsGate(
      makeReq({ url: '/metrics', headers: { authorization: `Bearer ${TOKEN}` } }),
      res as unknown as http.ServerResponse,
      m,
      TOKEN,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http_requests_total');
    expect(res.getHeader('Content-Type')).toBe(m.contentType);
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  it('accepts a case-insensitive bearer scheme', async () => {
    const res = new FakeRes();
    await handleMetricsGate(
      makeReq({ url: '/metrics', headers: { authorization: `bearer ${TOKEN}` } }),
      res as unknown as http.ServerResponse,
      metricsWithSample(),
      TOKEN,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http_requests_total');
  });

  it('answers an opaque 401 (never echoing the token) for a missing/wrong/same-length/no-scheme credential', async () => {
    const cases: Array<Record<string, string>> = [
      {}, // no Authorization header at all
      { authorization: 'Bearer wrong-token' },
      { authorization: `Bearer ${'x'.repeat(TOKEN.length)}` }, // same length, wrong bytes
      { authorization: TOKEN }, // no Bearer scheme
      { authorization: 'Basic abc' },
    ];
    for (const headers of cases) {
      const res = new FakeRes();
      await handleMetricsGate(
        makeReq({ url: '/metrics', headers }),
        res as unknown as http.ServerResponse,
        metricsWithSample(),
        TOKEN,
      );
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe('unauthorized');
      expect(res.body).not.toContain(TOKEN);
      expect(res.getHeader('Cache-Control')).toBe('no-store');
    }
  });
});

describe('the /metrics exposition lists all six RED + attack-signal series', () => {
  it('exposes every series TYPE line at the /metrics surface even before any traffic', async () => {
    // A fresh exporter with no samples still declares each registered series, so
    // the four attack-signal counters are scrapeable the moment the process boots.
    const m = createHttpMetrics();
    const res = new FakeRes();
    await handleMetricsGate(
      makeReq({ url: '/metrics', headers: { authorization: `Bearer ${TOKEN}` } }),
      res as unknown as http.ServerResponse,
      m,
      TOKEN,
    );
    expect(res.statusCode).toBe(200);
    const body = String(res.body);
    expect(body).toContain('# TYPE http_requests_total counter');
    expect(body).toContain('# TYPE http_request_duration_seconds histogram');
    expect(body).toContain('# TYPE rate_limit_hits_total counter');
    expect(body).toContain('# TYPE auth_failures_total counter');
    expect(body).toContain('# TYPE bola_denied_total counter');
    expect(body).toContain('# TYPE pg_limiter_writes_total counter');
  });
});

describe('pg rate-limit store emits on the attack-signal slot (no ratelimit.pg.hit proxy)', () => {
  const now = 1_000_000;
  const windowStart = now - (now % 60_000);
  const makePool = (count: number) =>
    ({
      query: async () => ({ rows: [{ count, window_start: windowStart }] }),
    }) as unknown as import('pg').Pool;

  // The pg-write count lands on the process-wide attack-signal slot, so capture
  // and restore whatever is installed (main.ts wired its exporter at import).
  let prevSink: AttackSignalSink;
  beforeEach(() => {
    prevSink = attackSignalSink();
  });
  afterEach(() => {
    setAttackSignalSink(prevSink);
  });

  it('emits pgLimiterWrite once per hit for both the allowed and the tripped case', async () => {
    const sink = recordingAttackSignalSink();
    setAttackSignalSink(sink);

    const underLimit = createPgRateLimitStore({ pool: makePool(1), now: () => now });
    await underLimit.hit('auth:1.2.3.4', 5); // count 1, max 5: allowed
    const tripped = createPgRateLimitStore({ pool: makePool(6), now: () => now });
    await tripped.hit('auth:1.2.3.4', 5); // count 6, max 5: tripped

    // One write per upsert (it counts writes, not decisions), labeled with the
    // parsed policy 'auth' and never the ip portion of the key.
    expect(sink.writes).toEqual(['auth', 'auth']);
    expect(sink.writes[0]).not.toContain('1.2.3.4');
  });

  it('surfaces the write on pg_limiter_writes_total, the old ratelimit.pg.hit proxy row gone', async () => {
    const m = createHttpMetrics();
    setAttackSignalSink(m.attackSignals);

    const store = createPgRateLimitStore({ pool: makePool(1), now: () => now });
    await store.hit('auth:1.2.3.4', 5);

    const text = await m.metricsText();
    // The real named series carries the count, labeled by policy only.
    expect(text).toContain('pg_limiter_writes_total{policy="auth"} 1');
    // The proxy MetricEvent row is gone from the exporter entirely.
    expect(text).not.toContain('ratelimit.pg.hit');
  });
});

// -----------------------------------------------------------------------------
// MOUNT + BOOT LOG: import the real server/main (a dummy DATABASE_URL lets db.ts's
// module-scope read resolve; the pool never connects on these paths).
// -----------------------------------------------------------------------------

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase24_metrics_gate';

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

/** Drive routeHttpRequest for a GET url and poll until the fire-and-forget response ends. */
async function drive(url: string, headers?: Record<string, string>): Promise<FakeRes> {
  const req = makeReq({ url, headers });
  const res = new FakeRes();
  main.routeHttpRequest(req, res as unknown as http.ServerResponse);
  let ticks = 0;
  while (!res.writableEnded) {
    if (ticks++ > MAX_POLL_TICKS) throw new Error('response never ended');
    await new Promise((r) => setImmediate(r));
  }
  return res;
}

describe('routeHttpRequest /metrics gate (integration)', () => {
  afterEach(() => {
    delete process.env.METRICS_TOKEN;
    main.resetActiveConfigForTests();
    resetHealthForTests();
    main.resetApiDispatchModeForTests();
  });

  it('404 (feature-off) when METRICS_TOKEN is unset', async () => {
    main.resetActiveConfigForTests();
    const res = await drive('/metrics');
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('not found');
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  it('200 exposition on the correct Bearer token', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    main.resetActiveConfigForTests();
    const res = await drive('/metrics', { authorization: `Bearer ${TOKEN}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http_requests_total');
    expect(res.getHeader('Cache-Control')).toBe('no-store');
    expect(String(res.getHeader('Content-Type'))).toContain('text/plain');
  });

  it('401 on a wrong or missing Bearer while the token is set', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    main.resetActiveConfigForTests();
    const wrong = await drive('/metrics', { authorization: 'Bearer nope' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe('unauthorized');
    const missing = await drive('/metrics');
    expect(missing.statusCode).toBe(401);
    expect(missing.body).toBe('unauthorized');
  });

  it('boot wires the attack-signal slot onto the SAME registry /metrics serves', async () => {
    // Pins the main.ts boot line setAttackSignalSink(httpMetrics.attackSignals):
    // importing main installed the real exporter-backed sink on the process-wide
    // slot, so an emission through attackSignalSink() must surface in a real
    // /metrics scrape driven through routeHttpRequest. Deleting that one wiring
    // line leaves the noop on the slot and this scrape misses the series sample
    // (every other suite installs its own fake, so only this test would catch it).
    process.env.METRICS_TOKEN = TOKEN;
    main.resetActiveConfigForTests();
    attackSignalSink().bolaDenied('/api/boot-wiring-pin/:id');
    const res = await drive('/metrics', { authorization: `Bearer ${TOKEN}` });
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain('bola_denied_total{route="/api/boot-wiring-pin/:id"} 1');
  });

  it('leaves /livez and /readyz open while the token gates /metrics', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    main.resetActiveConfigForTests();
    for (const url of ['/livez', '/readyz']) {
      const res = await drive(url);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('ok');
    }
  });

  it('memoizes the config: mutating env WITHOUT reset does not re-read mid-flight', async () => {
    // Pins activeConfig()'s once-per-process contract (STEP 5 criterion 1): after
    // the first read, deleting METRICS_TOKEN from the ambient env must NOT flip the
    // gate to feature-off 404; only resetActiveConfigForTests re-reads. A
    // regression that calls loadConfig(process.env) per request passes every other
    // case in this file but fails here.
    process.env.METRICS_TOKEN = TOKEN;
    main.resetActiveConfigForTests();
    const before = await drive('/metrics');
    expect(before.statusCode).toBe(401);
    delete process.env.METRICS_TOKEN;
    const after = await drive('/metrics');
    expect(after.statusCode).toBe(401); // memoized: still gated, NOT 404
    main.resetActiveConfigForTests();
    const reread = await drive('/metrics');
    expect(reread.statusCode).toBe(404); // the reset is what re-reads
  });
});

describe('logApiDispatchSelection (boot log)', () => {
  it('logs the selected mode and emits NO alert for new, or for legacy outside production', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    main.logApiDispatchSelection(log, 'new', 'production');
    main.logApiDispatchSelection(log, 'legacy', 'test');
    main.logApiDispatchSelection(log, 'legacy', undefined);
    expect(log.info).toHaveBeenCalledTimes(3);
    expect(log.info).toHaveBeenCalledWith({ dispatch: 'new' }, 'api dispatch mode selected');
    expect(log.info).toHaveBeenCalledWith({ dispatch: 'legacy' }, 'api dispatch mode selected');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('emits the legacy-in-production ALERT via warn', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    main.logApiDispatchSelection(log, 'legacy', 'production');
    expect(log.info).toHaveBeenCalledWith({ dispatch: 'legacy' }, 'api dispatch mode selected');
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [fields, msg] = log.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toEqual({ dispatch: 'legacy' });
    expect(String(msg)).toContain('ALERT');
    expect(String(msg)).toContain('legacy');
  });
});
