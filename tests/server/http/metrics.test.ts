// Unit tests for the RED /metrics exporter core (server/http/metrics.ts): the
// prom-client registry + MetricSink factory. These pin the exposed metric NAMES
// as literals (so a rename fails the test, not just a constant swap), prove the
// label cardinality is bounded to the route TEMPLATE (a concrete id path never
// becomes a series), that distinct statuses fan into distinct series while repeats
// do not, that method is uppercased and durationMs is observed in seconds, that
// the exposition text parses as Prometheus, and that two instances are fully
// isolated (no duplicate-registration throw, no cross-talk, default metrics scoped).

import { describe, expect, it } from 'vitest';
import { compose } from '../../../server/http/compose';
import {
  AUTH_FAILURES_TOTAL,
  BOLA_DENIED_TOTAL,
  createHttpMetrics,
  HTTP_DURATION_BUCKETS_SECONDS,
  HTTP_REQUEST_DURATION_SECONDS,
  HTTP_REQUESTS_TOTAL,
  PG_LIMITER_WRITES_TOTAL,
  RATE_LIMIT_HITS_TOTAL,
} from '../../../server/http/metrics';
import { withMetrics } from '../../../server/http/middleware/metric_sink';
import type { Middleware } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';

/** A handler that sets `status` on the response and ends, so withMetrics captures it. */
function statusHandler(status: number): Middleware {
  return async (ctx) => {
    ctx.res.writeHead(status);
    ctx.res.end('');
  };
}

/** Every counter sample line for http_requests_total (label combos, one per series). */
function requestTotalSeries(text: string): string[] {
  return text.match(/^http_requests_total\{[^}]*\} \d+(?:\.\d+)?$/gm) ?? [];
}

/** The set of distinct values of a given label across the whole exposition text. */
function labelValues(text: string, label: string): Set<string> {
  const values = new Set<string>();
  const re = new RegExp(`${label}="([^"]*)"`, 'g');
  for (const m of text.matchAll(re)) values.add(m[1]);
  return values;
}

/** Capture the single numeric value on the first line matching `re` (one capture group). */
function sampleValue(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1];
}

describe('createHttpMetrics: recording exposes both RED metrics', () => {
  it('increments http_requests_total to 1 and lands one duration observation', async () => {
    const metrics = createHttpMetrics();
    metrics.sink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 12 });
    const text = await metrics.metricsText();

    // Literal name pins: a rename of either metric must fail this test, not silently
    // ride the exported constant.
    expect(text).toContain('http_requests_total');
    expect(text).toContain('http_request_duration_seconds');

    expect(sampleValue(text, /^http_requests_total\{[^}]*\} (\d+)$/m)).toBe('1');
    expect(sampleValue(text, /^http_request_duration_seconds_count\{[^}]*\} (\d+)$/m)).toBe('1');
  });

  it('exposes the metrics under the exact exported constant names', async () => {
    const metrics = createHttpMetrics();
    metrics.sink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 1 });
    const text = await metrics.metricsText();
    expect(HTTP_REQUESTS_TOTAL).toBe('http_requests_total');
    expect(HTTP_REQUEST_DURATION_SECONDS).toBe('http_request_duration_seconds');
    expect(text).toContain(`# TYPE ${HTTP_REQUESTS_TOTAL} counter`);
    expect(text).toContain(`# TYPE ${HTTP_REQUEST_DURATION_SECONDS} histogram`);
  });

  it('pins the histogram bucket boundaries as literals, and each surfaces as an le=', async () => {
    // A LITERAL pin: silently editing the bucket array (the acceptance-criterion
    // "named bucket constant") must fail here, not ride the shared constant.
    const boundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    expect([...HTTP_DURATION_BUCKETS_SECONDS]).toEqual(boundaries);

    const metrics = createHttpMetrics();
    metrics.sink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 1 });
    const text = await metrics.metricsText();
    for (const boundary of boundaries) {
      expect(text).toContain(`le="${boundary}"`);
    }
    expect(text).toContain('le="+Inf"');
  });
});

describe('createHttpMetrics: cardinality is bounded to the route template', () => {
  it('collapses 50 distinct concrete id paths onto ONE series via the real withMetrics', async () => {
    const metrics = createHttpMetrics();
    const template = '/api/things/:id';
    const clock = (() => {
      let t = 0;
      return () => (t += 5);
    })();

    for (let id = 0; id < 50; id++) {
      const ctx = fakeCtx({ method: 'GET', url: `/api/things/${id}` });
      await compose([withMetrics(metrics.sink, template, clock), statusHandler(200)])(ctx);
    }

    const text = await metrics.metricsText();
    // Exactly ONE counter series despite 50 distinct ids, and its count is 50.
    const series = requestTotalSeries(text);
    expect(series).toHaveLength(1);
    expect(sampleValue(text, /^http_requests_total\{[^}]*\} (\d+)$/m)).toBe('50');
    // The only route label value anywhere is the template, never a concrete id.
    expect(labelValues(text, 'route')).toEqual(new Set([template]));
    expect(text).not.toContain('/api/things/0');
    expect(text).not.toContain('/api/things/49');
  });
});

describe('createHttpMetrics: the label set is bounded and normalized', () => {
  it('fans distinct statuses into distinct series and does not grow on a repeat', async () => {
    const metrics = createHttpMetrics();
    const template = '/api/things/:id';
    for (const status of [200, 404, 500, 200]) {
      const ctx = fakeCtx({ method: 'GET', url: '/api/things/7' });
      await compose([withMetrics(metrics.sink, template, () => 0), statusHandler(status)])(ctx);
    }
    const text = await metrics.metricsText();
    // Three distinct statuses -> three series; the repeated 200 adds none.
    expect(requestTotalSeries(text)).toHaveLength(3);
    expect(labelValues(text, 'status')).toEqual(new Set(['200', '404', '500']));
    // The repeated 200 accumulated to a count of 2 on its single series.
    expect(sampleValue(text, /^http_requests_total\{[^}]*status="200"[^}]*\} (\d+)$/m)).toBe('2');
  });

  it('uppercases the method label', async () => {
    const metrics = createHttpMetrics();
    // The sink accepts a raw MetricEvent; a lower-case method must surface uppercased.
    metrics.sink.record({ route: '/api/x', method: 'get', status: 200, durationMs: 1 });
    const text = await metrics.metricsText();
    expect(labelValues(text, 'method')).toEqual(new Set(['GET']));
    expect(text).not.toContain('method="get"');
  });

  it('never records a request-derived label (ip/query/body cannot become a series)', async () => {
    const metrics = createHttpMetrics();
    metrics.sink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 1 });
    const text = await metrics.metricsText();
    expect(text).not.toContain('ip=');
    expect(text).not.toContain('query=');
    expect(text).not.toContain('path=');
  });
});

describe('createHttpMetrics: duration is observed in seconds', () => {
  it('records a 250 ms event as a 0.25 s observation', async () => {
    const metrics = createHttpMetrics();
    metrics.sink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 250 });
    const text = await metrics.metricsText();
    // The histogram _sum is in seconds: 250 ms / 1000 = 0.25.
    expect(sampleValue(text, /^http_request_duration_seconds_sum\{[^}]*\} ([\d.]+)$/m)).toBe(
      '0.25',
    );
    // 0.25 s lands in every bucket with le >= 0.25 and none below it.
    expect(
      sampleValue(text, /^http_request_duration_seconds_bucket\{[^}]*le="0\.25"[^}]*\} (\d+)$/m),
    ).toBe('1');
    expect(
      sampleValue(text, /^http_request_duration_seconds_bucket\{[^}]*le="0\.1"[^}]*\} (\d+)$/m),
    ).toBe('0');
  });

  it('captures the injected-clock duration end to end through withMetrics', async () => {
    const metrics = createHttpMetrics();
    const ticks = [1000, 1250];
    const clock = () => ticks.shift() as number;
    const ctx = fakeCtx({ method: 'GET', url: '/api/things/7' });
    await compose([withMetrics(metrics.sink, '/api/things/:id', clock), statusHandler(200)])(ctx);
    const text = await metrics.metricsText();
    // 1250 - 1000 = 250 ms observed as 0.25 s.
    expect(sampleValue(text, /^http_request_duration_seconds_sum\{[^}]*\} ([\d.]+)$/m)).toBe(
      '0.25',
    );
  });
});

describe('createHttpMetrics: the four attack-signal counters', () => {
  it('registers all six series on one registry, exposed before any traffic', async () => {
    const metrics = createHttpMetrics();
    const text = await metrics.metricsText();
    // Literal name pins for the whole source-spec 4.9 request-layer RED catalog:
    // a rename must fail here, never silently ride an exported constant.
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
    expect(text).toContain('# TYPE rate_limit_hits_total counter');
    expect(text).toContain('# TYPE auth_failures_total counter');
    expect(text).toContain('# TYPE bola_denied_total counter');
    expect(text).toContain('# TYPE pg_limiter_writes_total counter');
  });

  it('pins the exported name constants to their literal series names', () => {
    expect(RATE_LIMIT_HITS_TOTAL).toBe('rate_limit_hits_total');
    expect(AUTH_FAILURES_TOTAL).toBe('auth_failures_total');
    expect(BOLA_DENIED_TOTAL).toBe('bola_denied_total');
    expect(PG_LIMITER_WRITES_TOTAL).toBe('pg_limiter_writes_total');
  });

  it('rateLimitHit increments rate_limit_hits_total with the policy and key_kind labels', async () => {
    const metrics = createHttpMetrics();
    metrics.attackSignals.rateLimitHit('character_create', 'ip+account');
    metrics.attackSignals.rateLimitHit('character_create', 'ip+account');
    metrics.attackSignals.rateLimitHit('public_read', 'ip');
    const text = await metrics.metricsText();
    expect(
      sampleValue(
        text,
        /^rate_limit_hits_total\{policy="character_create",key_kind="ip\+account"\} (\d+)$/m,
      ),
    ).toBe('2');
    expect(
      sampleValue(text, /^rate_limit_hits_total\{policy="public_read",key_kind="ip"\} (\d+)$/m),
    ).toBe('1');
  });

  it('authFailure fans the two bounded kinds into two series', async () => {
    const metrics = createHttpMetrics();
    metrics.attackSignals.authFailure('bad_credentials');
    metrics.attackSignals.authFailure('bad_credentials');
    metrics.attackSignals.authFailure('throttled');
    const text = await metrics.metricsText();
    expect(sampleValue(text, /^auth_failures_total\{kind="bad_credentials"\} (\d+)$/m)).toBe('2');
    expect(sampleValue(text, /^auth_failures_total\{kind="throttled"\} (\d+)$/m)).toBe('1');
  });

  it('bolaDenied labels by the route TEMPLATE handed to it', async () => {
    const metrics = createHttpMetrics();
    metrics.attackSignals.bolaDenied('/api/characters/:id');
    const text = await metrics.metricsText();
    expect(sampleValue(text, /^bola_denied_total\{route="\/api\/characters\/:id"\} (\d+)$/m)).toBe(
      '1',
    );
  });

  it('pgLimiterWrite increments pg_limiter_writes_total by policy', async () => {
    const metrics = createHttpMetrics();
    metrics.attackSignals.pgLimiterWrite('wallet_link');
    metrics.attackSignals.pgLimiterWrite('wallet_link');
    const text = await metrics.metricsText();
    expect(sampleValue(text, /^pg_limiter_writes_total\{policy="wallet_link"\} (\d+)$/m)).toBe('2');
  });

  it('keeps attack-signal increments scoped to their own instance', async () => {
    const a = createHttpMetrics();
    const b = createHttpMetrics();
    a.attackSignals.authFailure('throttled');
    const textB = await b.metricsText();
    expect(textB).not.toMatch(/^auth_failures_total\{/m);
  });
});

describe('createHttpMetrics: the exposition text is valid Prometheus', () => {
  it('every non-empty line is a HELP/TYPE comment or a well-formed sample', async () => {
    const metrics = createHttpMetrics();
    // Exercise every line shape: counter samples, histogram buckets (incl. +Inf), sum, count.
    metrics.sink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 30 });
    metrics.sink.record({ route: '/api/x', method: 'POST', status: 500, durationMs: 4000 });
    const text = await metrics.metricsText();

    const commentLine = /^# (HELP|TYPE) /;
    const sampleLine = /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})? (-?[0-9.eE+-]+|NaN|\+Inf)( [0-9]+)?$/;
    const lines = text.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(commentLine.test(line) || sampleLine.test(line)).toBe(true);
    }
  });
});

describe('createHttpMetrics: instances are isolated', () => {
  it('two instances (one with default metrics) coexist without a duplicate-registration throw', () => {
    let a: ReturnType<typeof createHttpMetrics> | undefined;
    let b: ReturnType<typeof createHttpMetrics> | undefined;
    expect(() => {
      a = createHttpMetrics();
      b = createHttpMetrics({ defaultMetrics: true });
    }).not.toThrow();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });

  it('a record into one instance does not appear in the other', async () => {
    const a = createHttpMetrics();
    const b = createHttpMetrics({ defaultMetrics: true });
    a.sink.record({ route: '/api/a', method: 'GET', status: 200, durationMs: 1 });

    const textA = await a.metricsText();
    const textB = await b.metricsText();

    // The request only shows up in A.
    expect(requestTotalSeries(textA)).toHaveLength(1);
    expect(labelValues(textA, 'route')).toEqual(new Set(['/api/a']));
    expect(requestTotalSeries(textB)).toHaveLength(0);
    expect(textB).not.toContain('/api/a');

    // Default metrics are scoped to B only, never A or the prom-client global default.
    expect(textB).toContain('nodejs_');
    expect(textA).not.toContain('nodejs_');
  });

  it('exposes the registry contentType for the /metrics response', () => {
    const metrics = createHttpMetrics();
    expect(metrics.contentType).toContain('text/plain');
    expect(metrics.contentType).toBe(metrics.registry.contentType);
  });
});
