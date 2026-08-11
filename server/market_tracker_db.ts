// World Market tracker storage (SQL only): completed-sale history and periodic
// listing-book snapshots, the data the internal market analytics tool charts
// price history, margins, and volume from. The DDL (MARKET_TRACKER_SCHEMA) is
// appended to ensureSchema() in db.ts like RATELIMIT_SCHEMA / MAPS_SCHEMA; every
// function takes the shared `pool` by INJECTION and imports `pg` only as
// `import type`, so this module never imports db.ts and the db.ts <->
// market_tracker_db.ts pair stays cycle-free (the ratelimit_db.ts pattern).
//
// The game loop never awaits these writes: server/market_tracker.ts (the
// observer) enqueues them fire-and-forget onto its FIFO tail, mirroring
// server/bank_ledger.ts. Nothing here is an authority over gameplay; the market
// blob in world_state stays the source of truth and these tables are derived,
// append-only history.

import type { Pool } from 'pg';

// Deliberately NO foreign keys onto characters(id):
// - sale rows are economy history and must survive character deletion (a
//   deleted seller's past sales still price the item),
// - a listing's sellerKey is only USUALLY a character id: legacy listings can
//   be keyed by character name, and a headless/bot seller can be keyed by a
//   sim entity id that never had a characters row, so an FK would refuse
//   exactly the rows the observer most needs to keep.
// Anonymize-on-delete is therefore explicit: deleteCharacter (db.ts) calls
// anonymizeMarketSalesForCharacter below, served by the two partial indexes so
// a user-facing delete never sequential-scans this indefinitely-growing table.
// buyer/seller ids are internal-only analytics fields and MUST NOT be exposed
// on any player-facing surface (flip-finder etc. aggregate them away).
//
// realm carries no DEFAULT deliberately, matching bank_ledger: the
// interpolated-default pattern is last-boot-wins across realm processes, so
// every insert passes realm explicitly.
//
// house sales (the Merchant's infinite standing stock, seller_character_id
// NULL, house TRUE) are recorded too: they are real purchases at known prices
// and a permanent ask ceiling the flip finder must see. The house flag, not a
// NULL seller, is what distinguishes them from a deleted/legacy seller.
//
// Retention: market_sales is KEEP-FOREVER by design (the whole point is
// long-range price history, and sale volume bounds growth to megabytes a
// year); it deliberately does NOT register with the retention sweep. Revisit
// with a fold-into-rollups if volume ever grows past that. The snapshot table
// IS swept nightly: see pruneMarketListingSnapshotsBatch below, registered in
// main.ts under the MARKET_SNAPSHOT_RETENTION_DAYS config knob.
export const MARKET_TRACKER_SCHEMA = `
CREATE TABLE IF NOT EXISTS market_sales (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  listing_id BIGINT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INT NOT NULL,
  total_price_copper BIGINT NOT NULL,
  house BOOLEAN NOT NULL,
  instanced BOOLEAN NOT NULL,
  crafted_recipe_id TEXT,
  buyer_character_id INT,
  seller_character_id INT,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_sales_item ON market_sales(realm, item_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS market_sales_realm_sold_at ON market_sales(realm, sold_at);
CREATE INDEX IF NOT EXISTS market_sales_buyer
  ON market_sales(buyer_character_id) WHERE buyer_character_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS market_sales_seller
  ON market_sales(seller_character_id) WHERE seller_character_id IS NOT NULL;
-- Pre-merge builds of this schema carried a buyer_account_id column that
-- nothing read and the anonymize path never cleared; drop it wherever it was
-- applied so a deleted character's purchases cannot stay account-linkable.
ALTER TABLE market_sales DROP COLUMN IF EXISTS buyer_account_id;
CREATE TABLE IF NOT EXISTS market_listing_snapshots (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  item_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  listing_count INT NOT NULL,
  total_quantity INT NOT NULL,
  lowest_ask_total_copper BIGINT NOT NULL,
  lowest_ask_quantity INT NOT NULL
);
CREATE INDEX IF NOT EXISTS market_listing_snapshots_item
  ON market_listing_snapshots(realm, item_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS market_listing_snapshots_captured
  ON market_listing_snapshots(captured_at);
CREATE TABLE IF NOT EXISTS market_alerts (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  item_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  direction TEXT NOT NULL,
  threshold_copper BIGINT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_account_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_triggered_at TIMESTAMPTZ,
  last_value_copper BIGINT,
  last_met BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS market_alerts_realm_active ON market_alerts(realm, active);
ALTER TABLE market_alerts ADD COLUMN IF NOT EXISTS last_met BOOLEAN NOT NULL DEFAULT FALSE;
`;

// One append-only row per completed World Market purchase. quantity is the
// whole stack (a buy is always the full listing); the per-unit price is
// derived in queries as total_price_copper / quantity, never stored, so the
// two integers stay exact. seller_character_id is null for house stock and for
// the legacy name-keyed listings whose sellerKey is not a character id.
export interface MarketSaleRow {
  realm: string;
  listingId: number;
  itemId: string;
  quantity: number;
  totalPriceCopper: number;
  house: boolean;
  instanced: boolean;
  craftedRecipeId: string | null;
  buyerCharacterId: number | null;
  sellerCharacterId: number | null;
}

// The seller id is validated at insert time: a sellerKey is only USUALLY a
// character id (a stale blob row can carry a sim entity id that never had a
// characters row), so the scalar subquery maps a candidate matching no live
// character to NULL instead of recording a bogus attribution or failing the
// insert. Buyer ids come from the live session, so they are trusted directly.
export async function insertMarketSaleRow(pool: Pool, row: MarketSaleRow): Promise<void> {
  await pool.query(
    `INSERT INTO market_sales
       (realm, listing_id, item_id, quantity, total_price_copper, house,
        instanced, crafted_recipe_id, buyer_character_id,
        seller_character_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             (SELECT id FROM characters WHERE id = $10))`,
    [
      row.realm,
      row.listingId,
      row.itemId,
      row.quantity,
      row.totalPriceCopper,
      row.house,
      row.instanced,
      row.craftedRecipeId,
      row.buyerCharacterId,
      row.sellerCharacterId,
    ],
  );
}

// The reconcile heals the two windows the delete-time anonymize cannot cover,
// and they need different shapes because market_sales is keep-forever:
//
// (a) A sale row flushed off the FIFO after its character was deleted. That
//     race is seconds wide, so the RECURRING boot/daily pass below scopes to
//     the last day of sold_at and rides market_sales_realm_sold_at, staying
//     flat no matter how large the table grows. An unscoped anti-join here
//     would eventually exceed the pool's 15s statement_timeout and the heal
//     would silently stop running, exactly the case it exists for.
// (b) Rows from a build without the anonymize call (rollback or a mixed fleet
//     on the shared Postgres). That is a one-off backfill over the whole
//     table, so it runs as the BATCHED primitive further below (the
//     pruneMarketListingSnapshotsBatch shape) at boot, keeping every
//     statement bounded by its LIMIT.
//
// Ids are validated against a live characters row at insert time (above), so
// any id with no characters row here is a deleted character, never a
// legitimate foreign key. All passes are idempotent and safe to run
// concurrently across realm processes, so no advisory lock is needed.
export async function reconcileMarketSalesCharacterIdsRecent(pool: Pool): Promise<void> {
  await pool.query(
    `UPDATE market_sales SET buyer_character_id = NULL
     WHERE buyer_character_id IS NOT NULL
       AND sold_at > now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = buyer_character_id)`,
  );
  await pool.query(
    `UPDATE market_sales SET seller_character_id = NULL
     WHERE seller_character_id IS NOT NULL
       AND sold_at > now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = seller_character_id)`,
  );
}

// One bounded slice of the full-table backfill for window (b) above. Returns
// the number of rows healed in this batch; the caller loops until it reports
// zero. Each UPDATE touches at most batchSize rows selected through the
// partial indexes, so no single statement can approach the pool's
// statement_timeout regardless of table size.
export async function reconcileMarketSalesCharacterIdsBatch(
  pool: Pool,
  batchSize: number,
): Promise<number> {
  const limit = Math.max(1, Math.floor(batchSize));
  const buyers = await pool.query(
    `UPDATE market_sales SET buyer_character_id = NULL
     WHERE id IN (
       SELECT id FROM market_sales
        WHERE buyer_character_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = buyer_character_id)
        LIMIT $1)`,
    [limit],
  );
  const sellers = await pool.query(
    `UPDATE market_sales SET seller_character_id = NULL
     WHERE id IN (
       SELECT id FROM market_sales
        WHERE seller_character_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = seller_character_id)
        LIMIT $1)`,
    [limit],
  );
  return (buyers.rowCount ?? 0) + (sellers.rowCount ?? 0);
}

// One row per item with at least one PLAYER listing at capture time (house
// stock is a build constant, readable from MARKET_HOUSE_STOCK at query time,
// so persisting it every tick would only repeat itself). The cheapest-by-unit
// stack is stored as its exact pair (total copper, quantity) so the derived
// unit price loses no precision.
export interface MarketListingSnapshotRow {
  realm: string;
  itemId: string;
  listingCount: number;
  totalQuantity: number;
  lowestAskTotalCopper: number;
  lowestAskQuantity: number;
}

// Bound the parameter count of the batched insert: 7 binds per row, so 200
// rows is 1400 parameters, far under the driver's limit while keeping the
// snapshot a handful of statements even on an unusually full book.
const SNAPSHOT_INSERT_CHUNK = 200;

// capturedAt is computed ONCE per snapshot tick by the caller and passed to
// every chunk explicitly: with the column DEFAULT, chunks of one tick would
// land in separate implicit transactions with different now() values,
// breaking the "the book at time T" grouping the charts rely on.
export async function insertMarketListingSnapshotRows(
  pool: Pool,
  rows: MarketListingSnapshotRow[],
  capturedAt: Date,
): Promise<void> {
  for (let start = 0; start < rows.length; start += SNAPSHOT_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + SNAPSHOT_INSERT_CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const base = i * 7;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      );
      const row = chunk[i];
      params.push(
        row.realm,
        row.itemId,
        capturedAt,
        row.listingCount,
        row.totalQuantity,
        row.lowestAskTotalCopper,
        row.lowestAskQuantity,
      );
    }
    await pool.query(
      `INSERT INTO market_listing_snapshots
         (realm, item_id, captured_at, listing_count, total_quantity,
          lowest_ask_total_copper, lowest_ask_quantity)
       VALUES ${values.join(', ')}`,
      params,
    );
  }
}

// Snapshots are a rolling window: beyond the horizon the per-capture rows stop
// earning their storage (sales history, which is kept, answers the long-range
// questions). One bounded batch per call in the pruneChatLogsBatch shape: the
// caller is the nightly retention sweep (registered in main.ts), which owns
// the advisory lock, the once-per-day clock, the per-run row budget, and the
// pruned-N observability line, so none of that is re-implemented here. The
// LIMIT subquery rides the market_listing_snapshots_captured index; retention
// days come from config (MARKET_SNAPSHOT_RETENTION_DAYS, 0 = keep forever).
export async function pruneMarketListingSnapshotsBatch(
  pool: Pool,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  // A fractional value must clamp to at least one day, never floor to '0 days'.
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await pool.query(
    `DELETE FROM market_listing_snapshots
      WHERE id IN (
        SELECT id FROM market_listing_snapshots
         WHERE captured_at < now() - ($1 || ' days')::interval
         ORDER BY captured_at
         LIMIT $2)`,
    [String(days), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}

// Explicit anonymize-on-delete (there is no FK to do it for us, see the schema
// comment): null out the internal character-id columns for a deleted
// character, leaving the economy row itself intact. Both UPDATEs are served by
// the partial indexes above.
export async function anonymizeMarketSalesForCharacter(
  pool: Pool,
  characterId: number,
): Promise<void> {
  await pool.query(
    'UPDATE market_sales SET buyer_character_id = NULL WHERE buyer_character_id = $1',
    [characterId],
  );
  await pool.query(
    'UPDATE market_sales SET seller_character_id = NULL WHERE seller_character_id = $1',
    [characterId],
  );
}

// ---------------------------------------------------------------------------
// Analytics reads for the admin market tracker endpoints (server/admin.ts).
// All realm-scoped; every read rides market_sales_realm_sold_at,
// market_sales_item, or market_listing_snapshots_item. House rows are
// EXCLUDED from every price statistic: the Merchant's standing stock sells at
// fixed build constants, so folding it in would drag every median toward
// vendor pricing. Unit prices are derived (total / quantity) at read time so
// the stored integers stay exact; percentile_cont needs float math anyway.
// Buyer/seller ids are deliberately absent from every row shape here: these
// feeds are designed to be exposable to players later, and the internal id
// columns must never ride along.

// The per-item aggregate over a sliding window, the input to the overview,
// flip finder, and movers. offsetHours shifts the window back in time
// (offsetHours=24, windowHours=24 reads "the 24h before the last 24h"), which
// is how the movers compare two adjacent windows with one query shape.
export interface MarketSaleStatsRow {
  itemId: string;
  sales: number;
  quantity: number;
  medianUnitPriceCopper: number;
  avgUnitPriceCopper: number;
  minUnitPriceCopper: number;
  maxUnitPriceCopper: number;
}

export async function marketSaleStatsByItem(
  pool: Pool,
  realm: string,
  windowHours: number,
  offsetHours = 0,
): Promise<MarketSaleStatsRow[]> {
  const window = Math.max(1, Math.floor(windowHours));
  const offset = Math.max(0, Math.floor(offsetHours));
  const res = await pool.query(
    `SELECT item_id,
            count(*)::int AS sales,
            sum(quantity)::bigint AS quantity,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY total_price_copper::float8 / quantity)
              AS median_unit,
            avg(total_price_copper::float8 / quantity) AS avg_unit,
            min(total_price_copper::float8 / quantity) AS min_unit,
            max(total_price_copper::float8 / quantity) AS max_unit
       FROM market_sales
      WHERE realm = $1 AND house = FALSE
        AND sold_at > now() - (($2::int + $3::int) * INTERVAL '1 hour')
        AND sold_at <= now() - ($3::int * INTERVAL '1 hour')
      GROUP BY item_id`,
    [realm, window, offset],
  );
  return res.rows.map((row) => ({
    itemId: row.item_id,
    sales: Number(row.sales),
    quantity: Number(row.quantity),
    medianUnitPriceCopper: Number(row.median_unit),
    avgUnitPriceCopper: Number(row.avg_unit),
    minUnitPriceCopper: Number(row.min_unit),
    maxUnitPriceCopper: Number(row.max_unit),
  }));
}

// One item's sale price time series, bucketed server-side so the wire carries
// chart points, never raw rows. The bucket is validated against this
// whitelist and passed to date_trunc as a bind parameter, so no caller string
// ever reaches the SQL text.
export const MARKET_HISTORY_BUCKETS = ['hour', 'day', 'week'] as const;
export type MarketHistoryBucket = (typeof MARKET_HISTORY_BUCKETS)[number];

export interface MarketPriceHistoryRow {
  bucketStart: Date;
  sales: number;
  quantity: number;
  medianUnitPriceCopper: number;
  avgUnitPriceCopper: number;
  minUnitPriceCopper: number;
  maxUnitPriceCopper: number;
}

export async function marketItemPriceHistory(
  pool: Pool,
  realm: string,
  itemId: string,
  bucket: MarketHistoryBucket,
  sinceDays: number,
): Promise<MarketPriceHistoryRow[]> {
  if (!MARKET_HISTORY_BUCKETS.includes(bucket)) throw new Error(`bad bucket: ${bucket}`);
  const days = Math.max(1, Math.floor(sinceDays));
  const res = await pool.query(
    `SELECT date_trunc($4, sold_at) AS bucket_start,
            count(*)::int AS sales,
            sum(quantity)::bigint AS quantity,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY total_price_copper::float8 / quantity)
              AS median_unit,
            avg(total_price_copper::float8 / quantity) AS avg_unit,
            min(total_price_copper::float8 / quantity) AS min_unit,
            max(total_price_copper::float8 / quantity) AS max_unit
       FROM market_sales
      WHERE realm = $1 AND item_id = $2 AND house = FALSE
        AND sold_at > now() - ($3::int * INTERVAL '1 day')
      GROUP BY bucket_start
      ORDER BY bucket_start`,
    [realm, itemId, days, bucket],
  );
  return res.rows.map((row) => ({
    bucketStart: row.bucket_start,
    sales: Number(row.sales),
    quantity: Number(row.quantity),
    medianUnitPriceCopper: Number(row.median_unit),
    avgUnitPriceCopper: Number(row.avg_unit),
    minUnitPriceCopper: Number(row.min_unit),
    maxUnitPriceCopper: Number(row.max_unit),
  }));
}

// One item's lowest-ask time series from the listing snapshots, bucketed the
// same way (min of the derived unit ask per bucket).
export interface MarketAskHistoryRow {
  bucketStart: Date;
  lowestAskUnitCopper: number;
  avgListingCount: number;
  avgTotalQuantity: number;
}

export async function marketItemAskHistory(
  pool: Pool,
  realm: string,
  itemId: string,
  bucket: MarketHistoryBucket,
  sinceDays: number,
): Promise<MarketAskHistoryRow[]> {
  if (!MARKET_HISTORY_BUCKETS.includes(bucket)) throw new Error(`bad bucket: ${bucket}`);
  const days = Math.max(1, Math.floor(sinceDays));
  const res = await pool.query(
    `SELECT date_trunc($4, captured_at) AS bucket_start,
            min(lowest_ask_total_copper::float8 / lowest_ask_quantity) AS lowest_unit,
            avg(listing_count)::float8 AS avg_listings,
            avg(total_quantity)::float8 AS avg_quantity
       FROM market_listing_snapshots
      WHERE realm = $1 AND item_id = $2
        AND captured_at > now() - ($3::int * INTERVAL '1 day')
      GROUP BY bucket_start
      ORDER BY bucket_start`,
    [realm, itemId, days, bucket],
  );
  return res.rows.map((row) => ({
    bucketStart: row.bucket_start,
    lowestAskUnitCopper: Number(row.lowest_unit),
    avgListingCount: Number(row.avg_listings),
    avgTotalQuantity: Number(row.avg_quantity),
  }));
}

// The current book: every item's row from the most recent capture. All rows
// of one capture share one captured_at (insertMarketListingSnapshotRows), so
// the latest capture is exactly the rows at max(captured_at). An item absent
// here has no player listings right now.
export interface MarketLatestSnapshotRow {
  itemId: string;
  capturedAt: Date;
  listingCount: number;
  totalQuantity: number;
  lowestAskTotalCopper: number;
  lowestAskQuantity: number;
}

export async function marketLatestSnapshots(
  pool: Pool,
  realm: string,
): Promise<MarketLatestSnapshotRow[]> {
  const res = await pool.query(
    `SELECT item_id, captured_at, listing_count, total_quantity,
            lowest_ask_total_copper, lowest_ask_quantity
       FROM market_listing_snapshots
      WHERE realm = $1
        AND captured_at = (
          SELECT max(captured_at) FROM market_listing_snapshots WHERE realm = $1)`,
    [realm],
  );
  return res.rows.map((row) => ({
    itemId: row.item_id,
    capturedAt: row.captured_at,
    listingCount: Number(row.listing_count),
    totalQuantity: Number(row.total_quantity),
    lowestAskTotalCopper: Number(row.lowest_ask_total_copper),
    lowestAskQuantity: Number(row.lowest_ask_quantity),
  }));
}

// One item's most recent individual sales for the detail page ticker. House
// rows are included here (flagged): "someone bought 5 from the Merchant at
// 140c" is real demand signal even though it never moves the player median.
export interface MarketRecentSaleRow {
  soldAt: Date;
  quantity: number;
  totalPriceCopper: number;
  house: boolean;
  instanced: boolean;
  craftedRecipeId: string | null;
}

export async function marketRecentSales(
  pool: Pool,
  realm: string,
  itemId: string,
  limit: number,
): Promise<MarketRecentSaleRow[]> {
  const capped = Math.min(100, Math.max(1, Math.floor(limit)));
  const res = await pool.query(
    `SELECT sold_at, quantity, total_price_copper, house, instanced, crafted_recipe_id
       FROM market_sales
      WHERE realm = $1 AND item_id = $2
      ORDER BY sold_at DESC
      LIMIT $3`,
    [realm, itemId, capped],
  );
  return res.rows.map((row) => ({
    soldAt: row.sold_at,
    quantity: Number(row.quantity),
    totalPriceCopper: Number(row.total_price_copper),
    house: row.house,
    instanced: row.instanced,
    craftedRecipeId: row.crafted_recipe_id,
  }));
}

// ---------------------------------------------------------------------------
// Price alerts: standing operator config, evaluated by the snapshot observer
// (server/market_tracker.ts) each capture tick against the lowest listed unit
// ask. v1 supports the one actionable metric ('lowest_ask'); the metric column
// exists so a median-based alert can land later without a table change. The
// created_by_account_id column is internal audit metadata and is deliberately
// absent from the read row shape, matching the tracker's no-identity contract.

export const MARKET_ALERT_METRIC = 'lowest_ask';
export const MARKET_ALERT_DIRECTIONS = ['below', 'above'] as const;
export type MarketAlertDirection = (typeof MARKET_ALERT_DIRECTIONS)[number];

export interface MarketAlertRow {
  id: number;
  itemId: string;
  metric: string;
  direction: MarketAlertDirection;
  thresholdCopper: number;
  active: boolean;
  createdAt: Date;
  lastTriggeredAt: Date | null;
  lastValueCopper: number | null;
}

export async function listMarketAlerts(pool: Pool, realm: string): Promise<MarketAlertRow[]> {
  const res = await pool.query(
    `SELECT id, item_id, metric, direction, threshold_copper, active,
            created_at, last_triggered_at, last_value_copper
       FROM market_alerts
      WHERE realm = $1
      ORDER BY id`,
    [realm],
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    itemId: row.item_id,
    metric: row.metric,
    direction: row.direction,
    thresholdCopper: Number(row.threshold_copper),
    active: row.active,
    createdAt: row.created_at,
    lastTriggeredAt: row.last_triggered_at,
    lastValueCopper: row.last_value_copper === null ? null : Number(row.last_value_copper),
  }));
}

export async function insertMarketAlert(
  pool: Pool,
  alert: {
    realm: string;
    itemId: string;
    direction: MarketAlertDirection;
    thresholdCopper: number;
    createdByAccountId: number | null;
  },
): Promise<number> {
  const res = await pool.query(
    `INSERT INTO market_alerts
       (realm, item_id, metric, direction, threshold_copper, created_by_account_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      alert.realm,
      alert.itemId,
      MARKET_ALERT_METRIC,
      alert.direction,
      alert.thresholdCopper,
      alert.createdByAccountId,
    ],
  );
  return Number(res.rows[0].id);
}

export async function deleteMarketAlert(pool: Pool, realm: string, id: number): Promise<boolean> {
  const res = await pool.query('DELETE FROM market_alerts WHERE realm = $1 AND id = $2', [
    realm,
    id,
  ]);
  return (res.rowCount ?? 0) > 0;
}

// The evaluation tick's working set: active lowest-ask alerts only, the
// minimal columns the pure condition check needs.
export interface ActiveMarketAlert {
  id: number;
  itemId: string;
  direction: MarketAlertDirection;
  thresholdCopper: number;
  // Whether the condition held on the PREVIOUS evaluation: the edge detector.
  // An alert fires only on a false -> true transition, so "Last fired" records
  // the crossing instead of re-stamping every capture while the condition
  // holds; it re-arms when a capture sees the condition clear.
  lastMet: boolean;
}

export async function loadActiveMarketAlerts(
  pool: Pool,
  realm: string,
): Promise<ActiveMarketAlert[]> {
  const res = await pool.query(
    `SELECT id, item_id, direction, threshold_copper, last_met
       FROM market_alerts
      WHERE realm = $1 AND active AND metric = $2`,
    [realm, MARKET_ALERT_METRIC],
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    itemId: row.item_id,
    direction: row.direction,
    thresholdCopper: Number(row.threshold_copper),
    lastMet: Boolean(row.last_met),
  }));
}

export async function markMarketAlertTriggered(
  pool: Pool,
  id: number,
  valueCopper: number,
): Promise<void> {
  await pool.query(
    `UPDATE market_alerts
        SET last_triggered_at = now(), last_value_copper = $2, last_met = TRUE
      WHERE id = $1`,
    [id, Math.round(valueCopper)],
  );
}

// Re-arm alerts whose condition a capture saw clear (or whose item left the
// book entirely): the next time the condition is met counts as a new crossing.
export async function rearmMarketAlerts(pool: Pool, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query('UPDATE market_alerts SET last_met = FALSE WHERE id = ANY($1)', [ids]);
}
