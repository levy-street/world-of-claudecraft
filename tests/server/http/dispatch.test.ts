// Unit tests for the dispatcher-in-front (server/http/dispatch.ts).
//
// The dispatcher runs the middleware onion for a registry-matched RouteDef and
// delegates every other /api path to the legacy handleApi UNCHANGED. These tests
// pin: a matched path runs the onion exactly once and emits exactly one response;
// an unmatched path calls the delegate with the untouched req/res; a handler throw
// yields exactly one problem+json response with no error leak; and selectApiEntry
// picks the legacy vs new path from the flag (flag-off bypasses the dispatcher
// entirely). CORS parity old-vs-new lives in the top-level main.ts wrapper, so it
// is proven by parity.test.ts, not here.

import type * as http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createAccessLogSink } from '../../../server/http/access_log';
import { currentReqId } from '../../../server/http/context';
import {
  type ApiDelegate,
  type ApiDispatcher,
  createApiDispatcher,
  selectApiEntry,
} from '../../../server/http/dispatch';
import { createLogger, logger } from '../../../server/http/logger';
import { createHttpMetrics } from '../../../server/http/metrics';
import {
  type MetricEvent,
  type MetricSink,
  teeMetricSink,
} from '../../../server/http/middleware/metric_sink';
import type { ApiRegistry } from '../../../server/http/registry';
import type { MatchResult } from '../../../server/http/router';
import type { RouteDef, RouteHandler, RouteMeta } from '../../../server/http/types';
import { FakeRes, makeReq } from '../helpers';

/** A registry stub that always returns one fixed MatchResult, isolating the dispatcher. */
function registryReturning(result: MatchResult<RouteDef>): ApiRegistry {
  return { resolve: () => result };
}

/** A fake /api route with an injectable handler. */
function fakeRoute(handler: RouteHandler, meta?: RouteMeta): RouteDef {
  return { method: 'GET', path: '/api/things/:id', surface: 'api', handler, meta };
}

/**
 * Drive the fire-and-forget dispatcher (void runOnion) to completion by polling
 * the response, bounded so a stuck onion fails loudly instead of hanging.
 */
function flush(res: FakeRes): Promise<void> {
  return new Promise((resolve, reject) => {
    let ticks = 0;
    const tick = () => {
      // A synchronous handler ends the response before the onion unwinds (where
      // withMetrics records), so poll via setImmediate: the check runs only after
      // the microtask queue (the full unwind, including the metric record) drains.
      if (res.writableEnded) return resolve();
      if (++ticks > 1000) return reject(new Error('response never ended'));
      setImmediate(tick);
    };
    setImmediate(tick);
  });
}

describe('createApiDispatcher', () => {
  it('runs the onion once for a registry-matched path and emits exactly one response', async () => {
    let handlerCalls = 0;
    let delegateCalls = 0;
    const events: MetricEvent[] = [];
    const sink: MetricSink = { record: (e) => events.push(e) };
    const route = fakeRoute(async (ctx) => {
      handlerCalls++;
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ ok: true, id: ctx.params.id }));
    });
    const dispatcher = createApiDispatcher({
      registry: registryReturning({ kind: 'matched', route, params: { id: '42' }, head: false }),
      delegate: () => {
        delegateCalls++;
      },
      metricSink: sink,
    });

    const res = new FakeRes();
    dispatcher(
      makeReq({ method: 'GET', url: '/api/things/42' }),
      res as unknown as http.ServerResponse,
    );
    await flush(res);

    expect(handlerCalls).toBe(1);
    expect(delegateCalls).toBe(0);
    expect(res.statusCode).toBe(200);
    expect(res.writableEnded).toBe(true);
    expect(JSON.parse(res.body)).toEqual({ ok: true, id: '42' });
    // The metric hook observes the FINAL status against the :param TEMPLATE, and
    // carries the resolved client IP (for the access log).
    expect(events).toEqual([
      {
        route: '/api/things/:id',
        method: 'GET',
        status: 200,
        durationMs: expect.any(Number),
        ip: expect.any(String),
      },
    ]);
  });

  it('delegates an unregistered path to the legacy handleApi with req/res untouched', () => {
    const seen: Array<{ req: http.IncomingMessage; res: http.ServerResponse }> = [];
    const dispatcher = createApiDispatcher({
      registry: registryReturning({ kind: 'notFound' }),
      delegate: (req, res) => {
        seen.push({ req, res });
      },
    });

    const req = makeReq({ method: 'GET', url: '/api/legacy/thing' });
    const res = new FakeRes();
    dispatcher(req, res as unknown as http.ServerResponse);

    expect(seen).toHaveLength(1);
    // The SAME req/res objects reach the delegate, untouched (identity check).
    expect(seen[0].req).toBe(req);
    expect(seen[0].res).toBe(res as unknown as http.ServerResponse);
    // The dispatcher wrote nothing: the delegate owns the response.
    expect(res.headersSent).toBe(false);
    expect(res.writableEnded).toBe(false);
  });

  it('delegates a known path under the wrong method (methodNotAllowed), never the onion', () => {
    let delegateCalls = 0;
    const dispatcher = createApiDispatcher({
      // A path the router knows but not under this method: not a 'matched' kind, so
      // the dispatcher delegates and never builds a ctx or runs the onion/handler.
      registry: registryReturning({ kind: 'methodNotAllowed', allow: ['GET'] }),
      delegate: () => {
        delegateCalls++;
      },
    });
    const res = new FakeRes();
    dispatcher(
      makeReq({ method: 'POST', url: '/api/things/42' }),
      res as unknown as http.ServerResponse,
    );
    expect(delegateCalls).toBe(1);
    expect(res.writableEnded).toBe(false);
  });

  it('delegates a HEAD request (a synthesized GET match) to the legacy handleApi, never the onion', () => {
    // The table router synthesizes HEAD from GET: a HEAD to a registered GET route
    // resolves matched with head:true. While the legacy arms are retained the
    // migration must stay byte-identical, and the legacy ladder 404s HEAD, so the
    // dispatcher delegates a HEAD match instead of running the handler.
    let handlerCalls = 0;
    let delegateCalls = 0;
    const route = fakeRoute(async () => {
      handlerCalls++;
    });
    const dispatcher = createApiDispatcher({
      registry: registryReturning({ kind: 'matched', route, params: { id: '42' }, head: true }),
      delegate: () => {
        delegateCalls++;
      },
    });
    const res = new FakeRes();
    dispatcher(
      makeReq({ method: 'HEAD', url: '/api/things/42' }),
      res as unknown as http.ServerResponse,
    );
    expect(delegateCalls).toBe(1);
    expect(handlerCalls).toBe(0);
    // The dispatcher wrote nothing: the delegate owns the response.
    expect(res.writableEnded).toBe(false);
  });

  it('maps a handler throw to exactly one problem+json response without leaking the error', async () => {
    // The dispatcher injects a logger-backed onUnexpected into withErrors; silence
    // it so the deliberate 500 does not write an ops line to the test output.
    const errLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const events: MetricEvent[] = [];
    const route = fakeRoute(async () => {
      throw new Error('boom-secret-detail');
    });
    const dispatcher = createApiDispatcher({
      registry: registryReturning({ kind: 'matched', route, params: {}, head: false }),
      delegate: () => {},
      metricSink: { record: (e) => events.push(e) },
    });

    const res = new FakeRes();
    dispatcher(
      makeReq({ method: 'GET', url: '/api/things/1' }),
      res as unknown as http.ServerResponse,
    );
    await flush(res);

    expect(res.statusCode).toBe(500);
    expect(String(res.getHeader('content-type'))).toContain('application/problem+json');
    expect(res.writableEnded).toBe(true);
    // The 500-no-leak contract: the thrown detail never reaches the body.
    expect(res.body).not.toContain('boom-secret-detail');
    expect(events[0]?.status).toBe(500);
    // The ORIGINAL error DID reach the injected onUnexpected sink (the ops log).
    expect(errLog).toHaveBeenCalledTimes(1);
    errLog.mockRestore();
  });

  it("threads a route's meta.envelope into withErrors: an html route's throw serializes as HTML, never problem+json", async () => {
    const errLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    // Pins the dispatcher's `withErrors({ surface: route.meta?.envelope })` line, the
    // only production consumer of meta.envelope. The Discord OAuth callback rides on
    // exactly this: its RouteDef carries meta.envelope 'html' (pinned in
    // tests/server/discord.test.ts), so if the dispatcher ever dropped the threading an
    // escaping callback throw would flip to problem+json and break
    // window.opener.postMessage in the OAuth popup. The problem+json test above is the
    // un-enveloped control, proving the surface is per-route, not a global default.
    const route = fakeRoute(
      async () => {
        throw new Error('boom-secret-detail');
      },
      { envelope: 'html' },
    );
    const dispatcher = createApiDispatcher({
      registry: registryReturning({ kind: 'matched', route, params: {}, head: false }),
      delegate: () => {},
    });

    const res = new FakeRes();
    dispatcher(
      makeReq({ method: 'GET', url: '/api/things/1' }),
      res as unknown as http.ServerResponse,
    );
    await flush(res);

    expect(res.statusCode).toBe(500);
    expect(String(res.getHeader('content-type'))).toContain('text/html');
    expect(String(res.getHeader('content-type'))).not.toContain('application/problem+json');
    expect(res.writableEnded).toBe(true);
    // The same 500-no-leak contract holds on the HTML surface.
    expect(res.body).not.toContain('boom-secret-detail');
    errLog.mockRestore();
  });

  it('mounts the global gates on the REAL onion: an enforce-mode cross-site, wrong-type POST is rejected 403 ahead of route-local middleware (the origin gate outranks the 415)', async () => {
    // The onion_order.test.ts stack is a hand-built replica; this drives the real
    // createApiDispatcher mount. The gates are mounted with no opts, so they read
    // their enforce flags from process.env PER REQUEST: stubbing the env flips the
    // real mount, and the un-injected gates fall back to their structured-logger sinks.
    vi.stubEnv('API_ORIGIN_CHECK_ENFORCE', '1');
    vi.stubEnv('API_CONTENT_TYPE_ENFORCE', '1');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      let handlerCalls = 0;
      let routeMiddlewareCalls = 0;
      const route: RouteDef = {
        method: 'POST',
        path: '/api/things/:id',
        surface: 'api',
        middleware: [
          async (_ctx, next) => {
            routeMiddlewareCalls++;
            await next();
          },
        ],
        handler: async () => {
          handlerCalls++;
        },
      };
      const dispatcher = createApiDispatcher({
        registry: registryReturning({
          kind: 'matched',
          route,
          params: { id: '42' },
          head: false,
        }),
        delegate: () => {},
      });
      const res = new FakeRes();
      dispatcher(
        makeReq({
          method: 'POST',
          url: '/api/things/42',
          headers: {
            origin: 'https://evil.example',
            host: 'game.example',
            'content-type': 'text/plain',
          },
        }),
        res as unknown as http.ServerResponse,
      );
      await flush(res);

      // 403 origin.cross_site, NOT 415: the origin gate is mounted first, so a
      // request failing both gates resolves on the origin arm.
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).code).toBe('origin.cross_site');
      // Exactly ONE sink line fired (the origin gate's): the 415 gate never got
      // to record, proving the mount ORDER, not just presence. The msg is the
      // logger call's SECOND argument (the first is the structured fields).
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toBe('cross-site origin on mutating /api request');
      // Both gates sit AHEAD of the route-local middleware and the handler.
      expect(routeMiddlewareCalls).toBe(0);
      expect(handlerCalls).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      warn.mockRestore();
    }
  });

  it('drives the PRODUCTION composite sink shape: one access line AND one counter increment per request', async () => {
    // main.ts injects teeMetricSink(createAccessLogSink(logger), httpMetrics.sink)
    // into every dispatcher; this composes the same shape end to end so the tee
    // wiring itself (not just each sink in isolation) is pinned.
    const metrics = createHttpMetrics();
    const lines: string[] = [];
    const log = createLogger({ out: (line) => lines.push(line), err: (line) => lines.push(line) });
    const route = fakeRoute(async (ctx) => {
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end('{}');
    });
    const dispatcher = createApiDispatcher({
      registry: registryReturning({ kind: 'matched', route, params: { id: '42' }, head: false }),
      delegate: () => {},
      metricSink: teeMetricSink(createAccessLogSink(log), metrics.sink),
    });

    const res = new FakeRes();
    dispatcher(
      makeReq({ method: 'GET', url: '/api/things/42' }),
      res as unknown as http.ServerResponse,
    );
    await flush(res);

    // Exactly ONE structured access line, on the :param TEMPLATE, carrying the
    // reqId bound by runOnion (withMetrics records inside its ALS scope).
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(line.msg).toBe('access');
    expect(line.route).toBe('/api/things/:id');
    expect(line.status).toBe(200);
    expect(line.reqId).toBeTruthy();
    // The SAME request landed in the prom counter, on the same template.
    const text = await metrics.metricsText();
    expect(text).toContain('route="/api/things/:id"');
    expect(text.match(/^http_requests_total\{[^}]*\} 1$/m)).toBeTruthy();
  });
});

describe('selectApiEntry', () => {
  it("routes through the new dispatcher when the flag is 'new'", () => {
    const spyNew = vi.fn();
    const spyLegacy = vi.fn();
    const entry = selectApiEntry(
      'new',
      spyNew as unknown as ApiDispatcher,
      spyLegacy as unknown as ApiDelegate,
    );

    expect(entry).toBe(spyNew as unknown as ApiDispatcher);
    const req = makeReq();
    const res = new FakeRes();
    entry(req, res as unknown as http.ServerResponse);
    expect(spyNew).toHaveBeenCalledTimes(1);
    expect(spyLegacy).not.toHaveBeenCalled();
  });

  it("bypasses the dispatcher entirely and calls the legacy handleApi when the flag is 'legacy'", () => {
    const spyNew = vi.fn();
    const spyLegacy = vi.fn();
    const entry = selectApiEntry(
      'legacy',
      spyNew as unknown as ApiDispatcher,
      spyLegacy as unknown as ApiDelegate,
    );

    expect(entry).not.toBe(spyNew as unknown as ApiDispatcher);
    const req = makeReq();
    const res = new FakeRes();
    entry(req, res as unknown as http.ServerResponse);
    expect(spyLegacy).toHaveBeenCalledTimes(1);
    expect(spyLegacy).toHaveBeenCalledWith(req, res);
    expect(spyNew).not.toHaveBeenCalled();
  });
});

describe('delegate reqId scope: every delegate path binds a fresh ambient reqId', () => {
  // The onion path gets its reqId ALS scope from runOnion; these pin the OTHER
  // three arms (unmatched delegate, HEAD delegate, legacy-mode entry) so a swept
  // logger line inside a legacy handler still carries a reqId for correlation.
  // The binding is observability-only: the response bytes are untouched (the
  // req/res identity pins above stay in force).

  it('binds an ambient reqId around an unmatched-path delegate and holds it across an await', async () => {
    let during: string | undefined;
    let afterAwait: string | undefined;
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const dispatcher = createApiDispatcher({
      registry: registryReturning({ kind: 'notFound' }),
      delegate: async () => {
        during = currentReqId();
        await new Promise((r) => setTimeout(r, 0));
        afterAwait = currentReqId();
        resolveDone();
      },
    });
    const res = new FakeRes();
    dispatcher(
      makeReq({ method: 'GET', url: '/api/legacy/thing' }),
      res as unknown as http.ServerResponse,
    );
    await done;
    expect(during).toBeTruthy();
    expect(afterAwait).toBe(during);
  });

  it('binds an ambient reqId around a HEAD-match delegate', () => {
    let during: string | undefined;
    const route = fakeRoute(async () => {});
    const dispatcher = createApiDispatcher({
      registry: registryReturning({ kind: 'matched', route, params: { id: '42' }, head: true }),
      delegate: () => {
        during = currentReqId();
      },
    });
    const res = new FakeRes();
    dispatcher(
      makeReq({ method: 'HEAD', url: '/api/things/42' }),
      res as unknown as http.ServerResponse,
    );
    expect(during).toBeTruthy();
  });

  it("binds a FRESH ambient reqId per request on the 'legacy' entry (production default)", () => {
    const ids: Array<string | undefined> = [];
    const entry = selectApiEntry('legacy', vi.fn() as unknown as ApiDispatcher, () => {
      ids.push(currentReqId());
    });
    entry(makeReq(), new FakeRes() as unknown as http.ServerResponse);
    entry(makeReq(), new FakeRes() as unknown as http.ServerResponse);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});
