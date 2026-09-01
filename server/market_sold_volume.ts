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
//
// AND THE TAIL IS BOUNDED, in the shape server/bank_ledger.ts uses for the
// identical fire-and-forget FIFO (see its BANK_LEDGER_TAIL_MAX_DEPTH block).
// Inflow scales with how hard the realm trades while the drain is one
// serialized insert chain, so an unbounded chain is retained memory nobody is
// watching. Two things bound it here:
//
//   COALESCING FIRST, because this store's row is an ACCUMULATOR. Every column
//   the upsert touches is added (sale_count, quantity, copper), so two QUEUED
//   sales of one item and one entry carrying both write byte-identical totals.
//   Folding is therefore LOSSLESS, unlike the sibling's cap-drop, and it is
//   what makes the queue small: it can hold at most one entry per distinct
//   TRACKED item id (81 today; buyWithSoldVolume admits nothing else), no
//   matter how hard the realm trades. An entry is frozen the moment its write
//   STARTS, so nothing mutates a row already on the wire.
//
//   THEN AN ADMISSION CAP, SOLD_VOLUME_TAIL_MAX_DEPTH, as the guard on that
//   premise rather than a throughput bound: coalescing keeps the real depth two
//   orders of magnitude below it, so if this cap ever fires, the premise broke
//   (coalescing stopped working, or the tracked id set grew past the cap) and
//   the counted, logged drop says so instead of the queue growing quietly.
//   A drop loses an observation, never a sale.
//
// soldVolumeTailStats() reports depth, coalesced sales and dropped sales, the
// bankLedgerTailStats() shape, so the wiring can hang them off a readout.

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

/**
 * Admission cap on QUEUED (not yet started) write entries. Mirrors the sibling
 * FIFO's depth cap (BANK_LEDGER_TAIL_MAX_DEPTH, server/bank_ledger.ts) and its
 * arithmetic transfers unchanged: the drain is a serialized chain of single-row
 * upserts, and at a conservative 200 inserts/s a 2,000-deep queue clears inside
 * a ten second shutdown drain. The sibling's SECOND cap (rows) has no analogue
 * here, deliberately: its entries carry up to 112 audit rows each, while every
 * entry here is exactly one upsert, so depth already IS the row count.
 *
 * See the header for why this is a premise guard rather than a live bound: with
 * coalescing the queue cannot exceed the distinct tracked id count, which the
 * paired test pins as strictly below this cap.
 */
export const SOLD_VOLUME_TAIL_MAX_DEPTH = 2_000;

/** Live queue depth plus lifetime coalesced and dropped SALES (never rows:
 *  one entry can stand for many sales). The bankLedgerTailStats() shape. */
export interface SoldVolumeTailStats {
  /** Entries queued and not yet started. */
  depth: number;
  /** Sales folded into an already-queued entry instead of queueing another. */
  coalescedSales: number;
  /** Sales lost at the admission cap. */
  droppedSales: number;
}

let writer: SoldVolumeWriter | null = null;
let onWriteError: (err: unknown) => void = (err) =>
  console.error('market sold-volume write failed:', err);
// The FIFO tail. Always a settled-or-pending promise; never rejects, because
// every link swallows into onWriteError.
let tail: Promise<void> = Promise.resolve();
// The QUEUED entries by item id: the coalescing target AND the depth counter,
// one value rather than two so the two can never disagree. An entry leaves this
// map when its write starts, which is exactly the point it stops being
// coalescible.
const queued = new Map<string, MarketSoldVolumeEntry>();
let maxDepth = SOLD_VOLUME_TAIL_MAX_DEPTH;
let coalescedSales = 0;
let droppedSales = 0;
// The shared latch idiom: a cap breach is a standing condition, so log the
// first few and count the rest.
const TAIL_DROP_LOG_LIMIT = 5;
let tailDropLogged = 0;

/**
 * Boot wiring: hand the observer the durable write. Until this is called the
 * observer is inert and selling behaves exactly as it did before.
 */
export function configureMarketSoldVolume(write: SoldVolumeWriter): void {
  writer = write;
}

/** Test seam: clear (or replace) the writer, its error sink, and the cap.
 *  Resets the queue and every counter so one suite cannot read another's. */
export function resetMarketSoldVolumeForTests(
  write: SoldVolumeWriter | null = null,
  onError?: (err: unknown) => void,
  opts: { maxDepth?: number } = {},
): void {
  writer = write;
  onWriteError = onError ?? ((err) => console.error('market sold-volume write failed:', err));
  tail = Promise.resolve();
  queued.clear();
  maxDepth = opts.maxDepth ?? SOLD_VOLUME_TAIL_MAX_DEPTH;
  coalescedSales = 0;
  droppedSales = 0;
  tailDropLogged = 0;
}

/** Resolves once every queued write has settled (tests and shutdown drains). */
export function soldVolumeWriterIdle(): Promise<void> {
  return tail;
}

/** Queue depth and the lifetime coalesce/drop counters (ops + metrics). */
export function soldVolumeTailStats(): SoldVolumeTailStats {
  return { depth: queued.size, coalescedSales, droppedSales };
}

function enqueue(entry: MarketSoldVolumeEntry): void {
  const write = writer;
  if (write === null) return;
  const sales = entry.saleCount ?? 1;
  // COALESCE BEFORE THE CAP, always: folding costs nothing and loses nothing,
  // so a full queue must still absorb repeat sales of an item it already holds
  // rather than dropping them.
  const pending = queued.get(entry.itemId);
  if (pending !== undefined) {
    pending.saleCount = (pending.saleCount ?? 1) + sales;
    pending.quantity += entry.quantity;
    pending.copper += entry.copper;
    coalescedSales += sales;
    return;
  }
  if (queued.size >= maxDepth) {
    droppedSales += sales;
    if (tailDropLogged < TAIL_DROP_LOG_LIMIT) {
      tailDropLogged += 1;
      console.error(
        `market sold-volume write FIFO is at its depth cap (${queued.size} of ${maxDepth} queued): dropped ${sales} sale(s) of ${entry.itemId}${
          tailDropLogged === TAIL_DROP_LOG_LIMIT
            ? ' (further drops are counted only, see soldVolumeTailStats)'
            : ''
        }`,
      );
    }
    return;
  }
  // A fresh accumulator, never the caller's object: coalescing mutates this
  // row, and mutating what the caller handed us would be a surprise.
  const row: MarketSoldVolumeEntry = {
    itemId: entry.itemId,
    quantity: entry.quantity,
    copper: entry.copper,
    saleCount: sales,
  };
  queued.set(entry.itemId, row);
  tail = tail.then(() => {
    // Frozen here, at the head of its own link: from this point the row is on
    // the wire, so a later sale of the same item must queue a NEW entry rather
    // than change what the database is already being asked to write. Guarded on
    // identity so a link can only ever retract its own row.
    if (queued.get(row.itemId) === row) queued.delete(row.itemId);
    return write(row).catch((err: unknown) => {
      // Reported and dropped: sold volume is an observation, and losing one
      // row must never disturb a sale that already happened.
      onWriteError(err);
    });
  });
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
  const countBefore = sim.marketListings.length;
  sim.marketBuy(listingId, pid);
  // One scan, not two (the D147 hot-path note): a successful non-house buy
  // splices the whole listing out (src/sim/market.ts) and nothing else mutates
  // the book in this synchronous call, so a length drop IS this buy landing. A
  // house row survives its own sale, which marketSaleFromBuy rejects on
  // before.house regardless, so length-stable-and-house both resolve to null.
  const bought = sim.marketListings.length < countBefore;
  const entry = bought ? marketSaleFromBuy(before, null) : null;
  if (entry === null) return;
  if (classifyMarketMetricsItem(entry.itemId) === null) return;
  enqueue(entry);
}
