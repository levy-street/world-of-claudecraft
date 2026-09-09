/**
 * Process-local cache for the queue-pop Discord DM opt-in read. Kept separate
 * from discord_queue_pops.ts so Discord link/unlink writes can bust the cache
 * without importing the observer module, which imports the DB pool.
 */

export const QUEUE_PING_CACHE_TTL_MS = 5 * 60_000;

// How long a failed opt-in read holds EVERY account out of the next read
// batch (see queuePingReadBackedOff). Matches discord_activity.ts's
// RELEASE_RETRY_BACKOFF_MS: long enough that a sustained outage costs at
// most one batch read per backoff window, rather than one every tick (the
// tick loop runs far faster than any DB failure resolves), short enough that
// recovery is felt within a couple of seconds.
export const QUEUE_PING_FAILURE_BACKOFF_MS = 2_000;

// Mirror of server/http/config.ts DEFAULT_MAX_PLAYERS_PER_REALM (not
// imported: config.ts fails fast without DATABASE_URL, and this module must
// construct in DB-less unit worlds; server/bank_vault_ledger_guard.ts
// documents the same constraint for its own resolver).
const DEFAULT_REALM_PLAYER_CAP = 5_000;

// The floor: past the DEFAULT realm admission cap (server/CLAUDE.md), not the
// older 4,096, so an unraised MAX_PLAYERS_PER_REALM never evicts a
// still-active account's cached opt-in answer every tick under steady load
// (each eviction re-triggers the very read the cache exists to avoid).
export const QUEUE_PING_CACHE_FLOOR = 8_192;

/**
 * Cache capacity from the RESOLVED realm player cap, the same shape as
 * resolveBankVaultLedgerMaxAccountStates (bank_vault_ledger_guard.ts): an
 * env-raised MAX_PLAYERS_PER_REALM must not outgrow the cache, or a realm
 * running above the shipped default would evict a still-active account's
 * cached answer every tick once the realm is at capacity (hot recency
 * thrashing: the cache's steady-load win turns back into a per-tick DB read
 * for whichever accounts most recently missed). +128 headroom over a raised
 * cap, never below the floor. A cap of 0 or negative disables realm
 * admission capping entirely (ws_auth admits unbounded fresh joins), so
 * there is no cap to size from and the floor stands.
 */
export function resolveQueuePingCacheMax(rawMaxPlayersPerRealm: string | undefined): number {
  const trimmed = rawMaxPlayersPerRealm?.trim();
  const parsed =
    trimmed === undefined || trimmed === '' ? DEFAULT_REALM_PLAYER_CAP : Number(trimmed);
  const resolvedCap = Number.isFinite(parsed) ? parsed : DEFAULT_REALM_PLAYER_CAP;
  return Math.max(
    QUEUE_PING_CACHE_FLOOR,
    resolvedCap > 0
      ? Math.min(Math.ceil(resolvedCap) + 128, Number.MAX_SAFE_INTEGER)
      : QUEUE_PING_CACHE_FLOOR,
  );
}

function queuePingCacheMax(): number {
  return resolveQueuePingCacheMax(process.env.MAX_PLAYERS_PER_REALM);
}

const optIn = new Map<number, { value: boolean; at: number }>();

let bustStamp = 0;
const bustedAt = new Map<number, number>();

// Observer-wide: when the opt-in read last FAILED (its completion time, never
// its start time; see recordQueuePingReadFailure). A single shared clock, not
// one per account, so a newly-queued account arriving mid-outage sits out the
// SAME window as every already-failing account instead of costing its own
// query every tick until it fails once itself.
let lastFailureCompletedAt = Number.NEGATIVE_INFINITY;

export function queuePingCacheBustStamp(): number {
  return bustStamp;
}

export function cachedQueuePingOptIn(accountId: number, now: number): boolean | undefined {
  const entry = optIn.get(accountId);
  if (!entry) return undefined;
  if (now - entry.at >= QUEUE_PING_CACHE_TTL_MS) {
    optIn.delete(accountId);
    return undefined;
  }
  return entry.value;
}

export function rememberQueuePingOptIn(
  accountId: number,
  value: boolean,
  now: number,
  readStarted: number,
): boolean {
  const busted = bustedAt.get(accountId);
  if (busted !== undefined) {
    bustedAt.delete(accountId);
    if (busted > readStarted) return false;
  }
  optIn.delete(accountId);
  optIn.set(accountId, { value, at: now });
  const max = queuePingCacheMax();
  while (optIn.size > max) {
    const oldest = optIn.keys().next();
    if (oldest.done) break;
    optIn.delete(oldest.value);
  }
  return true;
}

/**
 * Forget an account's cached opt-in answer. Toggle writes and Discord
 * link/unlink writes call this so a linked queued player is picked up by the
 * next observer tick rather than after the TTL.
 */
export function bustQueuePingCache(accountId: number): void {
  optIn.delete(accountId);
  bustedAt.delete(accountId);
  bustedAt.set(accountId, ++bustStamp);
  const max = queuePingCacheMax();
  while (bustedAt.size > max) {
    const oldest = bustedAt.keys().next();
    if (oldest.done) break;
    bustedAt.delete(oldest.value);
  }
}

/**
 * Whether the observer-wide opt-in read backoff is still open: at least one
 * read failed within the last QUEUE_PING_FAILURE_BACKOFF_MS, so NO account
 * (already-failing or brand new) is read this tick. Shared rather than
 * per-account: without this, a newly-queued account (never failed itself)
 * would cost its own query every tick for the whole outage, which for a
 * churning queue defeats the point of backing off at all. Ages out on its
 * own past the window, the same self-expiring shape as cachedQueuePingOptIn's
 * TTL.
 */
export function queuePingReadBackedOff(now: number): boolean {
  return now - lastFailureCompletedAt < QUEUE_PING_FAILURE_BACKOFF_MS;
}

/**
 * Record a failed read, starting the shared backoff window. `now` MUST be
 * the time the read actually failed (taken fresh when its promise settles),
 * never the tick's start time: a read that takes longer than the backoff
 * window itself to fail would otherwise record a window that had already
 * lapsed before it was ever recorded, backing off nothing.
 */
export function recordQueuePingReadFailure(now: number): void {
  lastFailureCompletedAt = now;
}

export function resetQueuePingCacheForTests(): void {
  optIn.clear();
  bustedAt.clear();
  bustStamp = 0;
  lastFailureCompletedAt = Number.NEGATIVE_INFINITY;
}
