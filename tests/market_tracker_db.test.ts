import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every market_tracker_db function takes the pool by injection (the
// ratelimit_db pattern), so a plain fake pool object pins the actual SQL with
// no pg mock and no DATABASE_URL requirement.
import {
  anonymizeMarketSalesForCharacter,
  insertMarketListingSnapshotRows,
  insertMarketSaleRow,
  type MarketListingSnapshotRow,
  pruneMarketListingSnapshotsBatch,
  reconcileMarketSalesCharacterIds,
} from '../server/market_tracker_db';

const query = vi.fn();
const pool = { query } as any;

function snapshotRow(over: Partial<MarketListingSnapshotRow> = {}): MarketListingSnapshotRow {
  return {
    realm: 'eastbrook',
    itemId: 'wolf_fang',
    listingCount: 2,
    totalQuantity: 7,
    lowestAskTotalCopper: 1000,
    lowestAskQuantity: 5,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('insertMarketSaleRow', () => {
  it('issues one parameterized INSERT with all 11 columns', async () => {
    await insertMarketSaleRow(pool, {
      realm: 'eastbrook',
      listingId: 5001,
      itemId: 'wolf_fang',
      quantity: 5,
      totalPriceCopper: 1000,
      house: false,
      instanced: false,
      craftedRecipeId: null,
      buyerCharacterId: 43,
      buyerAccountId: 8,
      sellerCharacterId: 42,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO market_sales');
    expect(sql).toContain('realm, listing_id, item_id, quantity, total_price_copper, house');
    expect(sql).toContain('instanced, crafted_recipe_id, buyer_character_id, buyer_account_id');
    expect(sql).toContain('seller_character_id');
    // Eleven bind params, no interpolation: the last placeholder is $11.
    expect(sql).toContain('$11');
    expect(sql).not.toContain('$12');
    // The seller candidate is validated against a live characters row so a
    // stale or entity-id sellerKey lands as NULL, never a bogus attribution.
    expect(sql).toContain('(SELECT id FROM characters WHERE id = $11)');
    expect(params).toEqual([
      'eastbrook',
      5001,
      'wolf_fang',
      5,
      1000,
      false,
      false,
      null,
      43,
      8,
      42,
    ]);
  });
});

describe('insertMarketListingSnapshotRows', () => {
  it('one tick is one statement sharing one explicit captured_at', async () => {
    const capturedAt = new Date('2026-08-02T00:00:00Z');
    await insertMarketListingSnapshotRows(
      pool,
      [snapshotRow(), snapshotRow({ itemId: 'spring_water' })],
      capturedAt,
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO market_listing_snapshots');
    expect(sql).toContain('captured_at');
    // 7 binds per row, captured_at passed explicitly to every row.
    expect(params).toHaveLength(14);
    expect(params[2]).toBe(capturedAt);
    expect(params[9]).toBe(capturedAt);
  });

  it('chunks a large book into bounded statements with the same captured_at', async () => {
    const capturedAt = new Date('2026-08-02T00:00:00Z');
    const rows = Array.from({ length: 201 }, (_, i) => snapshotRow({ itemId: `item_${i}` }));
    await insertMarketListingSnapshotRows(pool, rows, capturedAt);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toHaveLength(200 * 7);
    expect(query.mock.calls[1][1]).toHaveLength(7);
    expect(query.mock.calls[1][1][2]).toBe(capturedAt);
  });

  it('an empty row set issues no statement', async () => {
    await insertMarketListingSnapshotRows(pool, [], new Date());
    expect(query).not.toHaveBeenCalled();
  });
});

describe('pruneMarketListingSnapshotsBatch', () => {
  it('issues one LIMIT-bounded DELETE riding the captured_at index', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 42 });
    const deleted = await pruneMarketListingSnapshotsBatch(pool, 90, 1000);
    expect(deleted).toBe(42);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('DELETE FROM market_listing_snapshots');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toContain('ORDER BY captured_at');
    expect(params).toEqual(['90', 1000]);
  });

  it('retention 0 or garbage means keep forever: no statement at all', async () => {
    expect(await pruneMarketListingSnapshotsBatch(pool, 0, 1000)).toBe(0);
    expect(await pruneMarketListingSnapshotsBatch(pool, -5, 1000)).toBe(0);
    expect(await pruneMarketListingSnapshotsBatch(pool, Number.NaN, 1000)).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('a fractional retention clamps to at least one day, never zero', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await pruneMarketListingSnapshotsBatch(pool, 0.5, 1000);
    expect(query.mock.calls[0][1]).toEqual(['1', 1000]);
  });
});

describe('anonymizeMarketSalesForCharacter', () => {
  it('nulls both internal id columns for the deleted character', async () => {
    await anonymizeMarketSalesForCharacter(pool, 42);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('SET buyer_character_id = NULL');
    expect(query.mock.calls[0][1]).toEqual([42]);
    expect(query.mock.calls[1][0]).toContain('SET seller_character_id = NULL');
    expect(query.mock.calls[1][1]).toEqual([42]);
  });
});

describe('reconcileMarketSalesCharacterIds', () => {
  it('nulls ids whose characters row no longer exists, one UPDATE per column', async () => {
    await reconcileMarketSalesCharacterIds(pool);
    expect(query).toHaveBeenCalledTimes(2);
    const [buyerSql] = query.mock.calls[0];
    const [sellerSql] = query.mock.calls[1];
    expect(buyerSql).toContain('SET buyer_character_id = NULL');
    expect(buyerSql).toContain('NOT EXISTS');
    expect(buyerSql).toContain('buyer_character_id IS NOT NULL');
    expect(sellerSql).toContain('SET seller_character_id = NULL');
    expect(sellerSql).toContain('NOT EXISTS');
    expect(sellerSql).toContain('seller_character_id IS NOT NULL');
  });
});
