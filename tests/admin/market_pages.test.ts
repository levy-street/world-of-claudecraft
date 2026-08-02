// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const overviewData = {
  realm: 'eastbrook',
  cutPct: 5,
  capturedAt: '2026-08-02T00:00:00Z',
  items: [
    {
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
        sales: 12,
        quantity: 40,
        medianUnitPriceCopper: 200,
        avgUnitPriceCopper: 210,
        minUnitPriceCopper: 150,
        maxUnitPriceCopper: 260,
      },
    },
  ],
};

const flipsData = {
  realm: 'eastbrook',
  cutPct: 5,
  capturedAt: '2026-08-02T00:00:00Z',
  minSales: 3,
  rows: [
    {
      itemId: 'wolf_fang',
      name: 'Wolf Fang',
      quality: 'common',
      kind: 'junk',
      buyTotalCopper: 500,
      buyQuantity: 5,
      buyUnitCopper: 100,
      typicalUnitCopper: 200,
      netUnitCopper: 190,
      marginUnitCopper: 90,
      marginTotalCopper: 450,
      roi: 0.9,
      sales7d: 12,
      soldQuantity7d: 40,
      houseUnitAskCopper: null,
    },
  ],
};

const itemData = {
  realm: 'eastbrook',
  cutPct: 5,
  item: {
    itemId: 'wolf_fang',
    name: 'Wolf Fang',
    quality: 'common',
    kind: 'junk',
    vendorSellCopper: 10,
    vendorBuyCopper: null,
    listable: true,
  },
  bucket: 'day',
  days: 30,
  priceHistory: [
    {
      bucketStart: '2026-08-01T00:00:00Z',
      sales: 4,
      quantity: 12,
      medianUnitPriceCopper: 200,
      avgUnitPriceCopper: 210,
      minUnitPriceCopper: 150,
      maxUnitPriceCopper: 260,
    },
  ],
  askHistory: [],
  recentSales: [
    {
      soldAt: '2026-08-01T12:00:00Z',
      quantity: 5,
      totalPriceCopper: 1000,
      house: false,
      instanced: false,
      craftedRecipeId: null,
    },
  ],
};

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: mocks.apiGet,
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'alice',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import Market from '../../src/admin/pages/Market.svelte';
import MarketFlips from '../../src/admin/pages/MarketFlips.svelte';
import MarketItemDetail from '../../src/admin/pages/MarketItemDetail.svelte';

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/api/market/overview')) return overviewData;
    if (path.startsWith('/admin/api/market/flips')) return flipsData;
    if (path.startsWith('/admin/api/market/item')) return itemData;
    throw new Error(`unexpected path ${path}`);
  });
});

describe('Market overview page', () => {
  it('renders the tracked item with its ask, stats, and the cut note', async () => {
    render(Market);
    expect(await screen.findByText('Wolf Fang')).toBeInTheDocument();
    // 100c lowest unit ask and the 7d median (200c -> "2s 0c").
    expect(screen.getByText('1s 0c')).toBeInTheDocument();
    expect(screen.getByText('2s 0c')).toBeInTheDocument();
    expect(screen.getByText(t('market.cutNote', { pct: 5 }))).toBeInTheDocument();
    // The item name links into the detail route.
    expect(screen.getByRole('link', { name: 'Wolf Fang' })).toHaveAttribute(
      'href',
      expect.stringContaining('page=market-item'),
    );
  });
});

describe('Flip finder page', () => {
  it('renders the ranked flip with margin and ROI', async () => {
    render(MarketFlips);
    expect(await screen.findByText('Wolf Fang')).toBeInTheDocument();
    expect(
      screen.getByText(t('market.stackAt', { count: '5', price: '5s 0c' })),
    ).toBeInTheDocument();
    // Margin per stack 450c -> "4s 50c"; ROI 0.9 -> "90%".
    expect(screen.getByText('4s 50c')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
  });
});

describe('Market item detail page', () => {
  it('renders the header, charts, and the recent-sale ticker', async () => {
    render(MarketItemDetail, { props: { item: 'wolf_fang' } });
    expect(await screen.findByText('Wolf Fang')).toBeInTheDocument();
    expect(screen.getByText(t('market.priceChartTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('market.recentSalesTitle'))).toBeInTheDocument();
    // The sale row: 5 units for 10s 0c at 2s 0c a unit, player-sold.
    expect(screen.getByText('10s 0c')).toBeInTheDocument();
    expect(screen.getByText(t('market.sourcePlayer'))).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith(
      '/admin/api/market/item?item=wolf_fang&bucket=day&days=30',
    );
  });

  it('a 404 renders the unknown-item state, not the failure state', async () => {
    mocks.apiGet.mockImplementation(async () => {
      const err = new Error('unknown item') as Error & { status: number };
      err.status = 404;
      throw err;
    });
    render(MarketItemDetail, { props: { item: 'nope' } });
    expect(await screen.findByText(t('market.unknownItem'))).toBeInTheDocument();
  });
});
