// The request-context builder plus the reqId AsyncLocalStorage carrier for the
// API request pipeline.
//
// buildContext turns a (req, res, MatchResult) triple into the frozen Ctx
// (server/http/types.ts) that handlers and middleware read instead of touching
// req/res directly. Per the frozen contract, body and account stay undefined
// here: the withBody/auth middleware fill them. Client IP is REUSED from
// ratelimit.requestIp (X-Forwarded-For aware), never re-derived from the socket.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type * as http from 'node:http';
import { requestIp } from '../ratelimit';
import { HttpError } from './errors';
import type { MatchResult } from './router';
import type { Ctx, Method, RouteDef } from './types';

// node:http req.url is origin-form (path + query) and carries no scheme/host, so
// `new URL` needs a base. This placeholder authority lets us parse it; only
// pathname/search are load-bearing (it matches the fakeCtx test-harness base).
const PLACEHOLDER_ORIGIN = 'http://localhost';
// Fallback request target when req.url is absent or unparseable. The leading slash
// keeps it a valid origin-form path that resolves against PLACEHOLDER_ORIGIN.
const DEFAULT_REQUEST_PATH = '/';
// Fallback method when req.method is absent. node delivers a method on every real
// request; this only guards the type so ctx.method is never undefined.
const DEFAULT_METHOD = 'GET';

// Per-request id carrier. It lets db.ts and other domain code read currentReqId()
// for logging/correlation WITHOUT threading ctx through every call; runOnion
// (compose.ts) wraps the composed run in runWithReqId so the same id spans
// every await on the request.
export const reqIdStorage = new AsyncLocalStorage<string>();

/** Mint a fresh, unique per-request id (a server-side id, not sim randomness). */
export function newReqId(): string {
  return randomUUID();
}

/** Run `fn` with `reqId` bound as the ambient request id for the duration. */
export function runWithReqId<T>(reqId: string, fn: () => T): T {
  return reqIdStorage.run(reqId, fn);
}

/** The ambient request id, or undefined when called outside any runWithReqId. */
export function currentReqId(): string | undefined {
  return reqIdStorage.getStore();
}

/**
 * The authenticated caller's account id off ctx. A missing ctx.account here is a
 * COMPOSITION bug: an account-scoped middleware or handler was mounted ahead of the
 * auth guard that populates it, never a client error, so it maps to a 500. Shared by
 * requireOwned, the ip+account rate-limit policies, and the character handlers so the
 * 500-vs-client-error contract lives in exactly one place.
 */
export function ctxAccountId(ctx: Ctx): number {
  const id = ctx.account?.accountId;
  if (id === undefined) throw new HttpError(500, 'internal.error');
  return id;
}

/**
 * Parse a URL's query string into the Ctx.query shape: a key seen once is a
 * string, a key seen two or more times is the ordered string[] of its values.
 * Built on a null-prototype object (defense-in-depth against a prototype-polluted
 * query key, matching the router's null-proto params idiom).
 */
function parseQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = Object.create(null);
  // searchParams.keys() repeats a key once per value, so dedupe before getAll.
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return query;
}

/**
 * Parse req.url into a WHATWG URL whose authority is ALWAYS the fixed placeholder.
 * req.url is normally origin-form (/path?query) but a client may send absolute-form
 * (GET http://host/path), where `new URL(input, base)` ignores the base and adopts
 * the client's host. We rebuild by ASSIGNING the parsed path + search onto a fresh
 * placeholder-authority URL (never by re-parsing them as a string), so a client can
 * never inject a foreign authority into ctx.url (which downstream code might trust for a
 * redirect Location or a same-origin check). It never throws: a target `new URL` cannot
 * parse falls back to the default path, keeping buildContext total (it runs before
 * runOnion's safety net in the dispatcher).
 */
function buildUrl(target: string): URL {
  try {
    const parsed = new URL(target, PLACEHOLDER_ORIGIN);
    // ASSIGN path + search onto a fresh fixed-authority URL; do NOT re-parse
    // `parsed.pathname + parsed.search` as a string. A normalized pathname can begin
    // with '//' (the plain origin-form target '/..//evil.com' collapses to '//evil.com'),
    // and `new URL('//evil.com', base)` would read that as a protocol-relative AUTHORITY
    // and adopt the client host. The pathname/search setters leave the authority pinned.
    const url = new URL(PLACEHOLDER_ORIGIN);
    url.pathname = parsed.pathname;
    url.search = parsed.search;
    return url;
  } catch {
    return new URL(DEFAULT_REQUEST_PATH, PLACEHOLDER_ORIGIN);
  }
}

/**
 * Build the frozen Ctx for one request. Reads ONLY params from the match (the
 * matched variant alone carries them); body and account stay undefined until
 * the withBody/auth middleware fill them.
 */
export function buildContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: MatchResult<RouteDef>,
): Ctx {
  const url = buildUrl(req.url ?? DEFAULT_REQUEST_PATH);
  // The router validates the request method before the dispatcher calls buildContext (and
  // node delivers it uppercase already), so here we only normalize the case and trust it.
  const method = (req.method ?? DEFAULT_METHOD).toUpperCase() as Method;
  // The matched variant alone carries params; every other variant gets a FRESH,
  // empty null-proto object (never a shared singleton a later caller could mutate).
  const params =
    match.kind === 'matched' ? match.params : (Object.create(null) as Record<string, string>);
  return {
    req,
    res,
    method,
    url,
    path: url.pathname,
    // The matched variant alone carries the route (and so its :param template);
    // the template, never the concrete path, is what may reach a metric label.
    route: match.kind === 'matched' ? match.route.path : undefined,
    query: parseQuery(url.searchParams),
    params,
    ip: requestIp(req),
    reqId: newReqId(),
    body: undefined,
    account: undefined,
    state: new Map<string, unknown>(),
  };
}
