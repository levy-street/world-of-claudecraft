// The outermost middleware and single response authority for the API request
// pipeline onion. It runs next() and catches whatever
// escapes: the thrown value is normalized and serialized by errors.ts's
// mapError, then written via the idempotent respondOnce, so a handler that
// already responded is never double-written (respondOnce is a no-op once
// headersSent/writableEnded).
//
// withErrors never rethrows: it is the terminal error boundary inside the
// onion, upstream of runOnion's bare structural fallback (compose.ts), which
// only fires for a stack that somehow still escapes THIS middleware.

import { respondOnce } from '../compose';
import type { ErrorSurface } from '../errors';
import { mapError } from '../errors';
import type { Ctx, EnvelopeKind, Middleware, Next } from '../types';

/** Options forwarded to mapError: which surface to serialize for, and the unexpected-error sink. */
export interface WithErrorsOptions {
  surface?: EnvelopeKind | ErrorSurface;
  onUnexpected?: (err: unknown) => void;
}

/**
 * Build the outermost onion middleware. On a throw from next(), map the error
 * to a SerializedError and send it in one respondOnce call: mapError returns
 * headers and contentType as SEPARATE fields (headers never itself carries
 * Content-Type), so they are merged here to write Content-Type exactly once.
 */
export function withErrors(opts?: WithErrorsOptions): Middleware {
  return async (ctx: Ctx, next: Next) => {
    try {
      await next();
    } catch (err) {
      const serialized = mapError(err, ctx, opts);
      respondOnce(
        ctx.res,
        serialized.status,
        { ...serialized.headers, 'Content-Type': serialized.contentType },
        serialized.body,
      );
    }
  };
}
