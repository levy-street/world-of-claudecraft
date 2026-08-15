// The World Market's per-seller SALE LEDGER: the itemized record behind the one
// "Sale proceeds" line the Merchant's Collect tab shows. A completed sale used to
// leave nothing but a copper total, so a seller returning to a full collection box
// could see WHAT had come back (expired listings are already itemized) but never
// WHICH listings had actually sold, or for how much. Each sale appends a row here,
// and the whole log clears with the gold it explains (market.ts marketCollect):
// this is a PENDING ledger, never a permanent sales history.
//
// A pure leaf (the market_listing_ids.ts / market_query.ts pattern): no SimContext,
// no rng, no clock. Ordering is insertion order, which is chronological within one
// collection; the sim has no wall clock to stamp (the determinism invariant) and
// needs none, because the log is drained whole rather than sorted or windowed.
//
// The log is CAPPED, because it persists in the market blob and a seller who stays
// offline across hundreds of sales would otherwise grow one unbounded row. Past the
// cap the OLDEST rows drop and `omitted` counts them, so the tab can say how many
// earlier sales it is not listing instead of silently showing a short list that does
// not add up to the proceeds. Dropping a row never drops its gold: the copper total
// lives on MarketCollection and is unaffected by anything here.

export interface MarketSaleRecord {
  itemId: string;
  count: number;
  /** Gross buyout the buyer paid for the whole stack. */
  price: number;
  /** Net copper this sale added to the collection, after the Merchant's cut. */
  proceeds: number;
  buyerName: string;
}

export interface MarketSaleLog {
  entries: MarketSaleRecord[];
  /** Sales the cap dropped. Their gold is still in the collection's copper. */
  omitted: number;
}

export const MARKET_SALE_LOG_MAX = 50;
/** Names are already server-bounded; this only fences a hand-edited save blob. */
const MAX_BUYER_NAME_LEN = 32;

export function emptySaleLog(): MarketSaleLog {
  return { entries: [], omitted: 0 };
}

export function isSaleLogEmpty(log: MarketSaleLog): boolean {
  return log.entries.length === 0 && log.omitted === 0;
}

/** Deep copy: the live log must never alias a wire payload or a save blob. */
export function cloneSaleLog(log: MarketSaleLog): MarketSaleLog {
  return { entries: log.entries.map((e) => ({ ...e })), omitted: log.omitted };
}

export function recordSale(log: MarketSaleLog, sale: MarketSaleRecord): void {
  log.entries.push({ ...sale, buyerName: sale.buyerName.slice(0, MAX_BUYER_NAME_LEN) });
  trimSaleLog(log);
}

/**
 * Fold one seller bucket's log into another (the rename/rekey merge in market.ts).
 * `from`'s rows land after `into`'s: the two buckets carry no comparable ordering,
 * and a merge only happens when a legacy name-keyed bucket is being folded into the
 * character-id bucket that supersedes it.
 */
export function mergeSaleLogs(into: MarketSaleLog, from: MarketSaleLog): void {
  into.entries.push(...from.entries.map((e) => ({ ...e })));
  into.omitted += from.omitted;
  trimSaleLog(into);
}

function trimSaleLog(log: MarketSaleLog): void {
  const over = log.entries.length - MARKET_SALE_LOG_MAX;
  if (over <= 0) return;
  log.entries.splice(0, over);
  log.omitted += over;
}

/**
 * The one load path for a persisted log. Additive: a pre-ledger save (or any
 * collection that never sold anything) carries no `sales` key at all and loads as
 * an empty log, so old blobs load unchanged. Everything else is treated as
 * untrusted blob data, the sanitizeEscrowSlot doctrine.
 */
export function sanitizeSaleLog(raw: unknown): MarketSaleLog {
  const log = emptySaleLog();
  if (!raw || typeof raw !== 'object') return log;
  const src = raw as { entries?: unknown; omitted?: unknown };
  log.omitted = nonNegativeInt(src.omitted);
  const entries = Array.isArray(src.entries) ? src.entries : [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const row = e as Partial<MarketSaleRecord>;
    if (typeof row.itemId !== 'string' || row.itemId === '') continue;
    log.entries.push({
      itemId: row.itemId,
      count: Math.max(1, nonNegativeInt(row.count)),
      price: nonNegativeInt(row.price),
      proceeds: nonNegativeInt(row.proceeds),
      buyerName:
        typeof row.buyerName === 'string' ? row.buyerName.slice(0, MAX_BUYER_NAME_LEN) : '',
    });
  }
  // A hand-edited blob can carry more rows than the cap; trimming here keeps the
  // live invariant (entries <= cap) true no matter what was on disk.
  trimSaleLog(log);
  return log;
}

function nonNegativeInt(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}
