// Keyed, bounded TTL cache for the public lifetime-XP rank read
// (lifetimeXpRankForCharacter, server/db.ts). The underlying read runs two
// COUNT(*) scans over the whole realm's characters table, and it is read on
// every character sheet view: the owner sheet, the public sheet, AND the
// unauthenticated crawlable profile_page.ts SEO route, so the same character
// is commonly re-read within seconds by repeat viewers and crawlers alike.
// Same keyed-Map-of-CachedRead shape as discord_status_cache.ts, bounded by
// maxEntries: the public route is keyed by ANY character on the realm (not
// only currently-online ones), so an unbounded per-character Map would be
// exactly the grows-without-bound defect server/CLAUDE.md forbids.
//
// A ban or unban changes every OTHER eligible character's `ahead`/`total`
// counts too (the delisted account leaves or rejoins the population the
// counts are taken over), not only the moderated account's own rank, so a
// moderation action busts the WHOLE cache (bustAllLifetimeXpRankCache, wired
// into server/main.ts bustBoardCaches) rather than one key: a TTL alone would
// let a just-banned account's stale, inflated rank keep showing on OTHER
// players' public sheets for up to the TTL, the exact immediacy bustBoardCaches
// exists to guarantee for every other player-derived board.
//
// Wall-clock time is correct here (server-only, never sim code); production
// omits opts.now, tests inject a clock.

import {
  KeyedCachedRead,
  type KeyedCachedReadOptions,
  type KeyedCachedReadStats,
} from './cached_read';

export type LifetimeXpRank = { rank: number; total: number } | null;

// Operator levers, mirroring discord_status_cache.ts's DEPLOY.md-documented
// pair. 30s matches LEADERBOARD_TTL_MS (main.ts): the same underlying metric
// (lifetime XP rank) already tolerates that staleness on the boards, and
// 5,000 entries covers a realm well past MAX_PLAYERS_PER_REALM's 5,000-player
// default (server/CLAUDE.md) since the public route also serves offline characters.
export const LIFETIME_XP_RANK_CACHE_TTL_MS_DEFAULT = 30_000;
export const LIFETIME_XP_RANK_CACHE_MAX_ENTRIES_DEFAULT = 5_000;

/**
 * Positive-integer env parse: empty, non-numeric, and non-positive all fall
 * back (Number('') is 0, so a blank .env line must not become a zero TTL,
 * which would disable caching, or a zero cap, which the constructor refuses).
 */
export function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// The process singleton serving readLifetimeXpRankForCharacter. The reader is
// injected by server/db.ts at module load (the configure<Domain>Runtime idiom
// discord_status_cache.ts also uses), and the cache itself builds lazily on
// the first read, so no clock or env value is bound before a test can inject
// its own.
// ---------------------------------------------------------------------------

export type LifetimeXpRankReader = (characterId: number) => Promise<LifetimeXpRank>;

let reader: LifetimeXpRankReader | null = null;
let active: KeyedCachedRead<LifetimeXpRank> | null = null;
let testOverrides: Partial<KeyedCachedReadOptions> | null = null;

export function configureLifetimeXpRankCache(read: LifetimeXpRankReader): void {
  reader = read;
  active = null;
}

function activeCache(): KeyedCachedRead<LifetimeXpRank> | null {
  if (active !== null) return active;
  if (reader === null) return null;
  active = new KeyedCachedRead(reader, {
    ttlMs:
      testOverrides?.ttlMs ??
      positiveIntFromEnv(
        process.env.LIFETIME_XP_RANK_CACHE_TTL_MS,
        LIFETIME_XP_RANK_CACHE_TTL_MS_DEFAULT,
      ),
    maxEntries:
      testOverrides?.maxEntries ??
      positiveIntFromEnv(
        process.env.LIFETIME_XP_RANK_CACHE_MAX_ENTRIES,
        LIFETIME_XP_RANK_CACHE_MAX_ENTRIES_DEFAULT,
      ),
    now: testOverrides?.now,
  });
  return active;
}

/** The cached lifetime-XP rank for one character (miss and TTL-expiry refresh). */
export async function readLifetimeXpRankForCharacter(characterId: number): Promise<LifetimeXpRank> {
  const cache = activeCache();
  if (cache === null) throw new Error('lifetime XP rank cache has no configured reader');
  return cache.read(characterId);
}

/**
 * Drop one character's cached rank. No production write site targets a
 * single character today (see bustAllLifetimeXpRankCache for why a
 * moderation action busts every key instead); exposed for symmetry with the
 * other keyed caches and for tests. A bust before the first read, or for an
 * uncached character, is a no-op.
 */
export function bustLifetimeXpRankCache(characterId: number): void {
  active?.bust(characterId);
}

/**
 * Drop every cached rank. Wired into server/main.ts bustBoardCaches (the
 * shared post-moderation hook) so a ban or unban is reflected in every
 * public sheet's rank immediately, the same immediacy every other
 * player-derived board cache already guarantees.
 */
export function bustAllLifetimeXpRankCache(): void {
  active?.bustAll();
}

/** Current entry count (bound observability + the eviction tests). */
export function lifetimeXpRankCacheSize(): number {
  return active?.size() ?? 0;
}

/** Refresh/eviction/bust telemetry (zeros before the first read builds the cache). */
export function lifetimeXpRankCacheStats(): KeyedCachedReadStats {
  return active?.stats() ?? { reads: 0, refreshes: 0, evictions: 0, busts: 0, entries: 0 };
}

/**
 * Test hook: drop the built cache (and any cached entries) and, when given,
 * override ttl/cap/clock for the NEXT lazy build. Production never calls this.
 */
export function resetLifetimeXpRankCacheForTests(
  overrides?: Partial<KeyedCachedReadOptions>,
): void {
  testOverrides = overrides ?? null;
  active = null;
}
