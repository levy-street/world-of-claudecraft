/**
 * Process-local cache for the queue-pop Discord DM opt-in read. Kept separate
 * from discord_queue_pops.ts so Discord link/unlink writes can bust the cache
 * without importing the observer module, which imports the DB pool.
 */

export const QUEUE_PING_CACHE_TTL_MS = 5 * 60_000;
export const QUEUE_PING_CACHE_MAX = 4096;

const optIn = new Map<number, { value: boolean; at: number }>();

let bustStamp = 0;
const bustedAt = new Map<number, number>();

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
  while (optIn.size > QUEUE_PING_CACHE_MAX) {
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
  while (bustedAt.size > QUEUE_PING_CACHE_MAX) {
    const oldest = bustedAt.keys().next();
    if (oldest.done) break;
    bustedAt.delete(oldest.value);
  }
}

export function resetQueuePingCacheForTests(): void {
  optIn.clear();
  bustedAt.clear();
  bustStamp = 0;
}
