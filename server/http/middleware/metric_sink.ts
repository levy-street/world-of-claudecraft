// A pluggable per-request metric sink placed directly INSIDE withErrors, so it
// always observes the FINAL status: the status
// code on the resolve path, or the status toAppError would map a thrown error
// to on the throw path. withErrors does not rethrow, so this middleware's own
// next() still rejects on a throw (withErrors catches ABOVE it); toAppError is
// a pure read with no side effects, so rerunning it here never double-fires
// opts.onUnexpected (that stays exactly-once, inside mapError).

import { toAppError } from '../errors';
import type { Ctx, Middleware, Next } from '../types';

/** One recorded request. `route` is the :param TEMPLATE, never a concrete path. */
export interface MetricEvent {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  /**
   * The resolved client IP (X-Forwarded-For aware; from ctx.ip). Optional and
   * ADDITIVE (for the access log): pre-existing sinks that never read it
   * are unaffected.
   */
  ip?: string;
}

/** A pluggable sink for MetricEvent records. */
export interface MetricSink {
  record(event: MetricEvent): void;
}

/** A sink that discards every event; the default until a real one is wired. */
export const noopMetricSink: MetricSink = {
  record() {},
};

/**
 * Fan one event out to every sink (the access-log sink and the
 * Prometheus sink share one recording point). Each record() is wrapped so a
 * throwing sink neither stops the remaining sinks nor propagates out into the
 * request's finally block; a sink is expected to already swallow its own errors,
 * so this is a belt-and-suspenders guard, not a substitute for that.
 */
export function teeMetricSink(...sinks: MetricSink[]): MetricSink {
  return {
    record(event: MetricEvent): void {
      for (const sink of sinks) {
        try {
          sink.record(event);
        } catch {
          // One sink failing must never break the others or the request path.
        }
      }
    },
  };
}

/**
 * Record one MetricEvent per request against `sink`. `route` is the :param
 * TEMPLATE for the matched route (e.g. '/api/characters/:id'), NEVER the
 * concrete request path (a concrete path would blow up sink cardinality); the
 * caller supplies it per route. `now` is an injectable clock for deterministic
 * duration assertions in tests; defaults to Date.now.
 */
export function withMetrics(
  sink: MetricSink,
  route: string,
  now: () => number = Date.now,
): Middleware {
  return async (ctx: Ctx, next: Next) => {
    const started = now();
    let status = 0;
    try {
      await next();
      status = ctx.res.statusCode;
    } catch (err) {
      status = toAppError(err).status;
      throw err;
    } finally {
      sink.record({ route, method: ctx.method, status, durationMs: now() - started, ip: ctx.ip });
    }
  };
}
