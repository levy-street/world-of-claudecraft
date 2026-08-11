// Opt-in real-Postgres coverage for the World Market tracker SQL: the DDL, the
// seller-validating sale insert, the anonymize and reconcile UPDATEs, and the
// snapshot retention batch. The default suite stays DB-free (every SQL
// assertion there is string matching against mocks); set TEST_DATABASE_URL to
// execute the production statements, the play_session_retention_integration
// idiom. Plan-shape assertions are deliberately absent: at test cardinality
// the planner prefers a seq scan regardless of the partial indexes, so a plan
// pin here would only be noise.

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anonymizeMarketSalesForCharacter,
  insertMarketListingSnapshotRows,
  insertMarketSaleRow,
  MARKET_TRACKER_SCHEMA,
  type MarketSaleRow,
  pruneMarketListingSnapshotsBatch,
  reconcileMarketSalesCharacterIdsBatch,
  reconcileMarketSalesCharacterIdsRecent,
} from '../server/market_tracker_db';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'market_tracker_integration_test';
const describeDb = DB_URL ? describe : describe.skip;

describeDb('market tracker storage (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    const db = await scopedClient();
    try {
      // Minimal shadow of the characters table the seller-validating insert
      // subquery and the reconcile UPDATEs read.
      await db.query(`
        CREATE TABLE characters (
          id SERIAL PRIMARY KEY,
          name TEXT,
          realm TEXT NOT NULL DEFAULT 'eastbrook'
        );
      `);
      await db.query(MARKET_TRACKER_SCHEMA);
      // Re-running the whole DDL against populated catalogs must be a no-op.
      await db.query(MARKET_TRACKER_SCHEMA);
    } finally {
      db.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  beforeEach(async () => {
    const db = await scopedClient();
    try {
      await db.query(
        'TRUNCATE market_sales, market_listing_snapshots, characters RESTART IDENTITY CASCADE',
      );
    } finally {
      db.release();
    }
  });

  async function scopedClient() {
    const client = await pool.connect();
    await client.query(`SET search_path TO ${SCHEMA}`);
    await client.query("SET TIME ZONE 'UTC'");
    return client;
  }

  function scopedPool(): Pool {
    return {
      connect: scopedClient,
      query: async (text: string, values?: unknown[]) => {
        const client = await scopedClient();
        try {
          return await client.query(text, values);
        } finally {
          client.release();
        }
      },
    } as unknown as Pool;
  }

  async function insertCharacter(name: string): Promise<number> {
    const db = await scopedClient();
    try {
      return Number(
        (await db.query('INSERT INTO characters (name) VALUES ($1) RETURNING id', [name])).rows[0]
          .id,
      );
    } finally {
      db.release();
    }
  }

  function saleRow(over: Partial<MarketSaleRow> = {}): MarketSaleRow {
    return {
      realm: 'eastbrook',
      listingId: 5001,
      itemId: 'wolf_fang',
      quantity: 5,
      totalPriceCopper: 1000,
      house: false,
      instanced: false,
      craftedRecipeId: null,
      buyerCharacterId: null,
      sellerCharacterId: null,
      ...over,
    };
  }

  async function sellerIds(): Promise<(number | null)[]> {
    const db = await scopedClient();
    try {
      const res = await db.query('SELECT seller_character_id FROM market_sales ORDER BY id');
      return res.rows.map((row) =>
        row.seller_character_id === null ? null : Number(row.seller_character_id),
      );
    } finally {
      db.release();
    }
  }

  it('the sale insert keeps a live seller id and nulls a stale or entity-id key', async () => {
    const seller = await insertCharacter('Sellera');
    const buyer = await insertCharacter('Buyerb');
    await insertMarketSaleRow(
      scopedPool(),
      saleRow({ sellerCharacterId: seller, buyerCharacterId: buyer }),
    );
    // A candidate with no characters row (a stale blob key or a sim entity
    // id) must land as NULL instead of failing the insert or standing as a
    // bogus attribution.
    await insertMarketSaleRow(
      scopedPool(),
      saleRow({ listingId: 5002, sellerCharacterId: 999999 }),
    );
    expect(await sellerIds()).toEqual([seller, null]);
  });

  it('anonymize nulls exactly the deleted character across both columns', async () => {
    const doomed = await insertCharacter('Doomed');
    const bystander = await insertCharacter('Bystander');
    await insertMarketSaleRow(
      scopedPool(),
      saleRow({ sellerCharacterId: doomed, buyerCharacterId: bystander }),
    );
    await insertMarketSaleRow(
      scopedPool(),
      saleRow({ listingId: 5002, sellerCharacterId: bystander, buyerCharacterId: doomed }),
    );

    await anonymizeMarketSalesForCharacter(scopedPool(), doomed);

    const db = await scopedClient();
    try {
      const res = await db.query(
        'SELECT buyer_character_id, seller_character_id FROM market_sales ORDER BY id',
      );
      expect(
        res.rows.map((row) => ({
          buyer: row.buyer_character_id === null ? null : Number(row.buyer_character_id),
          seller: row.seller_character_id === null ? null : Number(row.seller_character_id),
        })),
      ).toEqual([
        { buyer: bystander, seller: null },
        { buyer: null, seller: bystander },
      ]);
    } finally {
      db.release();
    }
  });

  it('the reconcile heals ids whose characters row is gone and keeps live ones', async () => {
    const kept = await insertCharacter('Kept');
    const gone = await insertCharacter('Gone');
    await insertMarketSaleRow(
      scopedPool(),
      saleRow({ sellerCharacterId: gone, buyerCharacterId: kept }),
    );
    // Delete AFTER the insert, so the row holds a then-valid id the insert
    // subquery kept: exactly the shape a FIFO-vs-delete race or an old-build
    // deletion leaves behind.
    const db = await scopedClient();
    try {
      await db.query('DELETE FROM characters WHERE id = $1', [gone]);
    } finally {
      db.release();
    }

    // The row is fresh (sold_at defaulted to now()), so the windowed
    // recurring pass sees and heals it.
    await reconcileMarketSalesCharacterIdsRecent(scopedPool());

    const verify = await scopedClient();
    try {
      const res = await verify.query(
        'SELECT buyer_character_id, seller_character_id FROM market_sales',
      );
      expect(Number(res.rows[0].buyer_character_id)).toBe(kept);
      expect(res.rows[0].seller_character_id).toBeNull();
    } finally {
      verify.release();
    }

    // The batched full-table backfill agrees nothing is left to heal.
    await expect(reconcileMarketSalesCharacterIdsBatch(scopedPool(), 100)).resolves.toBe(0);
  });

  it('the retention batch deletes only aged snapshot rows, oldest first', async () => {
    const rows = [
      {
        realm: 'eastbrook',
        itemId: 'wolf_fang',
        listingCount: 1,
        totalQuantity: 5,
        lowestAskTotalCopper: 1000,
        lowestAskQuantity: 5,
      },
      {
        realm: 'eastbrook',
        itemId: 'spring_water',
        listingCount: 2,
        totalQuantity: 8,
        lowestAskTotalCopper: 160,
        lowestAskQuantity: 4,
      },
    ];
    await insertMarketListingSnapshotRows(scopedPool(), rows, new Date());
    const db = await scopedClient();
    try {
      // Age one capture past the horizon; the other stays young.
      await db.query(
        `UPDATE market_listing_snapshots SET captured_at = now() - interval '100 days'
          WHERE item_id = 'wolf_fang'`,
      );
    } finally {
      db.release();
    }

    // Batch size 1 forces LIMIT iteration; retention 0 must keep everything.
    await expect(pruneMarketListingSnapshotsBatch(scopedPool(), 0, 1000)).resolves.toBe(0);
    await expect(pruneMarketListingSnapshotsBatch(scopedPool(), 90, 1)).resolves.toBe(1);
    await expect(pruneMarketListingSnapshotsBatch(scopedPool(), 90, 1)).resolves.toBe(0);

    const verify = await scopedClient();
    try {
      const res = await verify.query('SELECT item_id FROM market_listing_snapshots');
      expect(res.rows.map((row) => row.item_id)).toEqual(['spring_water']);
    } finally {
      verify.release();
    }
  });
});
