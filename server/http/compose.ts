// Koa-style middleware onion runner for the API request pipeline.
//
// compose(stack) returns the recursive onion dispatch: each middleware does
// work, awaits next(), then unwinds in reverse order. The load-bearing rule:
// compose() itself does NOT send a response and does NOT catch. Raw node:http
// leaves the socket hanging on an uncaught throw, so runOnion is the OUTERMOST
// wrapper that guarantees EXACTLY ONE idempotent response on BOTH the resolve
// path (a structural fallback) and the throw path (a bare, detail-free 500).
// respondOnce is the headersSent/writableEnded-guarded low-level sender that
// keeps both fallbacks no-ops once any middleware has already responded.
//
// withErrors (the real RFC 9457 problem+json mapping) sits INSIDE this
// wrapper; this module ships only the structural net so the socket never
// hangs. No body, stack, SQL, table text, or prose leaks here.

import type * as http from 'node:http';
import { runWithReqId } from './context';
import { REQUEST_ID_HEADER } from './errors';
import type { Ctx, Middleware, Next } from './types';

// The onion resolved without any middleware or handler producing a response.
// This is a structural safety net so the socket never hangs; it is DISTINCT from
// the uncaught-throw 500 below. In the live pipeline a matched handler
// always responds, so this only fires for a misbehaving middleware stack.
const FALLBACK_NO_RESPONSE_STATUS = 404;
// An uncaught error escaped the onion. raw node:http would leave the socket
// hanging, so we send a bare 500 with NO body (no stack, SQL, table, or prose).
// The withErrors middleware normally maps a throw to the real RFC 9457
// problem+json envelope (defined by the error model, errors.ts) before it
// reaches this outermost net.
const FALLBACK_ERROR_STATUS = 500;

// Echoed on the structural fallbacks so a hung/errored request is still
// correlatable. The header NAME is single-sourced in errors.ts (the live
// error-path emitter, a leaf module: compose -> context -> errors rules out the
// reverse import) and re-exported here for the middleware and test consumers.
export { REQUEST_ID_HEADER };

// Thrown when a single middleware frame calls next() more than once. The exact
// text matches the nextGuard primitive in tests/server/helpers/fake_ctx.ts so
// the double-next guard reads identically in the harness and the real runtime.
const DOUBLE_NEXT_MESSAGE = 'next() called multiple times';

/**
 * Compose a middleware stack into a single dispatch function (the canonical Koa
 * onion). The returned function runs the stack in order; each middleware that
 * awaits next() unwinds in reverse. The optional trailing `next` is invoked
 * after the last middleware (Koa semantics); without one, the deepest next()
 * resolves to undefined harmlessly. Calling next() twice in one frame rejects.
 */
export function compose(stack: Middleware[]): (ctx: Ctx, next?: Next) => Promise<void> {
  return function composed(ctx: Ctx, next?: Next): Promise<void> {
    // Highest frame index already entered; -1 means none yet. The double-next
    // guard compares against it so a frame can never advance the cursor twice.
    let lastIndex = -1;
    function dispatch(i: number): Promise<void> {
      if (i <= lastIndex) {
        return Promise.reject(new Error(DOUBLE_NEXT_MESSAGE));
      }
      lastIndex = i;
      // The trailing next has fewer params than Middleware, which is assignable;
      // calling it with the extra dispatch arg is the harmless Koa convention.
      const fn: Middleware | undefined = i === stack.length ? next : stack[i];
      if (!fn) return Promise.resolve();
      try {
        return Promise.resolve(fn(ctx, dispatch.bind(null, i + 1)));
      } catch (err) {
        // A synchronous throw becomes a rejected promise, so callers only ever
        // see one failure channel (the awaited promise), never a raw throw.
        return Promise.reject(err);
      }
    }
    return dispatch(0);
  };
}

/**
 * Run a middleware stack and guarantee EXACTLY ONE idempotent response on both
 * paths. The composed stack runs INSIDE the reqId AsyncLocalStorage carrier so
 * currentReqId() works across awaits without threading ctx. On resolve with no
 * response, send the structural 404 fallback; on an uncaught throw, send a bare
 * 500 with NO body (the error is never read, so nothing leaks). Both respondOnce
 * calls are no-ops when a middleware already responded, which is how "exactly
 * one response" holds.
 */
export async function runOnion(ctx: Ctx, stack: Middleware[]): Promise<void> {
  try {
    await runWithReqId(ctx.reqId, () => compose(stack)(ctx));
    finalizeResponse(ctx, FALLBACK_NO_RESPONSE_STATUS);
  } catch {
    // No error binding: the thrown value is never read or serialized, so no
    // stack, SQL, table name, or message can leak through the fallback.
    finalizeResponse(ctx, FALLBACK_ERROR_STATUS);
  }
}

/**
 * Guarantee the request ends with EXACTLY ONE response and the socket is never
 * left hanging, and never throw out of the safety net. Three cases: (1) the
 * response is already fully ended (the normal dispatch path once a handler runs),
 * so do nothing; (2) nothing was committed, so send the bare fallback; (3) a
 * misbehaving middleware committed headers but never ended, so end() closes the
 * socket without an illegal second writeHead. A throw from an unusable response
 * object (e.g. a destroyed socket) is swallowed: there is nothing left to send.
 */
function finalizeResponse(ctx: Ctx, status: number): void {
  const { res } = ctx;
  if (res.writableEnded) return;
  try {
    if (!respondOnce(res, status, { [REQUEST_ID_HEADER]: ctx.reqId })) {
      res.end();
    }
  } catch {
    // The response object is unusable; runOnion must never throw out of its net.
  }
}

/**
 * Idempotent low-level sender. Returns false (a no-op) when the response is
 * already committed, since the real node ServerResponse and the test FakeRes
 * both THROW on a second writeHead/end. An undefined body sends an empty body,
 * which is what the structural fallbacks want.
 */
export function respondOnce(
  res: http.ServerResponse,
  status: number,
  headers?: Record<string, string | number>,
  body?: string | Buffer,
): boolean {
  if (res.headersSent || res.writableEnded) return false;
  res.writeHead(status, headers);
  res.end(body);
  return true;
}
