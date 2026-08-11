import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every market_tracker_db function takes the pool by injection (the
// ratelimit_db pattern), so a plain fake pool object pins the actual SQL with
// no pg mock and no DATABASE_URL requirement.
import {
  anonymizeMarketSalesForCharacter,
  deleteMarketAlert,
  insertMarketAlert,
  insertMarketListingSnapshotRows,
  insertMarketSaleRow,
  loadActiveMarketAlerts,
  type MarketListingSnapshotRow,
  markMarketAlertTriggered,
  pruneMarketListingSnapshotsBatch,
  rearmMarketAlerts,
  reconcileMarketSalesCharacterIdsBatch,
  reconcileMarketSalesCharacterIdsRecent,
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
  it('issues one parameterized INSERT with all 10 columns', async () => {
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
      sellerCharacterId: 42,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO market_sales');
    expect(sql).toContain('realm, listing_id, item_id, quantity, total_price_copper, house');
    expect(sql).toContain('instanced, crafted_recipe_id, buyer_character_id');
    expect(sql).toContain('seller_character_id');
    // No account-id column: sale rows carry character ids only, and those are
    // nulled on delete, so nothing on this keep-forever table can stay
    // account-linkable after the character is gone.
    expect(sql).not.toContain('buyer_account_id');
    // Ten bind params, no interpolation: the last placeholder is $10.
    expect(sql).toContain('$10');
    expect(sql).not.toContain('$11');
    // The seller candidate is validated against a live characters row so a
    // stale or entity-id sellerKey lands as NULL, never a bogus attribution.
    expect(sql).toContain('(SELECT id FROM characters WHERE id = $10)');
    expect(params).toEqual(['eastbrook', 5001, 'wolf_fang', 5, 1000, false, false, null, 43, 42]);
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

describe('market alerts SQL', () => {
  it('insert stamps the v1 metric and the creator, returning the id', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 });
    const id = await insertMarketAlert(pool, {
      realm: 'eastbrook',
      itemId: 'wolf_fang',
      direction: 'below',
      thresholdCopper: 150,
      createdByAccountId: 9,
    });
    expect(id).toBe(7);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO market_alerts');
    expect(sql).toContain('RETURNING id');
    expect(params).toEqual(['eastbrook', 'wolf_fang', 'lowest_ask', 'below', 150, 9]);
  });

  it('delete is realm-scoped and reports whether a row went', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(deleteMarketAlert(pool, 'eastbrook', 7)).resolves.toBe(true);
    expect(query.mock.calls[0][0]).toContain('WHERE realm = $1 AND id = $2');
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(deleteMarketAlert(pool, 'eastbrook', 8)).resolves.toBe(false);
  });

  it('the evaluation load takes only active lowest-ask alerts, with edge state', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: '7',
          item_id: 'wolf_fang',
          direction: 'below',
          threshold_copper: '150',
          last_met: true,
        },
      ],
      rowCount: 1,
    });
    const alerts = await loadActiveMarketAlerts(pool, 'eastbrook');
    expect(alerts).toEqual([
      { id: 7, itemId: 'wolf_fang', direction: 'below', thresholdCopper: 150, lastMet: true },
    ]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE realm = $1 AND active AND metric = $2');
    expect(sql).toContain('last_met');
    expect(params).toEqual(['eastbrook', 'lowest_ask']);
  });

  it('marking a trigger rounds the carried value and latches the edge', async () => {
    await markMarketAlertTriggered(pool, 7, 199.5);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('SET last_triggered_at = now(), last_value_copper = $2, last_met = TRUE');
    expect(params).toEqual([7, 200]);
  });

  it('re-arming clears the edge for the given ids in one statement', async () => {
    await rearmMarketAlerts(pool, [7, 9]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('SET last_met = FALSE WHERE id = ANY($1)');
    expect(params).toEqual([[7, 9]]);
  });

  it('re-arming nothing issues no query', async () => {
    await rearmMarketAlerts(pool, []);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('reconcileMarketSalesCharacterIdsRecent', () => {
  it('nulls orphaned ids inside a one-day sold_at window, one UPDATE per column', async () => {
    await reconcileMarketSalesCharacterIdsRecent(pool);
    expect(query).toHaveBeenCalledTimes(2);
    const [buyerSql] = query.mock.calls[0];
    const [sellerSql] = query.mock.calls[1];
    expect(buyerSql).toContain('SET buyer_character_id = NULL');
    expect(buyerSql).toContain('NOT EXISTS');
    expect(buyerSql).toContain('buyer_character_id IS NOT NULL');
    expect(sellerSql).toContain('SET seller_character_id = NULL');
    expect(sellerSql).toContain('NOT EXISTS');
    expect(sellerSql).toContain('seller_character_id IS NOT NULL');
    // The recurring pass is windowed: an unscoped anti-join over the
    // keep-forever table would eventually exceed the pool statement_timeout
    // and the heal would silently stop running.
    expect(buyerSql).toContain("sold_at > now() - interval '1 day'");
    expect(sellerSql).toContain("sold_at > now() - interval '1 day'");
  });
});

describe('reconcileMarketSalesCharacterIdsBatch', () => {
  it('heals bounded slices through a LIMIT subquery and reports rows touched', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    query.mockResolvedValueOnce({ rows: [], rowCount: 2 });
    const healed = await reconcileMarketSalesCharacterIdsBatch(pool, 5000);
    expect(healed).toBe(5);
    expect(query).toHaveBeenCalledTimes(2);
    const [buyerSql, buyerParams] = query.mock.calls[0];
    const [sellerSql, sellerParams] = query.mock.calls[1];
    for (const sql of [buyerSql, sellerSql]) {
      expect(sql).toContain('WHERE id IN');
      expect(sql).toContain('LIMIT $1');
      expect(sql).toContain('NOT EXISTS');
      // The full-table pass never carries the window: it exists to backfill
      // deletions made by a build without the anonymize call.
      expect(sql).not.toContain('interval');
    }
    expect(buyerParams).toEqual([5000]);
    expect(sellerParams).toEqual([5000]);
  });

  it('clamps a nonsense batch size to at least one row', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await reconcileMarketSalesCharacterIdsBatch(pool, 0);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([1]);
  });
});
