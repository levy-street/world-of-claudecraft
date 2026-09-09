// Demand-driven, HOURS-KEYED TTL memo over admin_db.clientPerfSummary, the last
// member of the admin analytics read family that was still an uncached
// per-request database aggregate.
//
// WHAT IT COSTS UNCACHED. clientPerfSummary runs THREE raised-timeout
// statements per call (two GROUPING SETS aggregates over client_perf_reports
// plus the suggestion-id unnest), and both dispatch arms of
// /admin/api/perf/summary call it on every request with no memo at all: an
// operator tab left open on the Performance page, or a second tab, pays the
// full three-statement cost again for a window that cannot have moved.
//
// KEYED, NOT SINGLE-KEY, and bounded by construction. The response varies with
// `?hours`, but only over the whole-hour range cleanHours already clamps it
// to ([1, 168]; server/client_perf_summary_shape.ts), so a KeyedCachedRead
// capped at exactly that many entries is not an approximation of the key
// space, it IS the key space: no caller-minted entropy (a fractional or
// out-of-range hours value) can reach the map, since callers key on the
// CLEANED hours, never the raw query param.
//
// MODERATION-INVARIANT, so NO BUST WIRE IS OWED (mirrors
// admin_online_history_cache.ts's reasoning). client_perf_reports is
// append-only client telemetry (server/db.ts insertClientPerfReport) pruned
// only by the retention sweep; no moderation action (ban, suspend, mute,
// jail, rename, account or character delete) reads or writes it, so there is
// nothing an operator can do that makes an installed snapshot wrong. Its only
// staleness is the passage of time, which the TTL below bounds.
//
// The single-flight, stale-on-error and entry-bound semantics all come from
// the shared primitive (server/cached_read.ts); this module only wires it to
// the one query, in the shape server/admin_online_history_cache.ts
// established for the dual-arm analytics memos.

import { clientPerfSummary, type PerfSummary } from './admin_db';
import { deepFreezeSnapshot, KeyedCachedRead } from './cached_read';
import { cleanHours } from './client_perf_summary_shape';

/**
 * How long one hours-window snapshot is served before the next re-query.
 *
 * Adopted from the sibling analytics memos (ADMIN_OVERVIEW_TTL_MS,
 * ADMIN_ONLINE_HISTORY_TTL_MS) rather than re-derived: this reads the same
 * client_perf_reports rows on the same admin Performance page, and a minute
 * of staleness cannot move a percentile computed over up to a week of samples.
 */
export const ADMIN_PERF_SUMMARY_TTL_MS = 60_000;

/**
 * The entry bound: exactly the width of cleanHours' clamped range, so the map
 * can never hold an entry for anything else and eviction can never happen in
 * normal use.
 */
export const ADMIN_PERF_SUMMARY_MAX_ENTRIES = 168;

// The refresh + clock the singleton is built with. Production never touches
// these (the real clientPerfSummary and Date.now); tests inject fakes below.
let queryFn: (hours: number) => Promise<PerfSummary> = clientPerfSummary;
let nowFn: (() => number) | undefined;

// Built LAZILY on first read so a test seam installed before first use takes
// effect, and so importing this module under a mocked admin_db never touches
// the real query.
let cache: KeyedCachedRead<PerfSummary, number> | null = null;

/**
 * The cached summary for one hours window: at most one clientPerfSummary
 * refresh per window per TTL, shared by BOTH /admin/api/perf/summary
 * dispatch arms. Takes the RAW hours input and cleans it here, so every
 * caller keys the cache the same way the query itself would have resolved it.
 */
export function readClientPerfSummaryCached(hoursInput: number): Promise<PerfSummary> {
  cache ??= new KeyedCachedRead<PerfSummary, number>(
    // One snapshot object is served by reference to every reader in a TTL
    // window, and its bucket arrays are nested, so freeze it WHOLE: a
    // shallow freeze would leave the rows a consumer could poison for
    // everyone.
    async (hours) => deepFreezeSnapshot(await queryFn(hours)),
    {
      ttlMs: ADMIN_PERF_SUMMARY_TTL_MS,
      maxEntries: ADMIN_PERF_SUMMARY_MAX_ENTRIES,
      now: nowFn,
    },
  );
  return cache.read(cleanHours(hoursInput));
}

/**
 * Inject a fake query and/or clock into the singleton (test-only). Drops the
 * current cache instance so the next read is cold under the injected fakes.
 */
export function setPerfSummaryCacheForTests(opts: {
  query?: (hours: number) => Promise<PerfSummary>;
  now?: () => number;
}): void {
  if (opts.query) queryFn = opts.query;
  if (opts.now) nowFn = opts.now;
  cache = null;
}

/**
 * Restore the real clientPerfSummary + Date.now and drop the cache instance
 * so the next read is cold (test-only).
 */
export function resetPerfSummaryCacheForTests(): void {
  queryFn = clientPerfSummary;
  nowFn = undefined;
  cache = null;
}
