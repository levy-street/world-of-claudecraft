// Pure coverage for src/admin/market_view.ts: overview filtering, sorting
// (null asks sink both directions), paging, and the detail chart builders.
import { describe, expect, it } from 'vitest';
import {
  buildMarketOverviewView,
  buildPriceChartPoints,
  buildVolumeChartPoints,
  MARKET_PAGE_LIMIT,
} from '../../src/admin/market_view';
import type {
  MarketAskHistoryPoint,
  MarketOverviewItem,
  MarketPriceHistoryPoint,
} from '../../src/admin/types';

function item(over: Partial<MarketOverviewItem> = {}): MarketOverviewItem {
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
    sales7d: {
      itemId: 'wolf_fang',
      sales: 10,
      quantity: 40,
      medianUnitPriceCopper: 200,
      avgUnitPriceCopper: 210,
      minUnitPriceCopper: 150,
      maxUnitPriceCopper: 260,
    },
    ...over,
  };
}

const OPTS = {
  query: '',
  kind: 'all',
  listedOnly: false,
  sort: 'name' as const,
  dir: 'asc' as const,
  page: 1,
  locale: 'en',
};

describe('buildMarketOverviewView', () => {
  it('searches name and id, filters kind, and lists distinct kinds', () => {
    const items = [
      item(),
      item({ itemId: 'spring_water', name: 'Spring Water', kind: 'drink' }),
      item({ itemId: 'oak_staff', name: 'Oak Staff', kind: 'weapon' }),
    ];
    expect(buildMarketOverviewView(items, { ...OPTS, query: 'spring' }).rows).toHaveLength(1);
    expect(buildMarketOverviewView(items, { ...OPTS, query: 'oak_staff' }).rows).toHaveLength(1);
    const view = buildMarketOverviewView(items, { ...OPTS, kind: 'drink' });
    expect(view.rows.map((row) => row.itemId)).toEqual(['spring_water']);
    expect(view.kinds).toEqual(['drink', 'junk', 'weapon']);
  });

  it('listedOnly drops rows without active listings', () => {
    const items = [item(), item({ itemId: 'bare', name: 'Bare', listingCount: 0 })];
    const view = buildMarketOverviewView(items, { ...OPTS, listedOnly: true });
    expect(view.rows.map((row) => row.itemId)).toEqual(['wolf_fang']);
  });

  it('null asks sink to the bottom in both sort directions', () => {
    const items = [
      item({ itemId: 'unlisted', name: 'Aaa Unlisted', lowestAskUnitCopper: null }),
      item({ itemId: 'cheap', name: 'Cheap', lowestAskUnitCopper: 10 }),
      item({ itemId: 'dear', name: 'Dear', lowestAskUnitCopper: 900 }),
    ];
    const asc = buildMarketOverviewView(items, { ...OPTS, sort: 'ask', dir: 'asc' });
    expect(asc.rows.map((row) => row.itemId)).toEqual(['cheap', 'dear', 'unlisted']);
    const desc = buildMarketOverviewView(items, { ...OPTS, sort: 'ask', dir: 'desc' });
    expect(desc.rows.map((row) => row.itemId)).toEqual(['dear', 'cheap', 'unlisted']);
  });

  it('pages at the limit and clamps an out-of-range page', () => {
    const items = Array.from({ length: MARKET_PAGE_LIMIT + 3 }, (_, index) =>
      item({ itemId: `item_${index}`, name: `Item ${String(index).padStart(3, '0')}` }),
    );
    const first = buildMarketOverviewView(items, OPTS);
    expect(first.rows).toHaveLength(MARKET_PAGE_LIMIT);
    expect(first.total).toBe(MARKET_PAGE_LIMIT + 3);
    const beyond = buildMarketOverviewView(items, { ...OPTS, page: 99 });
    expect(beyond.page).toBe(2);
    expect(beyond.rows).toHaveLength(3);
  });
});

const label = (iso: string) => iso.slice(0, 10);
const money = (copper: number) => `${copper}c`;

function pricePoint(
  bucketStart: string,
  over: Partial<MarketPriceHistoryPoint> = {},
): MarketPriceHistoryPoint {
  return {
    bucketStart,
    sales: 4,
    quantity: 12,
    medianUnitPriceCopper: 200,
    avgUnitPriceCopper: 210,
    minUnitPriceCopper: 150,
    maxUnitPriceCopper: 260,
    ...over,
  };
}

function askPoint(
  bucketStart: string,
  over: Partial<MarketAskHistoryPoint> = {},
): MarketAskHistoryPoint {
  return {
    bucketStart,
    lowestAskUnitCopper: 120,
    avgListingCount: 2,
    avgTotalQuantity: 6,
    ...over,
  };
}

describe('buildPriceChartPoints', () => {
  it('merges both series on the union of buckets, ask as the secondary line', () => {
    const points = buildPriceChartPoints(
      [pricePoint('2026-08-01T00:00:00Z')],
      [
        askPoint('2026-08-01T00:00:00Z'),
        askPoint('2026-08-02T00:00:00Z', { lowestAskUnitCopper: 90 }),
      ],
      label,
      money,
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ value: 200, secondaryValue: 120 });
    // The sale-less bucket carries the last median forward instead of zeroing.
    expect(points[1]).toMatchObject({ value: 200, secondaryValue: 90 });
  });

  it('orders buckets chronologically whatever the input order', () => {
    const points = buildPriceChartPoints(
      [
        pricePoint('2026-08-02T00:00:00Z', { medianUnitPriceCopper: 300 }),
        pricePoint('2026-08-01T00:00:00Z', { medianUnitPriceCopper: 100 }),
      ],
      [],
      label,
      money,
    );
    expect(points.map((point) => point.value)).toEqual([100, 300]);
  });
});

describe('buildVolumeChartPoints', () => {
  it('maps traded quantity per bucket', () => {
    const points = buildVolumeChartPoints(
      [pricePoint('2026-08-01T00:00:00Z', { quantity: 42 })],
      label,
    );
    expect(points).toEqual([{ label: '2026-08-01', value: 42, title: '2026-08-01: 42' }]);
  });
});
