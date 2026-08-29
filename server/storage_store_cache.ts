// The cached Claudium storage-rung price table behind the owner-only bank
// wire (Bank Storage phase 11). The snapshot encoder needs a SYNCHRONOUS
// per-tick read (20 Hz per session standing at a banker), so this module
// keeps one realm-global price map and refreshes it in the background:
// cached read with single-flight, the server/CLAUDE.md hot-path seam. The
// catalog's costs are account-independent (owned varies per account but is
// never read here), so ONE cache serves every session; the refresh fetch
// simply rides whichever account's snapshot noticed the staleness.
//
// Freshness contract: serve the last snapshot while it is younger than
// MAX_STALE_MS, refreshing once TTL_MS has passed; past MAX_STALE_MS the
// price is ABSENT, which is the graceful-degradation shape the wire field
// documents (the client shows gold alone). A stale-but-served price is a
// display quote only: the spend path re-validates against the service's
// live cost and refuses with price_changed on drift, so staleness can never
// mischarge.

import { BANK_EXPANSION_SLOTS } from '../src/sim/bank';
import { STORAGE_SKUS } from '../src/sim/content/storage_charters';
import { claudiumStore } from './claudium_proxy';

const TTL_MS = 60_000;
/** Past this, the cached price is ABSENT and the button is gold-only. Exported
 *  because it is also the argued bound on how long an AMBIGUOUS purchase may
 *  keep the gold rail shut (server/storage_ladder_hold.ts): the gold rail
 *  reopens exactly when the Claudium rail has aged off the button, and wiring
 *  both to this one source is what keeps that argument true. */
export const STORAGE_PRICE_MAX_STALE_MS = 10 * 60_000;
const MAX_STALE_MS = STORAGE_PRICE_MAX_STALE_MS;
// A failed or unavailable refresh retries no more often than this, so a
// down service costs one fetch per interval instead of one per snapshot.
const RETRY_MIN_INTERVAL_MS = 15_000;

interface StorePriceCache {
  pricesByLadderIndex: Map<number, number>;
  fetchedAt: number;
}

let cache: StorePriceCache | null = null;
let inflight: Promise<void> | null = null;
let lastAttemptAt = 0;

function kickRefresh(accountId: number): void {
  const now = Date.now();
  if (inflight || now - lastAttemptAt < RETRY_MIN_INTERVAL_MS) return;
  lastAttemptAt = now;
  inflight = claudiumStore(accountId)
    .then((store) => {
      // Unavailable: keep serving the last snapshot until MAX_STALE_MS ages
      // it out; never replace real prices with an empty outage map.
      if (!store.available) return;
      const prices = new Map<number, number>();
      for (const item of store.items) {
        if (item.kind !== 'storage') continue;
        const sku = STORAGE_SKUS[item.itemId];
        if (sku?.ladderIndex === undefined) continue;
        if (Number.isSafeInteger(item.costClaudium) && item.costClaudium > 0) {
          prices.set(sku.ladderIndex, item.costClaudium);
        }
      }
      // An AVAILABLE response carrying no usable rung price is not a catalog,
      // it is a shape this game cannot read: a season swap caught mid-flight, a
      // proxy trimming the body, a kind or id rename on the service side. The
      // outage guard above only covers available === false, so without this the
      // empty map would REPLACE good prices and stamp itself FRESH, blanking
      // the wire field for a whole TTL and restarting the staleness clock that
      // exists to retire a bad snapshot. Keep what we have and let MAX_STALE_MS
      // retire it if the emptiness turns out to be real; a stale quote cannot
      // mischarge, because the spend re-validates cost and price_changed refuses.
      if (prices.size === 0 && cache !== null && cache.pricesByLadderIndex.size > 0) return;
      cache = { pricesByLadderIndex: prices, fetchedAt: Date.now() };
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
}

/** The Claudium price of the NEXT unpurchased rung for a ladder position, or
 *  undefined (absent on the wire) when the ladder is full, the catalog has
 *  no such rung, or the cache is cold or aged out. Synchronous by contract;
 *  a stale read kicks the background refresh and answers from what it has. */
export function nextRungClaudiumPriceFor(
  purchasedSlots: number,
  accountId: number,
): number | undefined {
  const now = Date.now();
  if (!cache || now - cache.fetchedAt > TTL_MS) kickRefresh(accountId);
  if (!cache || now - cache.fetchedAt > MAX_STALE_MS) return undefined;
  return cache.pricesByLadderIndex.get(Math.floor(purchasedSlots / BANK_EXPANSION_SLOTS));
}

/** Test-only: drop the cache, the single-flight latch, and the retry gate. */
export function resetStorageStoreCacheForTests(): void {
  cache = null;
  inflight = null;
  lastAttemptAt = 0;
}
