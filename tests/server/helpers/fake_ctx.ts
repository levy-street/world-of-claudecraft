// A test-harness builder for the frozen Ctx (server/http/types). fakeCtx returns a
// well-formed Ctx with sane, deterministic defaults (method GET, url
// http://localhost/, ip 127.0.0.1, a fixed reqId, an empty state Map), wiring a
// FakeRes and a makeReq req unless the caller overrides them. The overrides object
// shape is intentionally stable so fakeCtx can be re-pointed at the real
// buildContext with no test churn: callers always pass the same descriptor.
// nextGuard is a harness primitive that models the onion's "next() called multiple
// times" guard; it is NOT the real compose runtime.
import type * as http from 'node:http';
import type { Ctx, CtxAccount, Method, Next } from '../../../server/http/types';
import { FakeRes, makeReq } from './fake_http';

/**
 * Everything a test may override on a fakeCtx. All fields are optional; the shape
 * stays stable across refactors (fakeCtx can be re-pointed at buildContext without
 * touching any caller). `headers` flow into the built req; `url` may be a string
 * (resolved against http://localhost) or a ready URL.
 */
export interface FakeCtxOverrides {
  method?: Method;
  url?: string | URL;
  path?: string;
  /** The matched route's :param template (Ctx.route); unset models an unmatched ctx. */
  route?: string;
  headers?: Record<string, string>;
  body?: unknown;
  account?: CtxAccount;
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
  ip?: string;
  reqId?: string;
  res?: http.ServerResponse;
  req?: http.IncomingMessage;
  state?: Map<string, unknown>;
}

/** Resolve an override url (string, relative or absolute, or URL) to a URL. */
function toUrl(url: string | URL | undefined): URL {
  if (url instanceof URL) return url;
  if (typeof url === 'string') return new URL(url, 'http://localhost');
  return new URL('http://localhost/');
}

/**
 * Build a Ctx-shaped object per the frozen contract. Defaults are deterministic
 * (no Date.now / Math.random): method GET, url http://localhost/, ip 127.0.0.1,
 * reqId 'test-req-1', empty query/params, a fresh state Map, undefined body and
 * account. A FakeRes (cast to http.ServerResponse) and a makeReq req are built
 * unless the caller supplies res / req.
 */
export function fakeCtx(overrides: FakeCtxOverrides = {}): Ctx {
  const url = toUrl(overrides.url);
  const method: Method = overrides.method ?? 'GET';
  const req =
    overrides.req ??
    makeReq({
      method,
      url: url.pathname + url.search,
      headers: overrides.headers,
      body: overrides.body,
    });
  const res = overrides.res ?? (new FakeRes() as unknown as http.ServerResponse);

  return {
    req,
    res,
    method,
    url,
    path: overrides.path ?? url.pathname,
    route: overrides.route,
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    ip: overrides.ip ?? '127.0.0.1',
    reqId: overrides.reqId ?? 'test-req-1',
    body: overrides.body,
    account: overrides.account,
    state: overrides.state ?? new Map<string, unknown>(),
  };
}

/**
 * A Next that runs `fn` once and throws if invoked a second time, modeling the
 * onion's single-call guard. A harness primitive, not the real compose runtime.
 */
export function nextGuard(fn?: () => Promise<void> | void): Next {
  let called = false;
  return async () => {
    if (called) throw new Error('next() called multiple times');
    called = true;
    await fn?.();
  };
}
