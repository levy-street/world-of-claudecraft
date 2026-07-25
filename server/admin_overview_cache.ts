// Demand-driven TTL memo over admin_db.overviewCounts. The admin Overview page
// polls every 5 seconds and each request used to re-run that heavy aggregate
// (six play_sessions scans) cold; this memo bounds it to one refresh per TTL
// window, shared by BOTH /admin/api/overview dispatch arms. Only the DB counts
// are cached: the live game.adminStats() merge in the handlers stays
// per-request and uncached. No timer of any kind: an idle dashboard costs
// nothing, and the first request past the TTL pays the one refresh.
//
// The single-flight, stale-serve, and bust semantics come from the cached_read
// primitive (server/cached_read.ts, pinned by tests/server/cached_read.test.ts);
// this module only wires it to the overview query at a fixed TTL.
//
// cached_read's stale-serve warning logs the refresh error RAW, so the refresh
// must never embed secrets or player-private material in what it throws (the
// real overviewCounts throws only driver errors from one parameterized query).

import { type OverviewCounts, overviewCounts } from './admin_db';
import { type CachedRead, createCachedRead } from './cached_read';

/** How long one overviewCounts snapshot is served before the next re-query. */
export const ADMIN_OVERVIEW_TTL_MS = 60_000;

// The refresh + clock the singleton is built with. Production never touches
// these (the real overviewCounts and Date.now); tests inject fakes below.
let queryFn: () => Promise<OverviewCounts> = overviewCounts;
let nowFn: (() => number) | undefined;

// The module-level singleton, built LAZILY on first read so a test seam
// installed before first use takes effect (and so importing this module under
// a mocked admin_db never touches the real query).
let cache: CachedRead<OverviewCounts> | null = null;

/** The cached overview counts: at most one overviewCounts refresh per TTL window. */
export function readOverviewCounts(): Promise<OverviewCounts> {
  // One snapshot object is served by reference to every reader in a TTL
  // window; freeze it so no consumer can poison the shared counts.
  cache ??= createCachedRead(async () => Object.freeze(await queryFn()), {
    ttlMs: ADMIN_OVERVIEW_TTL_MS,
    now: nowFn,
  });
  return cache.read();
}

/**
 * Inject a fake query and/or clock into the singleton (test-only). Drops the
 * current cache instance so the next read is cold under the injected fakes.
 */
export function setOverviewCacheForTests(opts: {
  query?: () => Promise<OverviewCounts>;
  now?: () => number;
}): void {
  if (opts.query) queryFn = opts.query;
  if (opts.now) nowFn = opts.now;
  cache = null;
}

/**
 * Restore the real overviewCounts + Date.now and drop the cache instance so
 * the next read is cold (test-only).
 */
export function resetOverviewCacheForTests(): void {
  queryFn = overviewCounts;
  nowFn = undefined;
  cache = null;
}
