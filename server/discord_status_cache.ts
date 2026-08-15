// Keyed, bounded, short-TTL cached read for the GET /api/discord status core
// (the packet's D17, scoped as its own module by ruling R11: createCachedRead is
// single-value, and an unbounded per-account Map is exactly the grows-without-
// bound defect server/CLAUDE.md forbids).
//
// One CachedRead per account id, minted lazily on first read, held in a Map
// bounded by maxEntries with least-recently-read eviction (the Map re-insert
// idiom the bot governor's LRU registries use). The cached unit is the
// DATABASE-BACKED part of the payload only; the presence block is composed
// fresh per request by the caller (ruling R10), so it is never frozen behind
// this TTL.
//
// bust(key) drops the account's entry outright instead of delegating to
// CachedRead.bust(): replacing the instance gives a post-bust reader a fresh
// flight (the same joiner-refusal cached_read's epoch guard provides, since a
// pre-bust flight settles into an entry no longer reachable from the map) while
// also releasing the entry's cap slot. Pre-bust joiners still receive the value
// their flight computed, matching cached_read's documented contract.
//
// Scale envelope (D18): at 1,000 concurrent players and beyond the map holds at
// most maxEntries cores of a few hundred bytes each (DiscordStatusLink below
// keeps unserved columns out); entries are evicted only when an INSERT passes
// the cap, so after a burst the map is a retained floor bounded by maxEntries,
// never a transient. Past the cap the coldest account is evicted and its next
// status read costs one extra refresh, never an error.
//
// Failure contract, inherited from cached_read and stated because it CHANGES
// this endpoint's brownout behavior: a warm entry stale-serves (200 with a
// value of unbounded age) while refreshes keep failing, where the pre-cache
// endpoint answered 500; a cold entry still rejects, and a rejected mint
// releases its cap slot at settle, so failed mints never ACCUMULATE as dead
// weight. The bound stays hard on the way in (R11), so AT the cap a failing
// mint's transient slot still displaces the coldest entry while its flight is
// open: a brownout with churn costs up to one warm snapshot per failing mint
// that arrives at the cap (in-flight transient slots count toward it, so
// overlapping failing mints can displace below the value cap), never a
// growing residue. The absolute
// no-displacement guarantee would need either a soft bound or per-key flights
// outside the map (losing cold single-flight); both were considered and
// rejected. Stale-serving does not
// shed load (every past-TTL read still attempts the refresh flight), and its
// only signal today is cached_read's one console.warn per failure streak; a
// stale-serve counter would need the shared cached_read seam and is recorded
// as a follow-up, not taken here. Wall-clock time is correct here (server-only,
// never sim code); production omits opts.now, tests inject a clock. The
// refresh closure inherits cached_read's logging contract: a failed refresh is
// logged raw, so it must never embed secret or player-private material in
// error messages.

import {
  KeyedCachedRead,
  type KeyedCachedReadOptions,
  type KeyedCachedReadStats,
} from './cached_read';

/**
 * The link-row PROJECTION the payload serves, and deliberately nothing more.
 * Narrowing here is a privacy property, not tidiness: the full DiscordLinkRow
 * carries discord_email, which /api/discord never renders, and caching the
 * whole row would park that address in process memory per account for the
 * entry's lifetime AND make writers of unserved columns (setDiscordLinkEmail)
 * able to stale the cache invisibly. A column absent from this shape can do
 * neither; a field added here must add its writers' busts in the same change.
 */
export interface DiscordStatusLink {
  discordUserId: string;
  username: string | null;
  avatar: string | null;
  guildMember: boolean;
}

/**
 * The account-scoped, database-backed inputs of the /api/discord payload: the
 * projected discord_links row, the reward balance, the claimed swag ids, and
 * the one accounts column the payload reads (password_set). Everything else in
 * the response (env config, presence) is composed fresh per request.
 */
export interface DiscordStatusCore {
  link: DiscordStatusLink | null;
  points: number;
  lifetimePoints: number;
  claimedSwagIds: string[];
  passwordSet: boolean;
}

// Operator levers (D13), documented in DEPLOY.md. The TTL only bounds staleness
// for writes this process cannot see (a peer realm process's write); every
// in-process write site busts explicitly, so a caller is never served stale
// data after a change it just made.
export const DISCORD_STATUS_CACHE_TTL_MS_DEFAULT = 15_000;
export const DISCORD_STATUS_CACHE_MAX_ENTRIES_DEFAULT = 2_000;

/**
 * Positive-integer env parse: empty, non-numeric, and non-positive all fall
 * back (Number('') is 0, so a blank .env line must not become a zero TTL, which
 * would disable caching, or a zero cap, which the constructor refuses).
 */
export function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// The generic keyed cache moved to the cache seam it composes
// (server/cached_read.ts) when the guild bank activity log became its second
// domain consumer: a guild bank module importing THIS module for a generic
// would have been the wrong dependency. Re-exported here so every existing
// caller and test keeps its import path, and so this module still reads as the
// home of the Discord status cache built on top of it.
export {
  KeyedCachedRead,
  type KeyedCachedReadOptions,
  type KeyedCachedReadStats,
} from './cached_read';

// ---------------------------------------------------------------------------
// The process singleton serving discordStatusPayload. The reader is injected
// by server/discord.ts at module load (the configure<Domain>Runtime idiom, so
// this module never imports discord_db and the bust callers below cannot form
// an import cycle), and the cache itself builds lazily on the first read, so
// no clock or env value is bound before a test can inject its own.
// ---------------------------------------------------------------------------

export type DiscordStatusCoreReader = (accountId: number) => Promise<DiscordStatusCore>;

let reader: DiscordStatusCoreReader | null = null;
let active: KeyedCachedRead<DiscordStatusCore> | null = null;
let testOverrides: Partial<KeyedCachedReadOptions> | null = null;

export function configureDiscordStatusCache(read: DiscordStatusCoreReader): void {
  reader = read;
  active = null;
}

function activeCache(): KeyedCachedRead<DiscordStatusCore> | null {
  if (active !== null) return active;
  if (reader === null) return null;
  active = new KeyedCachedRead(reader, {
    ttlMs:
      testOverrides?.ttlMs ??
      positiveIntFromEnv(
        process.env.DISCORD_STATUS_CACHE_TTL_MS,
        DISCORD_STATUS_CACHE_TTL_MS_DEFAULT,
      ),
    maxEntries:
      testOverrides?.maxEntries ??
      positiveIntFromEnv(
        process.env.DISCORD_STATUS_CACHE_MAX_ENTRIES,
        DISCORD_STATUS_CACHE_MAX_ENTRIES_DEFAULT,
      ),
    now: testOverrides?.now,
  });
  return active;
}

/**
 * The cached status core for one account (miss and TTL expiry refresh). The
 * returned core is the SHARED cached object (link and claimedSwagIds included),
 * handed by reference to every reader of the entry: treat it as immutable, and
 * compose responses from it without writing to it. A consumer that mutated it
 * would corrupt every later response for that account until the next bust or
 * TTL expiry; the production reader makes that structural by deep-freezing the
 * core at mint (fetchDiscordStatusCore in server/discord.ts), so a mutation
 * throws at the offending call site under strict mode. Pinned by the
 * non-mutation arm in tests/discord_server.test.ts.
 */
export async function readDiscordStatusCore(accountId: number): Promise<DiscordStatusCore> {
  const cache = activeCache();
  if (cache === null) throw new Error('discord status cache has no configured reader');
  return cache.read(accountId);
}

/**
 * Bust one account's cached status core. Wired inside the shared write
 * functions (discord_db.ts, db.ts), never at a route-table entry, so both
 * /api/discord arms and every future caller of those writes stay covered. A
 * bust before the first read, or for an uncached account, is a no-op.
 */
export function bustDiscordStatus(accountId: number): void {
  active?.bust(accountId);
}

/**
 * Drop every entry. Part of the module surface the phase spec mandates (read,
 * bust-by-key, bust-all) and held as the whole-cache operational lever (a
 * moderation sweep or an ops flush); no production site wires it yet, the same
 * wire-up-later footing as stats(). Tests use resetDiscordStatusCacheForTests
 * for isolation, not this.
 */
export function bustAllDiscordStatus(): void {
  active?.bustAll();
}

/** Current entry count (bound observability + the eviction tests). */
export function discordStatusCacheSize(): number {
  return active?.size() ?? 0;
}

/**
 * Refresh/eviction/bust telemetry (zeros before the first read builds the
 * cache). PER INSTANCE, not per process: configureDiscordStatusCache and the
 * test reset both drop the built instance, so a metrics export reading this
 * must treat the numbers as resettable counters, never lifetime totals.
 */
export function discordStatusCacheStats(): KeyedCachedReadStats {
  return active?.stats() ?? { reads: 0, refreshes: 0, evictions: 0, busts: 0, entries: 0 };
}

/**
 * Test hook: drop the built cache (and any cached entries) and, when given,
 * override ttl/cap/clock for the NEXT lazy build. Production never calls this.
 */
export function resetDiscordStatusCacheForTests(overrides?: Partial<KeyedCachedReadOptions>): void {
  testOverrides = overrides ?? null;
  active = null;
}
