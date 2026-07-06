// Unit tests for the withMetrics middleware (server/http/middleware/metric_sink.ts):
// the resolve-path status/duration capture, the throw-path status derivation via
// toAppError (co-designed with withErrors, which sits OUTSIDE it and does not
// rethrow), and the noopMetricSink no-op.

import { describe, expect, it } from 'vitest';
import { compose } from '../../../server/http/compose';
import { HttpError } from '../../../server/http/errors';
import {
  type MetricEvent,
  type MetricSink,
  noopMetricSink,
  teeMetricSink,
  withMetrics,
} from '../../../server/http/middleware/metric_sink';
import { withErrors } from '../../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

/** A capturing sink that pushes every recorded event onto an array. */
function capturingSink(): {
  sink: { record: (event: MetricEvent) => void };
  events: MetricEvent[];
} {
  const events: MetricEvent[] = [];
  return { sink: { record: (event: MetricEvent) => events.push(event) }, events };
}

describe('withMetrics: success path', () => {
  it('records route, method, final status, the injected-clock duration, and the ctx ip', async () => {
    const { sink, events } = capturingSink();
    const ticks = [1000, 1050];
    const clock = () => ticks.shift() as number;
    const ctx = fakeCtx({ method: 'GET' });
    const handler: Middleware = async () => {
      ctx.res.writeHead(200);
      ctx.res.end('ok');
    };
    await compose([withMetrics(sink, '/api/x', clock), handler])(ctx);
    expect(events).toEqual([
      { route: '/api/x', method: 'GET', status: 200, durationMs: 50, ip: '127.0.0.1' },
    ]);
  });

  it('populates the optional ip field verbatim from ctx.ip', async () => {
    const { sink, events } = capturingSink();
    const ctx = fakeCtx({ method: 'GET', ip: '203.0.113.7' });
    const handler: Middleware = async () => {
      ctx.res.writeHead(200);
      ctx.res.end('ok');
    };
    await compose([withMetrics(sink, '/api/x'), handler])(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].ip).toBe('203.0.113.7');
  });
});

describe('withMetrics: throw path, co-designed with withErrors', () => {
  it('records the mapped status (429) and the client receives exactly one mapped response', async () => {
    const { sink, events } = capturingSink();
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const handler: Middleware = async () => {
      throw new HttpError(429, 'rate_limit.exceeded', { retryAfterSeconds: 60 });
    };
    await compose([withErrors(), withMetrics(sink, '/api/x'), handler])(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].route).toBe('/api/x');
    expect(events[0].status).toBe(429);
    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('rate_limit.exceeded');
  });

  it('records status 500 for a generic (unexpected) Error throw', async () => {
    const { sink, events } = capturingSink();
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const handler: Middleware = async () => {
      throw new Error('unexpected failure');
    };
    await compose([withErrors(), withMetrics(sink, '/api/x'), handler])(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe(500);
    expect(res.statusCode).toBe(500);
  });
});

describe('noopMetricSink', () => {
  it('does not throw when recording an event', () => {
    expect(() =>
      noopMetricSink.record({ route: '/api/x', method: 'GET', status: 200, durationMs: 1 }),
    ).not.toThrow();
  });
});

describe('teeMetricSink', () => {
  const event: MetricEvent = { route: '/api/x', method: 'GET', status: 200, durationMs: 1 };

  it('fans one event out to every sink', () => {
    const { sink: a, events: eventsA } = capturingSink();
    const { sink: b, events: eventsB } = capturingSink();
    const { sink: c, events: eventsC } = capturingSink();
    teeMetricSink(a, b, c).record(event);
    expect(eventsA).toEqual([event]);
    expect(eventsB).toEqual([event]);
    expect(eventsC).toEqual([event]);
  });

  it('a throwing first sink does not prevent the second from recording and does not throw', () => {
    const throwing: MetricSink = {
      record() {
        throw new Error('sink boom');
      },
    };
    const { sink: healthy, events } = capturingSink();
    const tee = teeMetricSink(throwing, healthy);
    expect(() => tee.record(event)).not.toThrow();
    expect(events).toEqual([event]);
  });

  it('records nothing and does not throw with no sinks', () => {
    expect(() => teeMetricSink().record(event)).not.toThrow();
  });
});
