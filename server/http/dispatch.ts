// The dispatcher-in-front for the API request pipeline.
//
// It places the in-house pipeline ahead of the legacy /api handleApi ladder
// via a per-path CATCH-ALL DELEGATE: for a path the registry OWNS (a matched
// RouteDef) it runs the middleware onion under runOnion (the exactly-one-response
// wrapper); for ANY OTHER /api path (and for HEAD, see below) it calls the
// injected legacy handleApi delegate UNCHANGED. The registry owns the migrated
// per-domain route tables, and a migrated route stays byte-for-byte identical
// old-vs-new; the parity harness (tests/server/http/parity.test.ts) proves it.
//
// The returned dispatcher matches the legacy handleApi call shape (a
// fire-and-forget (req, res) => void): runOnion owns the single response, so the
// dispatcher never awaits-and-responds a second time. CORS and the OPTIONS-204
// preflight stay in main.ts's single top-level wrapper (applied before this
// runs and shared with the legacy ladder), so this onion intentionally does NOT
// mount withCors: keeping CORS in one place is what makes it identical on the
// delegated and the onion paths.

import type * as http from 'node:http';
import { runOnion } from './compose';
import type { DispatchMode } from './config';
import { buildContext, newReqId, runWithReqId } from './context';
import { logger } from './logger';
import { withContentType } from './middleware/content_type';
import { type MetricSink, noopMetricSink, withMetrics } from './middleware/metric_sink';
import { withOriginCheck } from './middleware/origin_check';
import { withErrors } from './middleware/with_errors';
import type { ApiRegistry } from './registry';
import type { Ctx, Middleware, RouteDef } from './types';

/** The legacy delegate: today's handleApi, invoked UNCHANGED for un-migrated /api paths. */
export type ApiDelegate = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void | Promise<void>;

/** The dispatcher call shape: fire-and-forget, mirroring the legacy handleApi call site. */
export type ApiDispatcher = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/**
 * Invoke the legacy delegate under a FRESH ambient reqId scope. The onion path
 * gets its scope from runOnion; the delegate paths (unowned paths, HEAD, and the
 * 'legacy' entry) would otherwise run outside any runWithReqId, so a swept
 * logger line inside a legacy handler would carry no reqId. The binding is
 * observability-only: it never touches req/res, so the delegate's response
 * bytes (and the parity harness) are unaffected.
 */
function delegateWithReqId(
  delegate: ApiDelegate,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  runWithReqId(newReqId(), () => void delegate(req, res));
}

/** Everything the dispatcher needs, injected so it stays pure and unit-testable. */
export interface ApiDispatcherDeps {
  /** The assembled route registry (the migrated per-domain route tables). */
  readonly registry: ApiRegistry;
  /** The legacy /api handleApi, called UNCHANGED for every path the registry does not own. */
  readonly delegate: ApiDelegate;
  /**
   * Where per-request metric events go; defaults to the no-op sink (main.ts
   * injects the real access-log + metrics sink at boot).
   */
  readonly metricSink?: MetricSink;
}

/**
 * Build the dispatcher-in-front. For a matched RouteDef it runs the onion under
 * runOnion (the single response authority); for every other /api path it
 * delegates to the legacy handleApi with the request untouched.
 */
export function createApiDispatcher(deps: ApiDispatcherDeps): ApiDispatcher {
  const metricSink = deps.metricSink ?? noopMetricSink;
  return (req, res) => {
    const method = req.method ?? '';
    const path = (req.url ?? '').split('?')[0];
    const match = deps.registry.resolve(method, path);
    if (match.kind !== 'matched') {
      // A path the registry does not own: delegate to the legacy ladder
      // UNCHANGED. The delegate owns its own response; we never touch req/res
      // (the reqId wrapper only binds ambient logging context).
      delegateWithReqId(deps.delegate, req, res);
      return;
    }
    if (match.head) {
      // A HEAD request resolves to a matched GET route (the table router
      // synthesizes HEAD from GET, head:true). The legacy ladder answers HEAD with
      // a 404 (every === arm gates on GET), so while the legacy arms are retained
      // (until the ladder-deletion PR) a HEAD match delegates too, keeping the
      // migration byte-identical old-vs-new: both arms run the same code either
      // way. Serving HEAD as GET is a deliberate behavior change deferred to the
      // ladder deletion (next release).
      delegateWithReqId(deps.delegate, req, res);
      return;
    }
    // A registry-owned route: run the middleware onion. runOnion guarantees exactly
    // one idempotent response on both the resolve and the throw path, so we
    // fire-and-forget its promise, matching the legacy void call site.
    const route = match.route;
    const ctx = buildContext(req, res, match);
    const stack: Middleware[] = [
      // Outermost: the sole response authority. On a throw it maps the error to
      // the route's surface envelope (RFC 9457 for /api) via mapError and writes
      // exactly once; a handler that already responded is left untouched. An
      // UNEXPECTED (mapped-to-500) throwable routes the ORIGINAL error to the
      // structured logger here, at the construction site: errors.ts must not import
      // the logger (it sits under the logger's own import chain via context.ts), so
      // the logger-backed sink is injected rather than defaulted inside errors.ts.
      withErrors({
        surface: route.meta?.envelope,
        onUnexpected: (err) => logger.error({ err }, 'unhandled request error'),
      }),
      // The metric observation point (the :param TEMPLATE, never the concrete
      // path, to bound sink cardinality). main.ts injects the real access-log
      // sink here, so every onion-served request emits one structured access line.
      withMetrics(metricSink, route.path),
      // The Content-Type + Origin hardening gates, global frames ahead of the route-local
      // middleware so an (enforce-mode) reject is cheap and still serializes
      // through withErrors. Both self-scope to the 'api' surface and mutating
      // methods, and both ship LOG-ONLY behind their named enforce flags, so
      // today they pass every request through and only record mismatches. They
      // exist only on this matched-route onion: a delegate-served path never
      // sees them (the registered-surface carve-out).
      withOriginCheck(route),
      withContentType(route),
      // NOTE: withRequestId (the X-Request-Id echo, now built in
      // middleware/request_id.ts) is intentionally NOT mounted here yet. runOnion
      // already binds ctx.reqId in AsyncLocalStorage for the whole run, so the ALS
      // rebind would be redundant, AND mounting the header echo now would add an
      // X-Request-Id response header to every migrated-route 2xx/429/404 response
      // where the retained legacy delegate emits none, breaking the parity harness
      // (tests/server/http/parity.test.ts) across the whole corpus. Turning the echo
      // on is a corpus-wide parity decision deferred to the ladder deletion, next
      // release (normalize X-Request-Id out of the shared parity normalizer,
      // or register it corpus-wide). withErrors still emits X-Request-Id on the
      // error path, which the existing per-domain deviations already cover.
      // Route-local middleware (per-route rate limits, withBody, requireAccount)
      // composed after the global frames, exactly as each RouteDef declares them.
      ...(route.middleware ?? []),
      // The handler. runHandler discards its return value: a handler writes its
      // own response via json(ctx.res, ...) (see leaderboard.ts).
      runHandler(route),
    ];
    void runOnion(ctx, stack);
  };
}

/** Wrap a RouteHandler as the terminal onion middleware (it ignores next: it is last). */
function runHandler(route: RouteDef): Middleware {
  return async (ctx: Ctx) => {
    await route.handler(ctx);
  };
}

/**
 * Pick the /api entry for the current dispatch mode. When 'new', the in-house
 * dispatcher fronts the legacy ladder; when 'legacy', the legacy handleApi runs
 * directly, an inert rollback in which the new pipeline is never entered. main.ts
 * reads the mode from loadConfig once at boot; the production default is 'new'
 * (API_DISPATCH=legacy is the one-flag rollback).
 */
export function selectApiEntry(
  mode: DispatchMode,
  newDispatcher: ApiDispatcher,
  legacy: ApiDelegate,
): ApiDispatcher {
  return mode === 'new' ? newDispatcher : (req, res) => delegateWithReqId(legacy, req, res);
}
