// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
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

const alertsData = {
  realm: 'eastbrook',
  rows: [
    {
      id: 7,
      itemId: 'wolf_fang',
      name: 'Wolf Fang',
      metric: 'lowest_ask',
      direction: 'below',
      thresholdCopper: 150,
      active: true,
      createdAt: '2026-08-01T00:00:00Z',
      lastTriggeredAt: '2026-08-02T00:00:00Z',
      lastValueCopper: 120,
    },
  ],
};

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  getToken: () => 'tok',
  getAdminName: () => 'alice',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import Market from '../../src/admin/pages/Market.svelte';
import MarketAlerts from '../../src/admin/pages/MarketAlerts.svelte';
import MarketFlips from '../../src/admin/pages/MarketFlips.svelte';
import MarketItemDetail from '../../src/admin/pages/MarketItemDetail.svelte';

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.apiPost.mockResolvedValue({ ok: true });
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/api/market/overview')) return overviewData;
    if (path.startsWith('/admin/api/market/flips')) return flipsData;
    if (path.startsWith('/admin/api/market/item')) return itemData;
    if (path.startsWith('/admin/api/market/alerts')) return alertsData;
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

  it('starring a row persists it to the watchlist store', async () => {
    render(Market);
    const star = await screen.findByRole('button', {
      name: t('market.watch', { name: 'Wolf Fang' }),
    });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await fireEvent.click(star);
    expect(
      screen.getByRole('button', { name: t('market.unwatch', { name: 'Wolf Fang' }) }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('claudecraft_admin_market_watchlist')).toBe('["wolf_fang"]');
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

describe('Price alerts page', () => {
  // Role-scoped queries throughout: the create form's datalist repeats every
  // item name, so a bare findByText('Wolf Fang') is ambiguous by design.
  it('renders the alert with its condition and last-fired value', async () => {
    render(MarketAlerts);
    expect(await screen.findByRole('link', { name: 'Wolf Fang' })).toBeInTheDocument();
    expect(screen.getByText(t('market.conditionBelow', { price: '1s 50c' }))).toBeInTheDocument();
    // Ask when fired: 120c -> "1s 20c".
    expect(screen.getByText('1s 20c')).toBeInTheDocument();
  });

  it('creating an alert posts the form and refreshes the list', async () => {
    render(MarketAlerts);
    await screen.findByRole('link', { name: 'Wolf Fang' });
    const itemInput = screen.getByLabelText(t('market.alertItemLabel'));
    await fireEvent.input(itemInput, { target: { value: 'spring_water' } });
    await fireEvent.click(screen.getByRole('button', { name: t('market.alertCreate') }));
    expect(mocks.apiPost).toHaveBeenCalledWith('/admin/api/market/alerts', {
      item: 'spring_water',
      direction: 'below',
      thresholdCopper: 10000,
    });
  });

  it('deleting an alert posts its id', async () => {
    render(MarketAlerts);
    await screen.findByRole('link', { name: 'Wolf Fang' });
    await fireEvent.click(screen.getByRole('button', { name: t('market.alertDelete') }));
    expect(mocks.apiPost).toHaveBeenCalledWith('/admin/api/market/alerts/delete', { id: 7 });
  });
});
