import { createCachedRead, deepFreezeSnapshot } from './cached_read';
import type { StaffWatchEntry } from './staff_watchlist_db';

type Watchlist = { entries: StaffWatchEntry[]; total: number };

// Match the moderation queue cadence. Cache residence for other realms' changes
// (including account deletion) is bounded by this window from query start.
// An in-flight statement still has its ordinary DB deadlines. Fresh-login
// enforcement never uses this cache.
export const STAFF_WATCHLIST_TTL_MS = 5_000;

export function createStaffWatchlistCache(query: () => Promise<Watchlist>, now = Date.now) {
  let epoch = 0;
  let sqlFlight: { epoch: number; promise: Promise<{ list: Watchlist; asOf: number }> } | null =
    null;

  const cache = createCachedRead(
    async () => {
      // A bust must refuse old joiners without letting repeated mutations
      // occupy multiple pool clients. Wait for old SQL, then collapse all
      // post-bust callers onto one new read of the latest epoch.
      while (sqlFlight !== null) {
        const flight = sqlFlight;
        if (flight.epoch === epoch) return flight.promise;
        try {
          await flight.promise;
        } catch {
          // Old readers receive their error; post-bust readers retry fresh.
        }
      }
      const asOf = now();
      const promise = query()
        .then((list) => ({ list: deepFreezeSnapshot(list), asOf }))
        .finally(() => {
          if (sqlFlight?.promise === promise) sqlFlight = null;
        });
      sqlFlight = { epoch, promise };
      return promise;
    },
    { ttlMs: STAFF_WATCHLIST_TTL_MS, now },
  );

  return {
    async read(): Promise<Watchlist> {
      const snapshot = cache.peek();
      if (snapshot !== null && now() - snapshot.asOf < STAFF_WATCHLIST_TTL_MS) {
        return snapshot.list;
      }
      // refresh() retains single-flight + epoch guards but rejects failures:
      // read()'s indefinite stale-on-error would violate cross-realm freshness.
      // Timestamp at query start, so slow SQL never buys another freshness TTL.
      return (await cache.refresh()).list;
    },
    bust(): void {
      epoch++;
      cache.bust();
    },
  };
}
