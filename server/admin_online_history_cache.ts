// Demand-driven, RANGE-KEYED TTL memo over admin_db.onlineHistory, the last
// member of the admin analytics read family that was still an uncached
// per-request database aggregate.
//
// WHAT IT COST BEFORE. `onlineHistory` is two `date_trunc` GROUP BY aggregates
// over admin_online_samples and admin_site_presence_samples, FULL OUTER JOINed,
// scanning up to 30 days of samples. The Overview page fetched it from the same
// `Promise.all` as /admin/api/activity (src/admin/pages/Overview.svelte
// refreshActivity), so every operator tab ran it cold once a minute, and a
// range button ran it again on click, on BOTH dispatch arms. Its sibling in
// that very Promise.all has been metered and cached since the analytics family
// landed; this one was simply missed.
//
// KEYED, NOT SINGLE-KEY, and bounded by construction. The response varies with
// `?range`, but only over the three values the query itself admits, so a
// `KeyedCachedRead` capped at exactly that many entries is not an approximation
// of the key space, it IS the key space. Callers key on the CLEANED range
// (never the raw query string), so no caller-minted entropy can reach the map:
// an attacker cannot evict a hot entry by inventing keys, which is the failure
// mode the marketplace browse cache had to fence out by hand.
//
// WHY THE CLEANER IS RESTATED HERE instead of imported from admin_db, which
// owns the query's own copy. This module must import NOTHING from admin_db but
// `onlineHistory` itself: several legacy suites stand up admin_db behind a
// whole-module `vi.mock` factory that lists only the members they drive, so any
// fresh production import from it fails those suites at module load with a
// missing-export error rather than anywhere near the change. The duplication
// that buys is not left on trust: `cacheKeyForRange` and admin_db's
// `cleanOnlineHistoryRange` are asserted to agree over a corpus of real,
// junk, empty and case-variant inputs in tests/server/admin_analytics_reads.ts,
// so a drift in either one reds instead of quietly serving one range's numbers
// under another range's key.
//
// MODERATION-INVARIANT, so NO BUST WIRE IS OWED, and the Hot paths rule in
// server/CLAUDE.md asks for that decision to be recorded where it is made
// rather than left as an omission a reviewer has to re-derive. Both source
// tables are append-only telemetry written by the online sampler: rows carry a
// realm, a timestamp, and counts, and no account, character, or guild identity.
// No moderation action (ban, suspend, mute, jail, rename, account or character
// delete) reads or writes either table, so there is nothing an operator can do
// that makes an installed snapshot wrong. Its only staleness is the passage of
// time, which the TTL below bounds. Contrast the overview memo, whose counts DO
// move under moderation and which is therefore short-TTL by the same rule.
//
// The single-flight, stale-on-error and entry-bound semantics all come from the
// shared primitive (server/cached_read.ts); this module only wires it to the
// one query, in the shape server/admin_overview_cache.ts established for the
// dual-arm analytics memos.

import { type OnlineHistory, type OnlineHistoryRange, onlineHistory } from './admin_db';
import { deepFreezeSnapshot, KeyedCachedRead } from './cached_read';

/** The whole key space: every range the underlying query admits. */
export const ONLINE_HISTORY_CACHE_RANGES: readonly OnlineHistoryRange[] = ['24h', '7d', '30d'];

/** What an unrecognized range folds onto, matching the query's own default. */
const DEFAULT_ONLINE_HISTORY_RANGE: OnlineHistoryRange = '30d';

/**
 * The cache key for a raw query-string value: one of the three ranges, always.
 * Exported so the paired test can assert it agrees with admin_db's
 * `cleanOnlineHistoryRange` (see the header on why there are two).
 */
export function cacheKeyForRange(rangeInput: string): OnlineHistoryRange {
  return (ONLINE_HISTORY_CACHE_RANGES as readonly string[]).includes(rangeInput)
    ? (rangeInput as OnlineHistoryRange)
    : DEFAULT_ONLINE_HISTORY_RANGE;
}

/**
 * How long one range's snapshot is served before the next re-query.
 *
 * The sibling analytics memos' value (ADMIN_OVERVIEW_TTL_MS,
 * ADMIN_ACTIVITY_TTL_MS), adopted rather than re-derived because the same
 * argument applies with more room to spare: this readout is fetched on the
 * SAME 60 s poll as activity, and its finest bucket is a whole HOUR, so a
 * minute of staleness cannot move a rendered bar. The practical effect is one
 * database aggregate per range per minute for the whole realm process, however
 * many operators and tabs are watching.
 */
export const ADMIN_ONLINE_HISTORY_TTL_MS = 60_000;

/**
 * The entry bound: exactly the number of ranges the cleaner admits, so the map
 * can never hold an entry for anything else and eviction can never happen in
 * normal use. Derived from the range list rather than typed as a literal, so
 * adding a fourth range widens the cache in the same change.
 */
export const ADMIN_ONLINE_HISTORY_MAX_ENTRIES = ONLINE_HISTORY_CACHE_RANGES.length;

// The refresh + clock the singleton is built with. Production never touches
// these (the real onlineHistory and Date.now); tests inject fakes below.
let queryFn: (range: string) => Promise<OnlineHistory> = onlineHistory;
let nowFn: (() => number) | undefined;

// Built LAZILY on first read so a test seam installed before first use takes
// effect, and so importing this module under a mocked admin_db never touches
// the real query.
let cache: KeyedCachedRead<OnlineHistory, string> | null = null;

/**
 * The cached history for one range: at most one `onlineHistory` refresh per
 * range per TTL window, shared by BOTH /admin/api/online-history dispatch arms.
 * Takes the RAW query-string value and cleans it here, so every caller keys the
 * cache the same way the query itself would have resolved it.
 */
export function readOnlineHistoryCached(rangeInput: string): Promise<OnlineHistory> {
  cache ??= new KeyedCachedRead<OnlineHistory, string>(
    // One snapshot object is served by reference to every reader in a TTL
    // window, and its points array is nested, so freeze it WHOLE: a shallow
    // freeze would leave the rows a consumer could poison for everyone.
    async (range) => deepFreezeSnapshot(await queryFn(range)),
    {
      ttlMs: ADMIN_ONLINE_HISTORY_TTL_MS,
      maxEntries: ADMIN_ONLINE_HISTORY_MAX_ENTRIES,
      now: nowFn,
    },
  );
  return cache.read(cacheKeyForRange(rangeInput));
}

// NO stats() re-export here on purpose. KeyedCachedRead carries the usual
// reads/refreshes/evictions counters, but the read-cache counter family is
// published from the internal readout in server/main.ts, and an exported
// readout nothing calls is the dead surface this same QA round deleted
// elsewhere. Wiring it up is one line there against `cache?.stats()`.

/**
 * Inject a fake query and/or clock into the singleton (test-only). Drops the
 * current cache instance so the next read is cold under the injected fakes.
 */
export function setOnlineHistoryCacheForTests(opts: {
  query?: (range: string) => Promise<OnlineHistory>;
  now?: () => number;
}): void {
  if (opts.query) queryFn = opts.query;
  if (opts.now) nowFn = opts.now;
  cache = null;
}

/**
 * Restore the real onlineHistory + Date.now and drop the cache instance so the
 * next read is cold (test-only).
 */
export function resetOnlineHistoryCacheForTests(): void {
  queryFn = onlineHistory;
  nowFn = undefined;
  cache = null;
}
