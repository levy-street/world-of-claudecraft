// The World Market's accumulating sold-volume store: the SQL boundary.
//
// WHY IT EXISTS. The admin market dashboard could only ever report what was ON
// the book (server/admin_market_metrics.ts folds the live listing book), never
// what had actually CHANGED HANDS, and the sim carries no durable sales record
// to fold instead: `MarketCollection.sales` (src/sim/market_sale_log.ts) is a
// PENDING ledger, itemised for the seller and cleared to empty the moment they
// collect (src/sim/market.ts marketCollect). So sold volume is not a read that
// was missing, it is a fact nothing was writing down. This table is the write.
//
// WHY A DAILY ROLL-UP AND NOT A SALE LOG. Nothing here needs an individual
// sale: the dashboard asks "how much of each supply bucket moved lately". One
// accumulating row per (realm, UTC day, item id) answers that, and it bounds
// the table by realms x days x TRACKED item ids rather than by economic
// activity. A per-sale log would need its own anti-abuse budget (the
// bank_ledger row-budget story) to stay safe; a roll-up cannot be grown by
// trading harder, only by trading a new ITEM, and the tracked id set is
// derived from content tables. That is the whole growth argument.
//
// WHY ONLY TRACKED ITEMS. The writer (server/market_sold_volume.ts) records a
// sale only when its item id classifies into one of the six metrics buckets.
// An untracked id would be a row nothing ever reads, and it is what would put
// this table's size back in the hands of players. Stated here because it is a
// deliberate narrowing of "sold volume", not an oversight: this is bucket
// volume, and the readout says so.
//
// RETENTION. The prune PRIMITIVE below (`pruneMarketSoldVolumeBatch`) and its
// sweep registration wrapper (`marketSoldVolumeRetentionTable`) are now LIVE:
// server/main.ts registers `marketSoldVolumeRetentionTable(pool)` in the nightly
// retention sweep's `tables:` array, so this table is bounded. The window is a
// code constant rather than an env key because there is no operational reason to
// tune it per deployment: the readout only ever asks for a short trailing
// window, and the rows are aggregates carrying no personal data. 0 would be the
// explicit keep-forever, matching every sibling primitive.
//
// WIRED (qr-19-sold-volume-four-seam-wiring, Phase 19). All four seams now land
// together, in the order that made a partial landing dangerous:
//   1. MARKET_SOLD_VOLUME_SCHEMA is applied in the ensureSchema DDL ladder
//      (server/db.ts), so the table exists on every boot;
//   2. marketSoldVolumeRetentionTable is registered in the retention sweep's
//      `tables:` array (server/main.ts), so the table is pruned nightly;
//   3. buyWithSoldVolume (server/market_sold_volume.ts) is the market_buy
//      dispatch arm in server/game.ts, so every completed sale is observed;
//   4. configureMarketSoldVolume and configureAdminMarketSoldVolume are called
//      at boot (server/main.ts), so the observer is live and
//      AdminMarketMetrics.soldAvailable is true.
// The DDL-before-writer ordering is preserved by boot: ensureSchema runs before
// the loop accepts commands, so the writer never sees a 42P01, and the sweep
// registration lands in the same change so the table can never grow unbounded.
// tests/server/market_sold_volume.test.ts pins all four seams PRESENT (flipped
// from the all-four-absent guard), and tests/market_sold_volume_pg_integration
// proves the observer-to-database path end to end against real Postgres.

import type { RetentionTable } from './retention_sweep';

/** The pg surface these primitives need. `Pool` and `PoolClient` both satisfy it. */
export interface MarketSoldVolumeDb {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

/** One completed sale, already classified as belonging to a tracked bucket. */
export interface MarketSoldVolumeEntry {
  itemId: string;
  /** Units that changed hands (the listing's stack count). */
  quantity: number;
  /** The buyout price in copper, gross of the Merchant's cut. */
  copper: number;
  /**
   * How many SALES this entry stands for. Absent means one, which is what a
   * single observed sale produces. The writer's tail coalesces several queued
   * sales of one item into one entry (server/market_sold_volume.ts), and every
   * column here is an accumulator, so the folded entry must carry its own count
   * or sale_count silently under-counts by exactly what coalescing absorbed.
   */
  saleCount?: number;
}

/** One item's folded totals over the requested window. */
export interface MarketSoldVolumeRow {
  itemId: string;
  saleCount: number;
  quantity: number;
  copper: number;
}

// Additive and idempotent: ensureSchema re-applies this at every boot under the
// advisory lock, so re-running it over a populated table is a no-op. BIGINT on
// every counter because these accumulate for the life of the retention window
// and an INT would be a silent overflow on a busy realm's copper column.
//
// The `day` index exists for the prune: the primary key leads with `realm`, so
// a `WHERE day < cutoff ... ORDER BY day` batch would plan a full sort per
// batch without it (the retention SQL rule in server/CLAUDE.md).
export const MARKET_SOLD_VOLUME_SCHEMA = `
CREATE TABLE IF NOT EXISTS market_sold_volume (
  realm TEXT NOT NULL,
  day DATE NOT NULL,
  item_id TEXT NOT NULL,
  sale_count BIGINT NOT NULL DEFAULT 0,
  quantity BIGINT NOT NULL DEFAULT 0,
  copper BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (realm, day, item_id)
);
CREATE INDEX IF NOT EXISTS market_sold_volume_day ON market_sold_volume(day);
`;

/**
 * How long a day's roll-up is kept. Comfortably longer than the readout window
 * below, so an operator widening the readout does not immediately fall off the
 * end of the data.
 */
export const MARKET_SOLD_VOLUME_RETENTION_DAYS = 90;

/** The trailing window the admin readout folds. */
export const MARKET_SOLD_VOLUME_WINDOW_DAYS = 7;

// The day is stamped SERVER-SIDE from the database clock in UTC, never from the
// process clock: realm processes are the only writers, but they restart, drift,
// and (during a deploy) overlap, and two processes disagreeing about which day
// a sale belongs to would split one day's total across two rows.
const RECORD_SQL = `
INSERT INTO market_sold_volume (realm, day, item_id, sale_count, quantity, copper)
VALUES ($1, (now() AT TIME ZONE 'utc')::date, $2, $5, $3, $4)
ON CONFLICT (realm, day, item_id) DO UPDATE
   SET sale_count = market_sold_volume.sale_count + EXCLUDED.sale_count,
       quantity = market_sold_volume.quantity + EXCLUDED.quantity,
       copper = market_sold_volume.copper + EXCLUDED.copper
`;

/** At least one sale, always a whole number: the count reaching SQL. */
function salesOf(entry: MarketSoldVolumeEntry): number {
  const raw = entry.saleCount ?? 1;
  return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
}

/** Fold one completed sale (or one coalesced run of them) into its
 *  (realm, day, item) row. */
export async function recordMarketSoldVolumeRow(
  db: MarketSoldVolumeDb,
  realm: string,
  entry: MarketSoldVolumeEntry,
): Promise<void> {
  await db.query(RECORD_SQL, [realm, entry.itemId, entry.quantity, entry.copper, salesOf(entry)]);
}

/**
 * The bounded-connection runner the sale write binds through. Shaped exactly
 * like db.ts `runWithStatementTimeout` so the day-one wiring can pass that
 * function itself (pinned as a type assignment in
 * tests/server/market_sold_volume.test.ts); declared here rather than imported
 * so this SQL boundary keeps its injected-db seam and never drags the pool into
 * a unit test.
 */
export type MarketSoldVolumeBoundedRunner = <T>(
  timeoutMs: number,
  fn: (query: MarketSoldVolumeDb['query']) => Promise<T>,
) => Promise<T>;

/**
 * The sale write's own statement allowance, NOT the ambient 15s pool default.
 * Adopted from the CLEAR_ITEM_NAME_PROBE_TIMEOUT_MS precedent
 * (server/clear_item_name_db.ts) with the same basis, which transfers exactly:
 * this is one single-row upsert seeking a three-column primary key, so its
 * intended cost is milliseconds and its degraded cost must not be a pooled
 * client pinned for the full default while the 20 Hz loop keeps queueing sales
 * behind it. Two seconds is generous for a PK upsert and an order of magnitude
 * under the default.
 */
export const MARKET_SOLD_VOLUME_WRITE_TIMEOUT_MS = 2_000;

/**
 * How long the write may WAIT for a row lock before giving up, the standing
 * value every marketplace guard already uses (ESCROW_LOCK_TIMEOUT_MS,
 * server/woc_market_db.ts). statement_timeout alone does not bound a lock wait
 * usefully here: two realm processes upserting the same (realm, day, item) row
 * genuinely contend, and a sold-volume row is an OBSERVATION, so waiting is
 * always worse than losing it. A timed-out write reports and drops like any
 * other failure.
 */
export const MARKET_SOLD_VOLUME_LOCK_TIMEOUT_MS = 2_000;

/**
 * `recordMarketSoldVolumeRow` under both bounds above. `run` opens the
 * transaction and applies the statement allowance; the lock bound is SET LOCAL
 * inside it, which is why it must be a transactional runner and not a bare
 * pool query (a pool hands each query a different connection, so SET LOCAL
 * would apply to nothing). The interpolated value is a module constant, never
 * caller input, matching how db.ts sets statement_timeout.
 */
export async function recordMarketSoldVolumeRowBounded(
  run: MarketSoldVolumeBoundedRunner,
  realm: string,
  entry: MarketSoldVolumeEntry,
): Promise<void> {
  await run(MARKET_SOLD_VOLUME_WRITE_TIMEOUT_MS, async (query) => {
    await query(`SET LOCAL lock_timeout = ${MARKET_SOLD_VOLUME_LOCK_TIMEOUT_MS}`);
    await query(RECORD_SQL, [realm, entry.itemId, entry.quantity, entry.copper, salesOf(entry)]);
  });
}

const READ_SQL = `
SELECT item_id,
       SUM(sale_count) AS sale_count,
       SUM(quantity) AS quantity,
       SUM(copper) AS copper
  FROM market_sold_volume
 WHERE realm = $1
   AND day >= ((now() AT TIME ZONE 'utc')::date - ($2::int - 1))
 GROUP BY item_id
`;

// pg returns BIGINT as a STRING (it does not fit a JS number in general), so
// every counter is parsed here. Forwarding the raw value would concatenate
// where the readout means to add, and the bug would only appear once a bucket
// held more than one item.
function bigintToNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Per-item totals for this realm over the trailing `windowDays` UTC days,
 * today inclusive. A window of 1 is today alone.
 */
export async function readMarketSoldVolumeSince(
  db: MarketSoldVolumeDb,
  realm: string,
  windowDays: number,
): Promise<MarketSoldVolumeRow[]> {
  const days = Math.max(1, Math.floor(windowDays));
  const res = await db.query(READ_SQL, [realm, days]);
  return res.rows.map((row) => ({
    itemId: String(row.item_id),
    saleCount: bigintToNumber(row.sale_count),
    quantity: bigintToNumber(row.quantity),
    copper: bigintToNumber(row.copper),
  }));
}

// Batched via a LIMIT subquery, oldest day first: that ordering is the sweep's
// forward-progress guarantee (a failed run re-attempts the same oldest rows).
// The ORDER BY is affordable only because market_sold_volume_day exists.
const PRUNE_SQL = `
DELETE FROM market_sold_volume
 WHERE (realm, day, item_id) IN (
   SELECT realm, day, item_id
     FROM market_sold_volume
    WHERE day < ((now() AT TIME ZONE 'utc')::date - $1::int)
    ORDER BY day ASC
    LIMIT $2)
`;

/** One bounded prune batch. A window of 0 (or any non-positive) keeps forever. */
export async function pruneMarketSoldVolumeBatch(
  db: MarketSoldVolumeDb,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await db.query(PRUNE_SQL, [days, Math.max(1, Math.floor(batchSize))]);
  return res.rowCount ?? 0;
}

/**
 * The sweep registration, ready to drop into the `tables` array in
 * server/main.ts: `marketSoldVolumeRetentionTable(pool),`. NOT YET REGISTERED
 * (see RETENTION in the header): this is the line the wiring adds, not a live
 * one. Typed as the sweep's own `RetentionTable`, so a drift in that contract
 * fails here at compile time rather than at the registration site.
 */
export function marketSoldVolumeRetentionTable(
  db: MarketSoldVolumeDb,
  retentionDays: number = MARKET_SOLD_VOLUME_RETENTION_DAYS,
): RetentionTable {
  return {
    name: 'market_sold_volume',
    pruneBatch: (batchSize: number) => pruneMarketSoldVolumeBatch(db, retentionDays, batchSize),
  };
}
