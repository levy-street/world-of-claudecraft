// Log-only cross-site Origin check for mutating /api requests. On a mutating
// method (POST/PUT/PATCH/DELETE) to the /api
// surface, a request whose Origin is clearly cross-site (present, and neither
// same-origin nor allowlisted) is recorded and, in enforce mode, rejected with
// the stable 'origin.cross_site' code. It ships LOG-ONLY by default: native
// Capacitor/Electron traffic is not yet audited, so flipping to enforce awaits
// that traffic audit (this mirrors the sibling Content-Type 415 gate).
//
// It runs only inside the NEW-dispatcher onion for MATCHED routes; delegate-served
// paths (the documented registered-surface carve-out) never reach it, so the check
// only ever covers the registered /api surface.
//
// The surface is bearer-only with NO cookies, so CSRF risk is minimal and an
// ABSENT Origin is always allowed: beacons and native clients that send no Origin
// must keep working. This is defense-in-depth, not the primary auth control.

import type * as http from 'node:http';
import { allowedCorsOrigin } from '../../web_login_guard';
import { HttpError } from '../errors';
import { logger } from '../logger';
import { createMismatchWarnThrottle, type MismatchWarnThrottle } from '../mismatch_warn_throttle';
import type { Ctx, Middleware, Next, RouteDef } from '../types';
// The shared mutating-method set: single-sourced in the sibling gate so the two
// gates cannot diverge on which methods they cover.
import { MUTATING_METHODS } from './content_type';

/** Env var that flips the cross-site Origin check from log-only to enforce. */
export const ORIGIN_CHECK_ENFORCE_ENV = 'API_ORIGIN_CHECK_ENFORCE';

/**
 * True only when the enforce flag is '1' or 'true'. Any other value (including an
 * absent flag) is LOG-ONLY: native Capacitor/Electron traffic is unconfirmed, so
 * flipping to enforce awaits the traffic audit.
 */
export function originCheckEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env[ORIGIN_CHECK_ENFORCE_ENV] ?? '').toLowerCase();
  return v === '1' || v === 'true';
}

/** One recorded cross-site mismatch, handed to the sink for audit. */
export interface CrossSiteMismatch {
  /** The route TEMPLATE (route.path), never the concrete request URL. */
  readonly route: string;
  readonly method: string;
  /** The raw Origin header value. */
  readonly origin: string;
  /** The Sec-Fetch-Site header value, recorded as audit context (never gated on). */
  readonly secFetchSite: string | undefined;
  /** True when the request was rejected (enforce); false when passed through (log-only). */
  readonly enforced: boolean;
}

/** Receives one CrossSiteMismatch per clear cross-site mutating request. */
export type CrossSiteMismatchSink = (mismatch: CrossSiteMismatch) => void;

/**
 * Build the default sink: ONE structured dev-channel warning per ADMITTED
 * mismatch via the structured logger. English only: this is a dev/ops channel,
 * not player-facing text. The throttle bounds warn volume per
 * (method, route-template) window because this check runs AHEAD of the
 * route-local rate limiters, so a crafted cross-site-Origin flood must not
 * amplify log volume one line per request; the first line of each new window
 * carries the prior window's suppressed count so a flood stays visible. A
 * suppressed line can hide a DISTINCT origin value: a recurring legitimate
 * origin re-surfaces on any (method, route-template) key not saturated by a
 * flood, but under a sustained flood of ONE key a low-rate origin on that same
 * key can stay suppressed, so the enforce-flip audit must not treat the warn
 * sample as exhaustive for flooded keys. The throttle never touches the
 * enforce decision (the middleware throws after the sink returns, regardless
 * of admission). Injectable for deterministic tests; the exported default
 * binds a process-wide instance on the real clock.
 */
export function createCrossSiteMismatchSink(
  throttle: MismatchWarnThrottle = createMismatchWarnThrottle(),
): CrossSiteMismatchSink {
  return (mismatch) => {
    const admission = throttle.admit(`${mismatch.method} ${mismatch.route}`);
    if (!admission.emit) return;
    logger.warn(
      { ...mismatch, ...(admission.suppressed > 0 ? { suppressed: admission.suppressed } : {}) },
      'cross-site origin on mutating /api request',
    );
  };
}

/** The default flood-bounded sink instance the check uses when none is injected. */
export const defaultCrossSiteMismatchSink: CrossSiteMismatchSink = createCrossSiteMismatchSink();

/**
 * The default allowlist arm: an Origin is allowed when it is in the CORS
 * reflection allowlist (realm vhosts + native Capacitor + Electron desktop),
 * delegated to allowedCorsOrigin so this gate and withCors share ONE allowlist
 * and same-origin allowlist drift is impossible. Mirrors cors.ts's defaultApiAllow.
 *
 * DELIBERATE DIVERGENCE from web_login_guard.isWebClientRequest: the WEB_ORIGINS
 * env allowlist and the localhost-any-port dev regex it accepts are NOT allowed
 * here, so their traffic shows up in the log-only audit records instead of being
 * silently skipped. Before flipping API_ORIGIN_CHECK_ENFORCE=1, the audit must
 * either add those origins to the allowlist or accept that they will 403 (an
 * operator adding to WEB_ORIGINS alone does NOT widen this gate).
 */
function defaultAllowOrigin(origin: string): boolean {
  return allowedCorsOrigin(origin) !== null;
}

/**
 * True when `origin`'s host equals the request's own host, mirroring the
 * same-origin arm of isWebClientRequest (server/web_login_guard.ts): parse the
 * Origin's host, then compare it against the first X-Forwarded-Host value and the
 * Host header. isWebClientRequest FUSES this host-equality with its allowlist
 * check, so there is no reusable export to import; this mirrors only its
 * host-equality idiom (the allowlist arm is covered separately by allowOrigin).
 * An unparseable Origin (including the literal 'null') has no host and so is not
 * same-origin.
 */
function isSameOriginHost(origin: string, req: http.IncomingMessage): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === '') return false;
  const fwd = String(req.headers['x-forwarded-host'] ?? '')
    .split(',')[0]
    .trim();
  const reqHost = String(req.headers.host ?? '');
  return host === fwd || host === reqHost;
}

/** Read a request header as a single string (the first value of a repeated header). */
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Build the cross-site Origin-check middleware for `route`. Carve-outs, WHY each:
 *  - Non-'api' surface: pass through. The packet scopes the check to /api; the
 *    oauth consent POSTs and admin have their own auth models.
 *  - Non-mutating method: pass through. GET/HEAD/OPTIONS are safe and never gated.
 *  - Absent or empty Origin: pass through silently, in BOTH modes. Load-bearing:
 *    the surface is bearer-only with no cookies (CSRF risk minimal), and beacons
 *    plus native clients that send no Origin MUST keep working.
 *  - Present Origin that is same-origin OR allowlisted: pass through.
 *  - A clear cross-site Origin (present, not same-origin, not allowlisted; an
 *    unparseable Origin and the literal 'null' count as cross-site): record it via
 *    the sink. Log-only (default): pass through. Enforce: throw 'origin.cross_site'
 *    BEFORE next().
 * The enforce flag is read PER REQUEST so a live flip (or a test's opts.env) takes
 * effect without rebuilding the onion. Sec-Fetch-Site is recorded as audit context
 * only: a legitimate allowlisted realm origin is cross-site by its definition, so
 * gating on it would reject valid cross-realm traffic.
 */
export function withOriginCheck(
  route: RouteDef,
  opts: {
    env?: NodeJS.ProcessEnv;
    sink?: CrossSiteMismatchSink;
    allowOrigin?: (origin: string) => boolean;
  } = {},
): Middleware {
  const sink = opts.sink ?? defaultCrossSiteMismatchSink;
  const allowOrigin = opts.allowOrigin ?? defaultAllowOrigin;
  return async (ctx: Ctx, next: Next): Promise<void> => {
    if (route.surface !== 'api') return next();
    if (!MUTATING_METHODS.has(ctx.method)) return next();
    const origin = ctx.req.headers.origin;
    if (typeof origin !== 'string' || origin === '') return next();
    if (isSameOriginHost(origin, ctx.req) || allowOrigin(origin)) return next();

    const enforced = originCheckEnforced(opts.env);
    sink({
      route: route.path,
      method: ctx.method,
      origin,
      secFetchSite: headerValue(ctx.req.headers['sec-fetch-site']),
      enforced,
    });
    if (enforced) throw new HttpError(403, 'origin.cross_site');
    return next();
  };
}
