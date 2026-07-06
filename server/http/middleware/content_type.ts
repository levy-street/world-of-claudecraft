// Content-Type 415 gate for the API request pipeline onion.
//
// A mutating /api request whose body is not application/json is a wrong-media-type
// request. This middleware records every such mismatch and, ONLY when the named
// enforce flag is set, rejects it with a 415 problem+json (RFC 9457). It ships
// LOG-ONLY by default: a native-traffic audit flips API_CONTENT_TYPE_ENFORCE=1
// once the mismatch log confirms no legitimate client is affected.
//
// The gate reads the MATCHED RouteDef's declared metadata (surface, requestBody,
// envelope), never a hardcoded path list, so a route opts out by DECLARING its
// contract. It runs only inside the new-dispatcher onion for a MATCHED route: a
// delegate-served path (no RouteDef) never reaches it, so enforcement only ever
// covers the registered surface (the documented carve-out).
//
// Audited ground truth: the perf-report and site-presence beacons SEND
// application/json, so they are correctly gated-but-passing, not exempted.
//
// Server-side, language-agnostic: the mismatch line is dev-channel English,
// emitted through the structured logger.

import { HttpError } from '../errors';
import { logger } from '../logger';
import { createMismatchWarnThrottle, type MismatchWarnThrottle } from '../mismatch_warn_throttle';
import type { Ctx, Method, Middleware, Next, RouteDef } from '../types';

/** The named ops flag that flips the gate from log-only to 415 enforcement. */
export const CONTENT_TYPE_ENFORCE_ENV = 'API_CONTENT_TYPE_ENFORCE';

/** The one request media type a JSON /api route accepts (parsed, lowercased). */
const APPLICATION_JSON = 'application/json';

/**
 * The methods that carry a request-body contract. A GET/HEAD/OPTIONS request has
 * no body to type, so the gate never touches one. Exported as the ONE mutating-set
 * source of truth: the sibling origin_check gate keys on this same set, so the two
 * gates cannot silently diverge on which methods they cover.
 */
export const MUTATING_METHODS: ReadonlySet<Method> = new Set<Method>([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/**
 * Whether the gate enforces (throws 415) or only logs. True ONLY for '1' or
 * 'true' (case-insensitive); absent, '0', 'false', or anything else is LOG-ONLY.
 * Mirrors the repo's named-flag parse idiom (server/web_login_guard.ts).
 */
export function contentTypeEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env[CONTENT_TYPE_ENFORCE_ENV] ?? '').toLowerCase();
  return v === '1' || v === 'true';
}

/** One recorded Content-Type mismatch: the route TEMPLATE, method, parsed type, and mode. */
export interface ContentTypeMismatch {
  /** The route TEMPLATE path (RouteDef.path), never the concrete URL: cardinality. */
  readonly route: string;
  readonly method: string;
  /** The parsed media type (everything before the first ';', trimmed, lowercased). */
  readonly contentType: string;
  /** True when the gate is in enforce mode (this request is being rejected 415). */
  readonly enforced: boolean;
}

/** Receives every mismatch; the default emits one structured logger.warn line. */
export type ContentTypeMismatchSink = (mismatch: ContentTypeMismatch) => void;

/**
 * Build the default sink: one structured dev-channel line per ADMITTED mismatch,
 * through the structured logger. The throttle bounds warn volume per
 * (method, route-template) window because this gate runs AHEAD of the
 * route-local rate limiters, so a crafted wrong-Content-Type flood must not
 * amplify log volume one line per request; the first line of each new window
 * carries the prior window's suppressed count so a flood stays visible. The
 * throttle never touches the enforce decision (the middleware throws after the
 * sink returns, regardless of admission). Injectable for deterministic tests;
 * the exported default binds a process-wide instance on the real clock.
 */
export function createContentTypeMismatchSink(
  throttle: MismatchWarnThrottle = createMismatchWarnThrottle(),
): ContentTypeMismatchSink {
  return (mismatch) => {
    const admission = throttle.admit(`${mismatch.method} ${mismatch.route}`);
    if (!admission.emit) return;
    logger.warn(
      {
        route: mismatch.route,
        method: mismatch.method,
        contentType: mismatch.contentType,
        enforced: mismatch.enforced,
        ...(admission.suppressed > 0 ? { suppressed: admission.suppressed } : {}),
      },
      'content-type mismatch',
    );
  };
}

/** The default flood-bounded sink instance the gate uses when none is injected. */
export const defaultContentTypeMismatchSink: ContentTypeMismatchSink =
  createContentTypeMismatchSink();

/**
 * Whether the route DECLARES a non-JSON request-body contract the JSON gate must
 * skip: the binary card upload (meta.requestBody 'binary'), or the defensive
 * binary/html/redirect response envelopes (no live mutating /api route carries
 * these today). Read from matched-RouteDef metadata, never a path list.
 */
function isBodyExempt(route: RouteDef): boolean {
  if (route.meta?.requestBody === 'binary') return true;
  const envelope = route.meta?.envelope;
  return envelope === 'binary' || envelope === 'html' || envelope === 'redirect';
}

/**
 * Build the Content-Type gate for a MATCHED route. Log-only by default; enforce
 * only when contentTypeEnforced(env) is true. The env flag is read PER REQUEST
 * (inside the middleware body) so an ops flip needs no reboot and a test can pass
 * env via opts. A mismatch is always recorded to the sink; only enforce mode
 * throws.
 */
export function withContentType(
  route: RouteDef,
  opts: { env?: NodeJS.ProcessEnv; sink?: ContentTypeMismatchSink } = {},
): Middleware {
  const sink = opts.sink ?? defaultContentTypeMismatchSink;
  return (ctx: Ctx, next: Next): Promise<void> => {
    // Non-'api' surface: the /oauth token endpoints legitimately accept form
    // encodings (RFC 6749); admin/internal are outside this packet's /api scope.
    if (route.surface !== 'api') return next();
    // No body contract on a non-mutating method (a GET carries no request body).
    if (!MUTATING_METHODS.has(ctx.method)) return next();
    // Exempt by DECLARED classification (no gating AND no sink record either mode).
    if (isBodyExempt(route)) return next();
    // Absent or empty Content-Type: the surface is bearer-only with no cookies, so
    // beacons and native clients that omit the header must keep working. Enforce
    // mode only ever rejects a PRESENT wrong type.
    const raw = ctx.req.headers['content-type'];
    if (typeof raw !== 'string' || raw.trim() === '') return next();
    // Parse the media type: everything before the first ';', trimmed, lowercased.
    // 'application/json' with or without parameters, any case, passes.
    const mediaType = raw.split(';')[0].trim().toLowerCase();
    if (mediaType === APPLICATION_JSON) return next();
    // Mismatch. Read the enforce flag PER REQUEST, then record it with the route
    // TEMPLATE path (not the concrete URL: cardinality).
    const enforced = contentTypeEnforced(opts.env);
    sink({ route: route.path, method: ctx.method, contentType: mediaType, enforced });
    if (enforced) {
      // Throw BEFORE next() so withErrors serializes the problem+json 415.
      throw new HttpError(415, 'body.unsupported_media_type');
    }
    return next();
  };
}
