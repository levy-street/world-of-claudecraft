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
  buyer_account_id INT,
  seller_character_id INT,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_sales_item ON market_sales(realm, item_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS market_sales_realm_sold_at ON market_sales(realm, sold_at);
CREATE INDEX IF NOT EXISTS market_sales_buyer
  ON market_sales(buyer_character_id) WHERE buyer_character_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS market_sales_seller
  ON market_sales(seller_character_id) WHERE seller_character_id IS NOT NULL;
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
  buyerAccountId: number | null;
  sellerCharacterId: number | null;
}

export async function insertMarketSaleRow(pool: Pool, row: MarketSaleRow): Promise<void> {
  await pool.query(
    `INSERT INTO market_sales
       (realm, listing_id, item_id, quantity, total_price_copper, house,
        instanced, crafted_recipe_id, buyer_character_id, buyer_account_id,
        seller_character_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
      row.buyerAccountId,
      row.sellerCharacterId,
    ],
  );
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
// questions). 90 days of 5-minute captures is the working set the phase-3
// charts read.
export const MARKET_SNAPSHOT_RETENTION_DAYS = 90;

// Serialize the sweep across realm processes sharing one Postgres, the
// pruneUnstuckReports idiom: first process in wins the try-lock, everyone else
// no-ops until the next daily tick. Key is arbitrary but must be unique among
// the repo's advisory keys.
export const MARKET_SNAPSHOT_PRUNE_ADVISORY_KEY = 0x574f4306;

// Bounded batches, the pruneUnstuckReports idiom: each batch rides the
// market_listing_snapshots_captured index and the ladder comfortably exceeds
// the worst-case daily accrual (a few tens of thousands of rows per realm per
// day), so a sweep that falls behind one day catches up the next.
export const MARKET_SNAPSHOT_PRUNE_BATCH_SIZE = 10_000;
export const MARKET_SNAPSHOT_PRUNE_MAX_BATCHES = 10;

export async function pruneMarketListingSnapshots(pool: Pool): Promise<number> {
  const client = await pool.connect();
  let lockAcquired = false;
  let releaseError: Error | undefined;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::int) AS acquired',
      [MARKET_SNAPSHOT_PRUNE_ADVISORY_KEY],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) return 0;

    let total = 0;
    for (let batch = 0; batch < MARKET_SNAPSHOT_PRUNE_MAX_BATCHES; batch += 1) {
      const res = await client.query(
        `WITH expired AS (
           SELECT id
           FROM market_listing_snapshots
           WHERE captured_at < now() - ($1::int * INTERVAL '1 day')
           ORDER BY captured_at ASC, id ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         DELETE FROM market_listing_snapshots AS s
         USING expired
         WHERE s.id = expired.id`,
        [MARKET_SNAPSHOT_RETENTION_DAYS, MARKET_SNAPSHOT_PRUNE_BATCH_SIZE],
      );
      const deleted = res.rowCount ?? 0;
      total += deleted;
      if (deleted < MARKET_SNAPSHOT_PRUNE_BATCH_SIZE) break;
    }
    return total;
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1::int)', [
          MARKET_SNAPSHOT_PRUNE_ADVISORY_KEY,
        ]);
      } catch (err) {
        releaseError = err instanceof Error ? err : new Error(String(err));
      }
    }
    client.release(releaseError);
  }
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
