// Re-establishes the reqId AsyncLocalStorage binding around next() AND echoes the
// id as the X-Request-Id response header. buildContext already sets ctx.reqId and
// runOnion already wraps the whole onion run in runWithReqId, so the ALS rebind is
// redundant in the wired pipeline; it matters whenever a middleware stack is composed and run
// WITHOUT runOnion (e.g. a focused unit test), where currentReqId() would otherwise
// read undefined downstream. The header echo is the new load-bearing behavior.

import { REQUEST_ID_HEADER } from '../compose';
import { newReqId, runWithReqId } from '../context';
import type { Ctx, Middleware, Next } from '../types';

/**
 * Bind ctx.reqId as the ambient request id for the duration of next(), and echo it
 * as the X-Request-Id response header. Falls back to a freshly minted id when
 * ctx.reqId is falsy: the frozen Ctx contract has buildContext/fakeCtx always set a
 * non-empty reqId, so this only guards a degenerate caller; it never writes back
 * onto ctx.reqId (that field is readonly on the frozen Ctx type).
 *
 * The header is set ON THE WAY IN (before next()) via res.setHeader, so it survives
 * the final writeHead merge on BOTH the 2xx response and a thrown-5xx mapped by
 * withErrors (which also emits X-Request-Id, with the same value, from its own
 * serializer). The header name is single-sourced from compose.ts.
 */
export function withRequestId(): Middleware {
  return (ctx: Ctx, next: Next): Promise<void> => {
    const reqId = ctx.reqId || newReqId();
    ctx.res.setHeader(REQUEST_ID_HEADER, reqId);
    return runWithReqId(reqId, next);
  };
}
