// Tests for the request-context builder and the reqId AsyncLocalStorage
// carrier (server/http/context.ts). Covers field population, method-case
// normalization, query single-vs-repeated and null-proto shape, per-variant
// params (fresh, null-proto, never shared), reqId uniqueness, IP resolution via
// ratelimit.requestIp, the AsyncLocalStorage carrier across awaits and nesting,
// and that the built Ctx still mirrors the fakeCtx helper's shape.

import type * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  buildContext,
  currentReqId,
  newReqId,
  reqIdStorage,
  runWithReqId,
} from '../../../server/http/context';
import type { MatchResult } from '../../../server/http/router';
import type { Ctx, RouteDef } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import { FakeRes, makeReq } from '../helpers/fake_http';

/** A fresh FakeRes cast to the node response type at the boundary. */
function makeRes(): http.ServerResponse {
  return new FakeRes() as unknown as http.ServerResponse;
}

/**
 * Build a 'matched' MatchResult with NULL-PROTO params (mirroring the router's
 * matchPattern), so a test can assert ctx.params is null-proto on the matched path.
 */
function matched(
  params: Record<string, string> = {},
  template = '/api/x/:id',
): MatchResult<RouteDef> {
  const nullProtoParams: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(params)) nullProtoParams[key] = value;
  // buildContext reads only route.path (the :param template, surfaced as
  // ctx.route) and params off the match, so a path-only cast is fine in a test.
  return {
    kind: 'matched',
    route: { path: template } as RouteDef,
    params: nullProtoParams,
    head: false,
  };
}

describe('buildContext field population', () => {
  it('populates every field from a matched route', () => {
    const req = makeReq({ method: 'POST', url: '/api/x/42?q=1' });
    const ctx = buildContext(req, makeRes(), matched({ id: '42' }));
    expect(ctx.method).toBe('POST');
    expect(ctx.url).toBeInstanceOf(URL);
    expect(ctx.url.pathname).toBe('/api/x/42');
    expect(ctx.path).toBe('/api/x/42');
    expect(ctx.route).toBe('/api/x/:id');
    expect(ctx.params.id).toBe('42');
    expect(ctx.ip).toBe('127.0.0.1');
    expect(typeof ctx.reqId).toBe('string');
    expect(ctx.reqId.length).toBeGreaterThan(0);
    expect(ctx.body).toBeUndefined();
    expect(ctx.account).toBeUndefined();
    expect(ctx.state).toBeInstanceOf(Map);
    expect(ctx.state.size).toBe(0);
  });
});

describe('method case normalization', () => {
  it('upper-cases a lowercase req.method', () => {
    const ctx = buildContext(makeReq({ method: 'get', url: '/p' }), makeRes(), {
      kind: 'notFound',
    });
    expect(ctx.method).toBe('GET');
  });
});

describe('query parsing', () => {
  it('keeps a single key a string and a repeated key an array', () => {
    const ctx = buildContext(makeReq({ url: '/p?a=1&b=2&b=3' }), makeRes(), { kind: 'notFound' });
    expect(ctx.query.a).toBe('1');
    expect(ctx.query.b).toEqual(['2', '3']);
  });

  it('yields an empty query object when there is no query string', () => {
    const ctx = buildContext(makeReq({ url: '/p' }), makeRes(), { kind: 'notFound' });
    expect(Object.keys(ctx.query)).toHaveLength(0);
  });
});

describe('null-prototype shapes', () => {
  it('builds query on a null prototype', () => {
    const ctx = buildContext(makeReq({ url: '/p?a=1' }), makeRes(), { kind: 'notFound' });
    expect(Object.getPrototypeOf(ctx.query)).toBeNull();
  });

  it('keeps params on a null prototype when matched', () => {
    const ctx = buildContext(makeReq({ url: '/api/x/42' }), makeRes(), matched({ id: '42' }));
    expect(Object.getPrototypeOf(ctx.params)).toBeNull();
  });
});

describe('the route template field', () => {
  it('carries the matched route :param TEMPLATE, never the concrete path', () => {
    const ctx = buildContext(
      makeReq({ url: '/api/x/42' }),
      makeRes(),
      matched({ id: '42' }, '/api/x/:id'),
    );
    expect(ctx.route).toBe('/api/x/:id');
    expect(ctx.route).not.toBe('/api/x/42');
  });

  it('leaves route undefined for a non-matched variant', () => {
    const ctx = buildContext(makeReq({ url: '/p' }), makeRes(), { kind: 'notFound' });
    expect(ctx.route).toBeUndefined();
  });
});

describe('params for non-matched variants', () => {
  it('gives notFound an empty null-proto params object', () => {
    const ctx = buildContext(makeReq({ url: '/p' }), makeRes(), { kind: 'notFound' });
    expect(Object.keys(ctx.params)).toHaveLength(0);
    expect(Object.getPrototypeOf(ctx.params)).toBeNull();
  });

  it('gives methodNotAllowed an empty null-proto params object', () => {
    const notAllowed: MatchResult<RouteDef> = { kind: 'methodNotAllowed', allow: ['GET'] };
    const ctx = buildContext(makeReq({ url: '/p' }), makeRes(), notAllowed);
    expect(Object.keys(ctx.params)).toHaveLength(0);
    expect(Object.getPrototypeOf(ctx.params)).toBeNull();
  });

  it('gives options an empty null-proto params object', () => {
    const options: MatchResult<RouteDef> = { kind: 'options', allow: ['GET', 'OPTIONS'] };
    const ctx = buildContext(makeReq({ url: '/p' }), makeRes(), options);
    expect(Object.keys(ctx.params)).toHaveLength(0);
    expect(Object.getPrototypeOf(ctx.params)).toBeNull();
  });

  it('returns a DISTINCT params object on two successive non-matched calls', () => {
    const a = buildContext(makeReq({ url: '/p' }), makeRes(), { kind: 'notFound' });
    const b = buildContext(makeReq({ url: '/p' }), makeRes(), { kind: 'notFound' });
    expect(a.params).not.toBe(b.params);
  });
});

describe('url authority pinning', () => {
  it('pins ctx.url authority to the placeholder on an absolute-form request target', () => {
    // A client may send absolute-form (GET http://evil.com/api/foo). buildContext must
    // take only the path + query so ctx.url.host can never be the client-supplied host.
    const req = makeReq({ url: 'http://evil.com/api/foo?x=1' });
    const ctx = buildContext(req, makeRes(), { kind: 'notFound' });
    expect(ctx.url.host).toBe('localhost');
    expect(ctx.path).toBe('/api/foo');
    expect(ctx.query.x).toBe('1');
  });

  it('does not throw on a malformed request target and falls back to the root path', () => {
    // new URL throws on an absolute-form target with an empty authority; buildContext
    // must stay total because it runs before runOnion's safety net.
    const req = makeReq({ url: 'http://' });
    const ctx = buildContext(req, makeRes(), { kind: 'notFound' });
    expect(ctx.path).toBe('/');
    expect(ctx.url.host).toBe('localhost');
  });

  it('pins the authority on a plain origin-form target that normalizes to a leading //', () => {
    // A plain origin-form target (no scheme) whose path collapses to a leading '//'
    // (e.g. '/..//evil.com' -> '//evil.com') must NOT be re-read as a protocol-relative
    // authority: ctx.url.host stays the placeholder, never the embedded client host.
    const req = makeReq({ url: '/..//evil.com' });
    const ctx = buildContext(req, makeRes(), { kind: 'notFound' });
    expect(ctx.url.host).toBe('localhost');
  });

  it('pins the authority on a //host:port pathname target', () => {
    // The port-bearing variant ('/..//evil.com:8443/x' -> '//evil.com:8443/x') is the
    // same protocol-relative-authority vector; the authority must still be the placeholder.
    const req = makeReq({ url: '/..//evil.com:8443/x' });
    const ctx = buildContext(req, makeRes(), { kind: 'notFound' });
    expect(ctx.url.host).toBe('localhost');
  });
});

describe('reqId uniqueness', () => {
  it('mints a distinct reqId per buildContext call', () => {
    const a = buildContext(makeReq({ url: '/p' }), makeRes(), { kind: 'notFound' });
    const b = buildContext(makeReq({ url: '/p' }), makeRes(), { kind: 'notFound' });
    expect(a.reqId).not.toBe(b.reqId);
  });

  it('mints a distinct id per newReqId call', () => {
    expect(newReqId()).not.toBe(newReqId());
  });
});

describe('ip resolution via requestIp', () => {
  it('resolves the X-Forwarded-For client behind a trusted loopback proxy', () => {
    // socket.remoteAddress defaults to loopback (127.0.0.1), which requestIp trusts,
    // so the public XFF address is taken as the real client.
    const req = makeReq({ url: '/p', headers: { 'x-forwarded-for': '203.0.113.7' } });
    const ctx = buildContext(req, makeRes(), { kind: 'notFound' });
    expect(ctx.ip).toBe('203.0.113.7');
  });
});

describe('reqId AsyncLocalStorage carrier', () => {
  it('is undefined outside any run', () => {
    expect(currentReqId()).toBeUndefined();
  });

  it('binds the id inside a run and survives an await', async () => {
    await runWithReqId('rid-X', async () => {
      expect(currentReqId()).toBe('rid-X');
      await Promise.resolve();
      expect(currentReqId()).toBe('rid-X');
    });
    expect(currentReqId()).toBeUndefined();
  });

  it('restores the outer id after a nested run returns', () => {
    runWithReqId('outer', () => {
      expect(currentReqId()).toBe('outer');
      runWithReqId('inner', () => {
        expect(currentReqId()).toBe('inner');
      });
      expect(currentReqId()).toBe('outer');
    });
  });

  it('exposes the same store via reqIdStorage.getStore', () => {
    runWithReqId('rid-Y', () => {
      expect(reqIdStorage.getStore()).toBe('rid-Y');
    });
  });
});

describe('fakeCtx shape compatibility', () => {
  it('produces the same own enumerable keys as fakeCtx', () => {
    const a: Ctx = fakeCtx();
    const b: Ctx = buildContext(makeReq(), makeRes(), { kind: 'notFound' });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
});
