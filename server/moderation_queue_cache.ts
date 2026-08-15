// Demand-driven TTL memo over moderation_db.moderationQueue's expensive part:
// the player_reports/accounts aggregate scan. Every previous caller re-ran that
// GROUP BY on every request, unlike the sibling overviewCounts aggregate on the
// same dashboard (admin_overview_cache.ts). This memo bounds the scan to one
// refresh per TTL window, shared by BOTH /admin/api/moderation/queue dispatch
// arms.
//
// The `online` field is per-request live data (whoever is connected right now),
// so it is NEVER part of the cached value: the base query below always runs
// with an empty online-account set (every row lands online:false), and
// readModerationQueue merges the caller's real onlineAccountIds afterward,
// mirroring how admin_overview_cache leaves game.adminStats() out of its cache.
// This also sidesteps the resource-exhaustion trap a keyed cache would invite
// here: onlineAccountIds is a near-unique Set on every call (it tracks who is
// online right now), so keying a cache by it would grow the cache roughly
// once per tick forever. There is exactly one cached value, never one per
// online-set.
//
// moderationQueue's own tie-break sort ("online rows first, within an equal
// openReports/latestReportAt group") only matters once the live online flag is
// known, so it cannot happen inside the cached base read; readModerationQueue
// reapplies the SAME three-key comparator moderation_db.ts uses, after the live
// merge, so the served order is identical to calling the uncached function
// directly with the real online set.
//
// Bust wire: any write that changes what the base query returns (an account's
// banned_at/suspended_until, or a report's status leaving 'open') must bust
// this cache, matching server/CLAUDE.md's "anything a moderation action can
// change MUST be bust-wired" rule. moderation_db.ts fires
// setOnModerationQueueChanged's hook after moderateAccount, muteAccountChat
// (both of which also resolve any open reports on the target account), and a
// successful ignoreReport; server/main.ts wires that hook to
// bustModerationQueueCache below. Hooking the writes, not a route, covers both
// admin dispatch arms AND in-game GM sanctions (server/game.ts
// ModerationService), which call moderateAccount/muteAccountChat directly.
//
// The single-flight, stale-serve, and bust semantics come from the cached_read
// primitive (server/cached_read.ts, pinned by tests/server/cached_read.test.ts);
// this module only wires it to the moderation queue's base read.

import { type CachedRead, createCachedRead } from './cached_read';
import { type ModerationQueueRow, moderationQueue } from './moderation_db';

/** How long one moderation-queue base snapshot is served before the next re-query. */
export const MODERATION_QUEUE_TTL_MS = 5_000;

// Never populated with real ids: the base read is online-blind by design (see
// header). A fresh empty Set per call keeps that read-only intent obvious
// without relying on Object.freeze semantics over Set's internal slots.
const emptyOnlineSet = (): Set<number> => new Set<number>();

// The refresh + clock the singleton is built with. Production never touches
// these (the real moderationQueue and Date.now); tests inject fakes below.
let queryFn: () => Promise<ModerationQueueRow[]> = () => moderationQueue(emptyOnlineSet());
let nowFn: (() => number) | undefined;

// The module-level singleton, built LAZILY on first read so a test seam
// installed before first use takes effect. Typed readonly: Object.freeze on
// an array narrows it to readonly T[] (unlike a plain object, an array loses
// its mutator methods once frozen), and the cached array is shared by
// reference with every reader in the TTL window, so readonly is also the
// correct contract, not just what the freeze forces.
let cache: CachedRead<readonly ModerationQueueRow[]> | null = null;

function baseCache(): CachedRead<readonly ModerationQueueRow[]> {
  cache ??= createCachedRead(async () => Object.freeze(await queryFn()), {
    ttlMs: MODERATION_QUEUE_TTL_MS,
    now: nowFn,
  });
  return cache;
}

// Mirrors moderationQueue's own comparator (moderation_db.ts) exactly: highest
// open-report count first, then most recent report, then online before offline.
// Duplicated rather than imported because the base rows only carry a correct
// (K1, K2) order out of the cache; the K3 (online) tie-break can only be
// applied here, once the live set is known.
function compareModerationQueueRows(a: ModerationQueueRow, b: ModerationQueueRow): number {
  return (
    b.openReports - a.openReports ||
    new Date(b.latestReportAt).getTime() - new Date(a.latestReportAt).getTime() ||
    Number(b.online) - Number(a.online)
  );
}

/**
 * The moderation queue for one caller's live online-account view: the cached
 * base rows (at most one refresh per TTL window) with `online` merged in from
 * onlineAccountIds and the queue re-sorted to match, byte-for-byte equivalent
 * to calling the uncached moderationQueue(onlineAccountIds) directly.
 */
export async function readModerationQueue(
  onlineAccountIds: Set<number>,
): Promise<ModerationQueueRow[]> {
  const base = await baseCache().read();
  return base
    .map((row) => ({ ...row, online: onlineAccountIds.has(row.accountId) }))
    .sort(compareModerationQueueRows);
}

/**
 * Drop the cached base rows so the next read refreshes. Wired to
 * moderation_db.ts's setOnModerationQueueChanged hook at boot (server/main.ts);
 * production code should never need to call this directly.
 */
export function bustModerationQueueCache(): void {
  cache?.bust();
}

/**
 * Inject a fake query and/or clock into the singleton (test-only). Drops the
 * current cache instance so the next read is cold under the injected fakes.
 */
export function setModerationQueueCacheForTests(opts: {
  query?: () => Promise<ModerationQueueRow[]>;
  now?: () => number;
}): void {
  if (opts.query) queryFn = opts.query;
  if (opts.now) nowFn = opts.now;
  cache = null;
}

/**
 * Restore the real moderationQueue + Date.now and drop the cache instance so
 * the next read is cold (test-only).
 */
export function resetModerationQueueCacheForTests(): void {
  queryFn = () => moderationQueue(emptyOnlineSet());
  nowFn = undefined;
  cache = null;
}
