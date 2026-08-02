import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every market_tracker_db function takes the pool by injection (the
// ratelimit_db pattern), so a plain fake pool object pins the actual SQL with
// no pg mock and no DATABASE_URL requirement.
import {
  anonymizeMarketSalesForCharacter,
  insertMarketListingSnapshotRows,
  insertMarketSaleRow,
  MARKET_SNAPSHOT_PRUNE_ADVISORY_KEY,
  MARKET_SNAPSHOT_PRUNE_BATCH_SIZE,
  MARKET_SNAPSHOT_RETENTION_DAYS,
  type MarketListingSnapshotRow,
  pruneMarketListingSnapshots,
} from '../server/market_tracker_db';

const query = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const pool = {
  query,
  connect: vi.fn(async () => ({ query: clientQuery, release })),
} as any;

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
  clientQuery.mockReset();
  release.mockReset();
  (pool.connect as ReturnType<typeof vi.fn>).mockClear();
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

describe('pruneMarketListingSnapshots', () => {
  it('takes the advisory try-lock, deletes in bounded batches, and unlocks', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: MARKET_SNAPSHOT_PRUNE_BATCH_SIZE })
      .mockResolvedValueOnce({ rows: [], rowCount: 3 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const total = await pruneMarketListingSnapshots(pool);
    expect(total).toBe(MARKET_SNAPSHOT_PRUNE_BATCH_SIZE + 3);
    // lock, full batch, short batch (stop), unlock.
    expect(clientQuery).toHaveBeenCalledTimes(4);
    expect(clientQuery.mock.calls[0][0]).toContain('pg_try_advisory_lock');
    expect(clientQuery.mock.calls[0][1]).toEqual([MARKET_SNAPSHOT_PRUNE_ADVISORY_KEY]);
    const [deleteSql, deleteParams] = clientQuery.mock.calls[1];
    expect(deleteSql).toContain('DELETE FROM market_listing_snapshots');
    expect(deleteSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(deleteParams).toEqual([
      MARKET_SNAPSHOT_RETENTION_DAYS,
      MARKET_SNAPSHOT_PRUNE_BATCH_SIZE,
    ]);
    expect(clientQuery.mock.calls[3][0]).toContain('pg_advisory_unlock');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('another process holding the lock means a clean no-op', async () => {
    clientQuery.mockResolvedValueOnce({ rows: [{ acquired: false }], rowCount: 1 });
    const total = await pruneMarketListingSnapshots(pool);
    expect(total).toBe(0);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('always releases the client, unlocking even when a batch throws', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(pruneMarketListingSnapshots(pool)).rejects.toThrow('delete failed');
    expect(clientQuery.mock.calls[2][0]).toContain('pg_advisory_unlock');
    expect(release).toHaveBeenCalledTimes(1);
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
