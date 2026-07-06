// The attack-signal counter seam: the four source-spec 4.9 RED security series
// (rate-limit 429s, auth failures, BOLA denials, tier-2 pg limiter writes) reach
// the /metrics exporter through this one process-wide slot instead of each
// emission site threading a sink through its constructors. main.ts sets the real
// implementation (createHttpMetrics().attackSignals, so all four dispatch entries
// share the exporter's one registry) once at boot, exactly like
// setRateLimitTier2Store; before that, and in any test that never wires one, the
// slot holds the no-op and every emission is dropped.
//
// CARDINALITY IS BOUNDED BY DESIGN, same contract as server/http/metrics.ts:
// every label value comes from a small fixed set (policy names, the two key
// kinds, the two auth-failure kinds, registry route TEMPLATES). Nothing
// request-derived (ip, account id, token, concrete resource id, concrete path)
// may ever be passed as a label value; an emission site that needs a route label
// passes ctx.route (the :param template), never ctx.path.

/** The two rate-limit key derivations a policy can use (RateLimitKeyClass). */
export type AttackSignalKeyKind = 'ip' | 'ip+account';

/** The bounded auth-failure kinds: a bad credential, or a lockout rejection. */
export type AuthFailureKind = 'bad_credentials' | 'throttled';

/**
 * The four attack-signal emission hooks. Implementations must never throw: an
 * observability write can never be allowed to break the request path it measures.
 */
export interface AttackSignalSink {
  /** One rate-limited (429) request under `policy`, either tier. */
  rateLimitHit(policy: string, keyKind: AttackSignalKeyKind): void;
  /** One authentication failure of the given kind. */
  authFailure(kind: AuthFailureKind): void;
  /** One BOLA (requireOwned) denial on `route` (the :param TEMPLATE). */
  bolaDenied(route: string): void;
  /** One tier-2 (pg) limiter upsert write under `policy`. */
  pgLimiterWrite(policy: string): void;
}

/** A sink that drops every signal; the slot default until boot wires the real one. */
export const noopAttackSignalSink: AttackSignalSink = {
  rateLimitHit() {},
  authFailure() {},
  bolaDenied() {},
  pgLimiterWrite() {},
};

let activeSink: AttackSignalSink = noopAttackSignalSink;

/**
 * Install the process-wide attack-signal sink. Called once at boot with the
 * exporter-backed implementation; tests install a recording fake and restore
 * noopAttackSignalSink when done.
 */
export function setAttackSignalSink(sink: AttackSignalSink): void {
  activeSink = sink;
}

/** The current attack-signal sink. Read at emission time, never captured at import. */
export function attackSignalSink(): AttackSignalSink {
  return activeSink;
}
