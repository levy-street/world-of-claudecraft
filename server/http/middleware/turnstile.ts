// Per-route Turnstile (anti-bot) middleware for the API request pipeline.
//
// The credential surface (register + login) gates account creation and login
// behind Cloudflare Turnstile (or a native-app attestation). This middleware runs
// AFTER withBody (it reads the parsed body for the token / attestation) and is
// attached ONLY to the register + login RouteDefs, never as a global prologue and
// never on the native-attestation challenge route itself.
//
// On rejection it short-circuits with the SAME legacy { error } body the inline
// handleApi arm wrote, byte-for-byte, so the client prose-matcher (src/main.ts
// userFacingApiError) still resolves it to the localized "verification failed"
// key. It does NOT throw an HttpError: routing the failure through the RFC 9457
// error model (a problem+json body with a stable code) waits for the ladder-deletion
// give-way; here parity with the legacy body is what the migration preserves.

import type * as http from 'node:http';
import { json } from '../../http_util';
import type { Ctx, Middleware } from '../types';

/**
 * The legacy Turnstile-failure body. Kept as a single constant so the string the
 * client matcher keys on ("verification failed, please try again") cannot drift.
 */
const TURNSTILE_FAILED_BODY = {
  error: 'verification failed, please try again',
  code: 'auth.verification_failed',
} as const;

/** The one dependency the middleware needs: the anti-bot verifier to run. */
export interface TurnstileDeps {
  /**
   * Returns true when the request may proceed: a native-app attestation verifies,
   * OR a supplied Turnstile token verifies, OR no secret is configured (dev/test).
   * Mirrors main.ts passesTurnstile, injected whole so this middleware never
   * re-reads TURNSTILE_SECRET or duplicates the verifier.
   */
  readonly verify: (req: http.IncomingMessage, body: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Build the per-route Turnstile gate. Reads the parsed ctx.body (so it must be
 * mounted AFTER withBody), runs the injected verifier, and on failure answers the
 * legacy 403 body without calling next(); on success it passes through.
 */
export function turnstile(deps: TurnstileDeps): Middleware {
  return async (ctx: Ctx, next) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    if (!(await deps.verify(ctx.req, body))) {
      json(ctx.res, 403, TURNSTILE_FAILED_BODY);
      return;
    }
    await next();
  };
}
