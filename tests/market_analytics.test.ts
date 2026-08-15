// Pure coverage for server/market_analytics.ts: the catalog projection, the
// house ask table, the overview merge, the flip ranking (the real MARKET_CUT
// math), and the movers comparison. No DB, no ctx: these are the shaping
// functions the admin market handlers call after their fetches.

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMarketOverview,
  buildMovers,
  houseUnitAskByItem,
  type MarketOverviewRow,
  marketItemCatalog,
  rankFlips,
  resetMarketAnalyticsCachesForTests,
} from '../server/market_analytics';
import type { MarketLatestSnapshotRow, MarketSaleStatsRow } from '../server/market_tracker_db';
import { ITEMS } from '../src/sim/data';
import { MARKET_CUT, MARKET_HOUSE_STOCK } from '../src/sim/market';

afterEach(() => resetMarketAnalyticsCachesForTests());

function stats(itemId: string, over: Partial<MarketSaleStatsRow> = {}): MarketSaleStatsRow {
  return {
    itemId,
    sales: 10,
    quantity: 40,
    medianUnitPriceCopper: 200,
    avgUnitPriceCopper: 210,
    minUnitPriceCopper: 150,
    maxUnitPriceCopper: 260,
    ...over,
  };
}

function snapshot(
  itemId: string,
  over: Partial<MarketLatestSnapshotRow> = {},
): MarketLatestSnapshotRow {
  return {
    itemId,
    capturedAt: new Date('2026-08-02T00:00:00Z'),
    listingCount: 2,
    totalQuantity: 7,
    lowestAskTotalCopper: 500,
    lowestAskQuantity: 5,
    ...over,
  };
}

describe('marketItemCatalog', () => {
  it('projects every shipped def with a correct listable flag', () => {
    const catalog = marketItemCatalog();
    const byId = new Map(catalog.map((item) => [item.itemId, item]));
    expect(catalog.length).toBe(Object.keys(ITEMS).length);
    // A plain tradable item is listable.
    const fang = byId.get('wolf_fang');
    expect(fang?.listable).toBe(true);
    expect(fang?.name).toBe(ITEMS.wolf_fang.name);
    // Soulbound currency is not (src/sim/market.ts marketList gate).
    expect(byId.get('heroic_mark')?.listable).toBe(false);
    // Vendor prices ride along for the price-floor context.
    expect(byId.get('wolf_fang')?.vendorSellCopper).toBe(ITEMS.wolf_fang.sellValue);
  });
});

describe('houseUnitAskByItem', () => {
  it('derives per-unit asks from the sim house stock constant', () => {
    const asks = houseUnitAskByItem();
    const boar = MARKET_HOUSE_STOCK.find((row) => row.itemId === 'roasted_boar');
    expect(boar).toBeTruthy();
    if (boar) expect(asks.get('roasted_boar')).toBe(boar.price / boar.count);
    expect(asks.size).toBeGreaterThan(0);
  });
});

describe('buildMarketOverview', () => {
  it('merges snapshot and both stats windows onto the catalog row', () => {
    const rows = buildMarketOverview(
      [snapshot('wolf_fang')],
      [stats('wolf_fang', { sales: 3 })],
      [stats('wolf_fang', { sales: 12 })],
    );
    const fang = rows.find((row) => row.itemId === 'wolf_fang');
    expect(fang).toMatchObject({
      lowestAskUnitCopper: 100,
      lowestAskTotalCopper: 500,
      lowestAskQuantity: 5,
      listingCount: 2,
      listedQuantity: 7,
    });
    expect(fang?.sales24h?.sales).toBe(3);
    expect(fang?.sales7d?.sales).toBe(12);
  });

  it('a listable item with no data still earns a row; unlistable noise does not', () => {
    const rows = buildMarketOverview([], [], []);
    const byId = new Map(rows.map((row) => [row.itemId, row]));
    const fang = byId.get('wolf_fang');
    expect(fang).toBeTruthy();
    expect(fang?.lowestAskUnitCopper).toBeNull();
    expect(fang?.listingCount).toBe(0);
    // Soulbound and never traded: no row.
    expect(byId.has('heroic_mark')).toBe(false);
  });

  it('carries the Merchant house ask when the house stocks the item', () => {
    const rows = buildMarketOverview([], [], []);
    const boar = rows.find((row) => row.itemId === 'roasted_boar');
    const stock = MARKET_HOUSE_STOCK.find((row) => row.itemId === 'roasted_boar');
    expect(boar?.houseUnitAskCopper).toBe(stock ? stock.price / stock.count : null);
  });
});

// A synthetic overview row so the flip and mover math is pinned independently
// of the real catalog.
function overviewRow(over: Partial<MarketOverviewRow> = {}): MarketOverviewRow {
  return {
    itemId: 'wolf_fang',
    name: 'Wolf Fang',
    quality: 'common',
    kind: 'junk',
    vendorSellCopper: 10,
    vendorBuyCopper: null,
    listable: true,
    lowestAskUnitCopper: 100,
    lowestAskTotalCopper: 500,
    lowestAskQuantity: 5,
    listingCount: 2,
    listedQuantity: 7,
    houseUnitAskCopper: null,
    sales24h: null,
    sales7d: stats('wolf_fang', { medianUnitPriceCopper: 200 }),
    ...over,
  };
}

describe('rankFlips', () => {
  it('prices the margin off the 7d median net of the real Merchant cut', () => {
    const [flip] = rankFlips([overviewRow()], 3);
    expect(flip).toBeTruthy();
    const expectedNet = 200 * (1 - MARKET_CUT);
    expect(flip.typicalUnitCopper).toBe(200);
    expect(flip.netUnitCopper).toBe(expectedNet);
    expect(flip.marginUnitCopper).toBe(expectedNet - 100);
    expect(flip.marginTotalCopper).toBe(Math.floor((expectedNet - 100) * 5));
    expect(flip.roi).toBeCloseTo((expectedNet - 100) / 100);
  });

  it('caps the resale estimate at the Merchant house ask', () => {
    // Median 200 but the house sells the same item at 140 a unit forever:
    // nobody pays a player more than the infinite vendor supply charges.
    const [flip] = rankFlips([overviewRow({ houseUnitAskCopper: 140 })], 3);
    expect(flip.typicalUnitCopper).toBe(140);
  });

  it('drops thin markets and items with no current ask, sorts by total margin', () => {
    const rows = rankFlips(
      [
        overviewRow({ itemId: 'thin', sales7d: stats('thin', { sales: 2 }) }),
        overviewRow({
          itemId: 'no_ask',
          lowestAskUnitCopper: null,
          lowestAskTotalCopper: null,
          lowestAskQuantity: null,
        }),
        overviewRow({
          itemId: 'small_win',
          sales7d: stats('small_win', { medianUnitPriceCopper: 120 }),
        }),
        overviewRow({ itemId: 'big_win' }),
      ],
      3,
    );
    expect(rows.map((row) => row.itemId)).toEqual(['big_win', 'small_win']);
  });
});

describe('buildMovers', () => {
  it('splits risers from fallers by relative median move', () => {
    const current = [
      stats('riser', { medianUnitPriceCopper: 300 }),
      stats('faller', { medianUnitPriceCopper: 100 }),
      stats('flat', { medianUnitPriceCopper: 200 }),
    ];
    const previous = [
      stats('riser', { medianUnitPriceCopper: 200 }),
      stats('faller', { medianUnitPriceCopper: 200 }),
      stats('flat', { medianUnitPriceCopper: 200 }),
    ];
    const { risers, fallers } = buildMovers(current, previous, 3);
    expect(risers.map((row) => row.itemId)).toEqual(['riser']);
    expect(risers[0].changePct).toBeCloseTo(0.5);
    expect(fallers.map((row) => row.itemId)).toEqual(['faller']);
    expect(fallers[0].changePct).toBeCloseTo(-0.5);
  });

  it('requires both windows to clear minSales', () => {
    const { risers } = buildMovers(
      [stats('spiky', { medianUnitPriceCopper: 900, sales: 20 })],
      [stats('spiky', { medianUnitPriceCopper: 100, sales: 1 })],
      3,
    );
    expect(risers).toEqual([]);
  });
});
