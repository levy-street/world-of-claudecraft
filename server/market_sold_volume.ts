// The World Market sold-volume OBSERVER: it watches a buy complete and writes
// it down. It is never an authority; the sim decides every sale.
//
// HOW A SALE IS DETECTED. `Sim.marketBuy` returns void and emits no success
// event (the ledger stays server-only, src/sim untouched), exactly like the
// bank ops that server/bank_ledger.ts observes, so this uses the same
// technique: read the listing row BEFORE the call, look for it again AFTER,
// and a row that left the book was bought. Every refusal arm inside marketBuy
// (too far from the Merchant, not enough copper, bags full, unknown id) leaves
// the row exactly where it was, so an unchanged book is an honest no-sale.
//
// The one blind spot, deliberate and tested: HOUSE stock. The Merchant's own
// standing listings are never spliced (marketBuy guards the whole
// seller-proceeds block on `!listing.house`), so a house purchase is
// indistinguishable from a refusal here. `marketSaleFromBuy` therefore refuses
// house rows outright rather than pretending to judge them. Nothing is lost
// today: house stock is the two vendor-sold bags, and no bag is in a tracked
// metrics bucket. If one ever were, this under-counts, which is the safe side
// for a supply metric.
//
// WHY A WRAPPER AND NOT FOUR LINES AT THE DISPATCH SITE. server/game.ts is a
// named monolith under an extraction ratchet, so the before/after read, the
// verdict and the write live here and the dispatch arm keeps its single line.
//
// THE WRITE IS FIRE AND FORGET. The 20 Hz loop never awaits it: each entry is
// chained onto a per-process FIFO promise tail, a rejected insert is reported
// and dropped, and nothing here can throw into the caller. A character lives
// on one realm process, so the FIFO preserves sale order.

import { classifyMarketMetricsItem } from './admin_market_metrics';
import type { MarketSoldVolumeEntry } from './market_sold_volume_db';

/** The listing shape this observer reads. `MarketListing` satisfies it. */
export interface SoldVolumeListing {
  id: number;
  itemId: string;
  count: number;
  price: number;
  house: boolean;
}

/** The slice of `Sim` the wrapper drives. */
export interface SoldVolumeSim {
  readonly marketListings: readonly SoldVolumeListing[];
  marketBuy(listingId: number, pid?: number): void;
}

/**
 * The sale a buy completed, or null. Pure: `before` is the listing row as it
 * stood ahead of the call and `after` the same id looked up again.
 *
 * Reports the LISTING PRICE, not the seller's proceeds. The Merchant's cut is
 * a gold sink, not lost volume, and an operator watching for laundering wants
 * the gross figure that actually changed hands.
 */
export function marketSaleFromBuy(
  before: SoldVolumeListing | null,
  after: SoldVolumeListing | null,
): MarketSoldVolumeEntry | null {
  if (before === null) return null;
  // See the module header: a house row survives its own sale, so its
  // disappearance test carries no information either way.
  if (before.house) return null;
  if (after !== null) return null;
  return { itemId: before.itemId, quantity: before.count, copper: before.price };
}

function findListing(
  listings: readonly SoldVolumeListing[],
  listingId: number,
): SoldVolumeListing | null {
  return listings.find((row) => row.id === listingId) ?? null;
}

type SoldVolumeWriter = (entry: MarketSoldVolumeEntry) => Promise<void>;

let writer: SoldVolumeWriter | null = null;
let onWriteError: (err: unknown) => void = (err) =>
  console.error('market sold-volume write failed:', err);
// The FIFO tail. Always a settled-or-pending promise; never rejects, because
// every link swallows into onWriteError.
let tail: Promise<void> = Promise.resolve();

/**
 * Boot wiring: hand the observer the durable write. Until this is called the
 * observer is inert and selling behaves exactly as it did before.
 */
export function configureMarketSoldVolume(write: SoldVolumeWriter): void {
  writer = write;
}

/** Test seam: clear (or replace) the writer and its error sink. */
export function resetMarketSoldVolumeForTests(
  write: SoldVolumeWriter | null = null,
  onError?: (err: unknown) => void,
): void {
  writer = write;
  onWriteError = onError ?? ((err) => console.error('market sold-volume write failed:', err));
  tail = Promise.resolve();
}

/** Resolves once every queued write has settled (tests and shutdown drains). */
export function soldVolumeWriterIdle(): Promise<void> {
  return tail;
}

function enqueue(entry: MarketSoldVolumeEntry): void {
  const write = writer;
  if (write === null) return;
  tail = tail.then(() =>
    write(entry).catch((err: unknown) => {
      // Reported and dropped: sold volume is an observation, and losing one
      // row must never disturb a sale that already happened.
      onWriteError(err);
    }),
  );
}

/**
 * Run one `market_buy` dispatch and record the sale it completes.
 *
 * Only sales of items that classify into a metrics bucket are recorded: an
 * untracked id would be a row nothing reads, and it is what would put the
 * table's size in players' hands (see server/market_sold_volume_db.ts).
 *
 * The buy itself is never guarded: if `marketBuy` throws, that throw belongs to
 * the caller exactly as before and nothing is recorded.
 */
export function buyWithSoldVolume(sim: SoldVolumeSim, listingId: number, pid: number): void {
  const before = findListing(sim.marketListings, listingId);
  sim.marketBuy(listingId, pid);
  const entry = marketSaleFromBuy(before, findListing(sim.marketListings, listingId));
  if (entry === null) return;
  if (classifyMarketMetricsItem(entry.itemId) === null) return;
  enqueue(entry);
}
