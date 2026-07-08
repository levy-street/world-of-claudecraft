// Object-level authorization (BOLA) load-then-authorize middleware for the API
// request pipeline.
//
// requireOwned(config) is the generic loader factory the owner-gated :id routes
// mount AFTER their auth guard. It is a load-then-authorize seam, scope-before-find:
//   1. read the caller's account id (a missing ctx.account is a composition bug: the
//      loader was mounted ahead of auth, so it maps to a 500, never a client error);
//   2. decode the :id param with num({ int, min: 1 }) BEFORE any DB call, so a
//      non-numeric / non-positive id is rejected by the validator (422) and a query
//      NEVER receives NaN;
//   3. call the ACCOUNT-SCOPED loader (id AND account_id AND realm); and
//   4. on a hit, stash the loaded, authorized row on ctx.state for the handler and
//      continue; on a MISS (the row does not exist OR belongs to another account,
//      indistinguishable by construction because the loader is account-scoped),
//      emit a structured `bola_denied` deny-log AND increment the bola_denied_total
//      counter (the source-spec 4.9 attack signal), then answer the route's
//      player-owned denial body: a 404 (anti-enumeration, the locked decision), NOT a
//      403, so a caller cannot tell "exists but not yours" apart from "does not exist".
//
// The denial writes the LEGACY { error } body byte-for-byte and short-circuits (no
// next(), no throw), exactly like the auth-surface credential guards: the migrated
// character routes preserve their legacy prose bodies (the client prose-matcher in
// src/main.ts keys on them until the ladder deletion), so a 404 here must not become a
// problem+json envelope. The num() 422 is the one path that DOES surface through the
// RFC 9457 error model (it throws the decode failure that withErrors maps), because a
// malformed :id has no legacy body to preserve: legacy's `\d+` route regexes never
// matched a non-numeric id, so it fell through to the 404 unknown-endpoint arm; the
// new router matches :id generically, and rejecting the bad id with a 422 on the known
// route family is the more correct (and NaN-safe) behavior (no golden fixture pins a
// non-numeric id, so this is not a parity divergence the harness can observe).

import { json } from '../../http_util';
import { attackSignalSink } from '../attack_signals';
import { ctxAccountId, currentReqId } from '../context';
import { logger } from '../logger';
import { num } from '../schema';
import type { Ctx, Middleware, Next } from '../types';

/** The account-scoped loader: fetch the row for (accountId, id), or null on a miss. */
export type OwnedLoader<T> = (accountId: number, id: number) => Promise<T | null>;

/**
 * One BOLA denial, emitted on every miss. It carries ONLY the caller's own account
 * id, the route + method, and the id the caller requested (their own request), plus
 * the request id for correlation. It NEVER records whether the row exists for another
 * account (the account-scoped loader was never asked), so the log cannot leak a
 * cross-account existence signal.
 */
export interface BolaDenyEvent {
  readonly event: 'bola_denied';
  /** The resource kind (e.g. 'character'). */
  readonly resource: string;
  readonly method: string;
  /** The route path as requested (carries the caller's own requested id). */
  readonly path: string;
  /** The authenticated caller's account id. */
  readonly accountId: number;
  /** The id the caller asked for (their own request; never another account's). */
  readonly requestedId: number;
  /** The per-request id for correlation with the metric event, when present. */
  readonly reqId?: string;
}

/**
 * A structured sink for BOLA denials; defaults to a single stderr warn line. It is
 * INJECTABLE per loader so a later change can wrap it (sampling / rate-limiting) without
 * touching this module: the deny-log fires on EVERY miss (a deliberate per-denial audit
 * signal, so a cross-account probe is always recorded), so its volume on the unlimited
 * owner READ routes (sheet/standing carry no per-action limiter, matching legacy) is
 * bounded downstream by the real structured-logging sink, not by adding a
 * read limiter here (which would 429 reads where legacy never did).
 */
export type BolaDenyLogger = (event: BolaDenyEvent) => void;

/** Default deny sink: one structured warn line via the logger (never the player-facing body). */
const defaultDenyLog: BolaDenyLogger = (event) => {
  logger.warn({ ...event }, 'bola_denied');
};

/** Everything requireOwned needs to load, authorize, and deny an owned :id resource. */
export interface RequireOwnedConfig<T> {
  /**
   * The resource kind. Used as the ctx.state key the loaded row is stashed under
   * (the handler reads ctx.state.get(resource)) and in the deny-log.
   */
  readonly resource: string;
  /** The :id path param name (e.g. 'id'). */
  readonly param: string;
  /** The account-scoped loader (id AND account_id AND realm). */
  readonly load: OwnedLoader<T>;
  /**
   * The legacy { error } body written on a miss, e.g. { error: 'character not found' }
   * or { error: 'not found' }, byte-for-byte with the legacy arm this route replaces.
   */
  readonly notFoundBody: Record<string, unknown>;
  /** Structured deny-log sink; defaults to a stderr warn line. Injected in tests. */
  readonly denyLog?: BolaDenyLogger;
}

/**
 * Build the load-then-authorize middleware for `config`. On a hit it stores the row
 * at ctx.state[config.resource] and continues; on a non-numeric :id it throws the
 * decode failure (422, before any DB call); on a not-found/not-owned miss it deny-logs
 * and answers the legacy 404 body without calling next().
 */
export function requireOwned<T>(config: RequireOwnedConfig<T>): Middleware {
  const denyLog = config.denyLog ?? defaultDenyLog;
  // Reject a non-numeric or non-positive id BEFORE any DB call, so a query never
  // receives NaN. A positive safe integer is required (ids are 1-based bigserial).
  const idSchema = num({ int: true, min: 1 });
  return async (ctx: Ctx, next: Next) => {
    const accountId = ctxAccountId(ctx);
    const decoded = idSchema.decode(ctx.params[config.param], `/${config.param}`);
    // A raw { ok: false, issues } is what toAppError maps to 422 validation.failed.
    if (!decoded.ok) throw decoded;
    const row = await config.load(accountId, decoded.value);
    if (row === null) {
      denyLog({
        event: 'bola_denied',
        resource: config.resource,
        method: ctx.method,
        path: ctx.path,
        accountId,
        requestedId: decoded.value,
        reqId: currentReqId(),
      });
      // The counter label MUST be ctx.route (the :param TEMPLATE, e.g.
      // '/api/characters/:id'), NEVER ctx.path (the concrete request, which would
      // explode label cardinality and leak the requested id); 'unknown' is only the
      // defensive fallback for a ctx built without a route match.
      attackSignalSink().bolaDenied(ctx.route ?? 'unknown');
      json(ctx.res, 404, config.notFoundBody);
      return;
    }
    ctx.state.set(config.resource, row);
    await next();
  };
}
