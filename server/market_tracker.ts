// World Market tracker: an OBSERVER of the sim's market ops, never an authority
// (the bank_ledger pattern). The sim's marketBuy returns void and emits no
// success event by design (src/sim stays untouched and server-only concerns
// stay out of the shared sim), so the dispatch site detects success by reading
// the buyer's purse BEFORE and AFTER the call: a successful buy always debits
// exactly the listing's price (MARKET_MIN_PRICE >= 1, so the debit is never 0),
// and a refused call debits nothing. The listing row itself is captured BEFORE
// the call because a completed player sale splices it out of the book.
//
// captureMarketBuy and diffMarketBuy are PURE (unit-tested directly).
// recordMarketBuy and recordMarketListingSnapshot turn their results into
// fire-and-forget inserts chained onto one per-process FIFO promise tail: the
// game loop NEVER awaits them, a rejected insert logs and never blocks or
// reorders anything, and the observer can never throw into the caller. A realm
// lives on one process, so the FIFO preserves that realm's sale order and
// main.ts drains it once (marketTrackerIdle) at shutdown.

import type { MarketListing } from '../src/sim/market';
import { pool } from './db';
import {
  insertMarketListingSnapshotRows,
  insertMarketSaleRow,
  type MarketListingSnapshotRow,
  type MarketSaleRow,
  pruneMarketListingSnapshots,
} from './market_tracker_db';
import { REALM } from './realm';

// The pre-call facts a sale row needs, copied by value: the book row is
// spliced on a player sale and the meta object mutates in place, so neither
// can be read after the call.
export interface MarketBuyCapture {
  listing: {
    id: number;
    sellerKey: string;
    itemId: string;
    count: number;
    price: number;
    house: boolean;
    instanced: boolean;
    craftedRecipeId: string | null;
  } | null;
  buyerCopperBefore: number | null;
}

export function captureMarketBuy(
  listings: readonly MarketListing[],
  listingId: number,
  buyerCopper: number | null,
): MarketBuyCapture {
  const listing = listings.find((l) => l.id === listingId);
  return {
    listing: listing
      ? {
          id: listing.id,
          sellerKey: listing.sellerKey,
          itemId: listing.itemId,
          count: listing.count,
          price: listing.price,
          house: listing.house,
          instanced: listing.instance !== undefined,
          craftedRecipeId: listing.craftedRecipeId ?? null,
        }
      : null,
    buyerCopperBefore: buyerCopper,
  };
}

// A sellerKey is USUALLY the seller's character id as a string, but legacy
// listings can carry a character NAME and a headless seller a bare entity id
// (src/sim/market.ts marketSellerKey). Only an unambiguous all-digit key maps
// to a character id column value; anything else (and the house's '') is null.
function sellerCharacterIdOf(sellerKey: string): number | null {
  if (!/^\d+$/.test(sellerKey)) return null;
  const id = Number(sellerKey);
  return Number.isSafeInteger(id) ? id : null;
}

// Observe success by diffing the buyer's purse around the call: success debits
// exactly the captured listing's price. Returns the sale row a successful buy
// produced, or null for a refusal / unknown listing / missing purse read (a
// null on either side means the buyer could not be resolved, so nothing can
// have been bought).
export function diffMarketBuy(
  who: { characterId: number; accountId: number },
  capture: MarketBuyCapture,
  buyerCopperAfter: number | null,
): MarketSaleRow | null {
  const { listing, buyerCopperBefore } = capture;
  if (!listing || buyerCopperBefore === null || buyerCopperAfter === null) return null;
  if (buyerCopperBefore - buyerCopperAfter !== listing.price) return null;
  return {
    realm: REALM,
    listingId: listing.id,
    itemId: listing.itemId,
    quantity: listing.count,
    totalPriceCopper: listing.price,
    house: listing.house,
    instanced: listing.instanced,
    craftedRecipeId: listing.craftedRecipeId,
    buyerCharacterId: who.characterId,
    buyerAccountId: who.accountId,
    sellerCharacterId: listing.house ? null : sellerCharacterIdOf(listing.sellerKey),
  };
}

// Per-process FIFO tail shared by sale rows and snapshots, so shutdown drains
// one queue. A rejected insert is caught (logged) and the chain continues.
let tail: Promise<void> = Promise.resolve();

// Record a successful market buy fire-and-forget. Returns void immediately
// (never a promise, never awaited by the game loop); the whole body is guarded
// so it can never throw into the dispatch path.
export function recordMarketBuy(
  who: { characterId: number; accountId: number },
  capture: MarketBuyCapture,
  buyerCopperAfter: number | null,
): void {
  try {
    const row = diffMarketBuy(who, capture, buyerCopperAfter);
    if (!row) return;
    tail = tail
      .then(() => insertMarketSaleRow(pool, row))
      .catch((err) => {
        console.error('market_tracker sale write failed:', err);
      });
  } catch (err) {
    // The observer must never fault the dispatch path.
    console.error('market_tracker recordMarketBuy failed:', err);
  }
}

// Aggregate the in-memory listing book into one snapshot row per item that has
// at least one player listing. PURE: reads the array it is handed and touches
// no clock or database. House rows are excluded (a build constant, see
// market_tracker_db.ts); instanced listings are included in the aggregates,
// so a one-off rolled item can be the lowest ask for its item id.
export function snapshotMarketListings(
  listings: readonly MarketListing[],
): MarketListingSnapshotRow[] {
  const byItem = new Map<string, MarketListingSnapshotRow>();
  for (const l of listings) {
    if (l.house) continue;
    if (!Number.isFinite(l.price) || !Number.isFinite(l.count) || l.count <= 0) continue;
    const row = byItem.get(l.itemId);
    if (!row) {
      byItem.set(l.itemId, {
        realm: REALM,
        itemId: l.itemId,
        listingCount: 1,
        totalQuantity: l.count,
        lowestAskTotalCopper: l.price,
        lowestAskQuantity: l.count,
      });
      continue;
    }
    row.listingCount += 1;
    row.totalQuantity += l.count;
    // Cheapest by UNIT price; integer cross-multiplication keeps the compare
    // exact. On a unit-price tie prefer the smaller stack (the cheaper way in).
    const challenger = l.price * row.lowestAskQuantity;
    const holder = row.lowestAskTotalCopper * l.count;
    if (challenger < holder || (challenger === holder && l.price < row.lowestAskTotalCopper)) {
      row.lowestAskTotalCopper = l.price;
      row.lowestAskQuantity = l.count;
    }
  }
  return [...byItem.values()];
}

// Snapshot the book fire-and-forget (the main.ts interval never awaits it).
// An empty book writes nothing. One capture timestamp is taken here, before
// chunking, so every row of this tick shares it (see market_tracker_db.ts).
export function recordMarketListingSnapshot(listings: readonly MarketListing[]): void {
  try {
    const rows = snapshotMarketListings(listings);
    if (rows.length === 0) return;
    const capturedAt = new Date();
    tail = tail
      .then(() => insertMarketListingSnapshotRows(pool, rows, capturedAt))
      .catch((err) => {
        console.error('market_tracker snapshot write failed:', err);
      });
  } catch (err) {
    console.error('market_tracker recordMarketListingSnapshot failed:', err);
  }
}

// Daily retention sweep, called from the main.ts prune interval. Awaited by
// its caller with a .catch, never by the game loop.
export function pruneMarketTrackerSnapshots(): Promise<number> {
  return pruneMarketListingSnapshots(pool);
}

// The current FIFO tail, for tests and the main.ts shutdown drain.
export function marketTrackerIdle(): Promise<void> {
  return tail;
}
