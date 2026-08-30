// @vitest-environment happy-dom
import './_setup';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { AdminMarketMetrics, AdminMarketMetricsBucket } from '../../src/admin/types';

function emptyBucket(bucket: AdminMarketMetricsBucket['bucket'], tracked: number) {
  return {
    bucket,
    listingCount: 0,
    totalQuantity: 0,
    trackedItemCount: tracked,
    listedItemCount: 0,
    items: [],
  };
}

const METRICS: AdminMarketMetrics = {
  realm: 'eastbrook',
  buckets: [
    {
      bucket: 'cores',
      listingCount: 2,
      totalQuantity: 5,
      trackedItemCount: 1,
      listedItemCount: 1,
      items: [
        {
          itemId: 'wyrmfall_core',
          name: 'Wyrmfall Core',
          listingCount: 2,
          totalQuantity: 5,
          lowestPerUnit: 3,
          medianPerUnit: 4,
        },
      ],
    },
    emptyBucket('essence', 2),
    emptyBucket('patterns', 40),
    emptyBucket('produce', 24),
    emptyBucket('seeds', 12),
    emptyBucket('compost', 2),
  ],
};

const EMPTY_METRICS: AdminMarketMetrics = {
  realm: 'eastbrook',
  buckets: [
    emptyBucket('cores', 1),
    emptyBucket('essence', 2),
    emptyBucket('patterns', 40),
    emptyBucket('produce', 24),
    emptyBucket('seeds', 12),
    emptyBucket('compost', 2),
  ],
};

// Keep the real module (ApiError included: handleAuthFailure instanceof-checks
// it on the failure branch) and override only the transport.
vi.mock('../../src/admin/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/admin/api')>()),
  apiGet: vi.fn(async (path: string) => {
    if (path === '/admin/api/market/metrics') return METRICS;
    throw new Error(`unexpected path ${path}`);
  }),
  apiPost: vi.fn(async () => ({})),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { ApiError, apiGet } from '../../src/admin/api';
import { fmtCopper, fmtNumber } from '../../src/admin/format';
import { t } from '../../src/admin/i18n';
import MarketMetrics from '../../src/admin/pages/MarketMetrics.svelte';
import { auth } from '../../src/admin/state/auth.svelte';

// The generic apiGet<T> cannot take a concrete mockImplementation without a
// cast; unknown keeps the payload swap per test type-checked at the call site.
const apiGetMock = apiGet as unknown as Mock<(path: string) => Promise<unknown>>;

describe('Market Metrics page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === '/admin/api/market/metrics') return METRICS;
      throw new Error(`unexpected path ${path}`);
    });
  });

  it('renders every bucket title, the realm line, and the item rows', async () => {
    render(MarketMetrics);
    expect(await screen.findByText('Wyrmfall Core')).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith('/admin/api/market/metrics');
    expect(screen.getByText(t('marketMetrics.realm', { realm: 'eastbrook' }))).toBeInTheDocument();
    for (const key of [
      'marketMetrics.bucketCores',
      'marketMetrics.bucketEssence',
      'marketMetrics.bucketPatterns',
      'marketMetrics.bucketProduce',
      'marketMetrics.bucketSeeds',
      'marketMetrics.bucketCompost',
    ]) {
      expect(screen.getByText(t(key))).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        t('marketMetrics.bucketSummary', {
          listings: fmtNumber(2),
          quantity: fmtNumber(5),
          listed: fmtNumber(1),
          tracked: fmtNumber(1),
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(fmtCopper(3))).toBeInTheDocument();
    expect(screen.getByText(fmtCopper(4))).toBeInTheDocument();
  });

  it('shows the essence tripwire note', async () => {
    render(MarketMetrics);
    await screen.findByText('Wyrmfall Core');
    expect(screen.getByText(t('marketMetrics.essenceNote'))).toBeInTheDocument();
  });

  it('shows the loading state until the fetch resolves', () => {
    apiGetMock.mockImplementation(() => new Promise(() => {}));
    render(MarketMetrics);
    expect(screen.getByText(t('marketMetrics.loading'))).toBeInTheDocument();
  });

  it('shows the failure state on a non-auth error', async () => {
    apiGetMock.mockRejectedValue(new Error('boom'));
    render(MarketMetrics);
    expect(await screen.findByText(t('marketMetrics.loadFailed'))).toBeInTheDocument();
  });

  it('routes an ApiError(401) through auth.handleAuthFailure, not the failure line', async () => {
    // The api mock spreads the REAL module precisely so this arm can throw the
    // real ApiError class (handleAuthFailure instanceof-checks it). The spy
    // still calls through, so the real 401 arm (logout) runs.
    const authSpy = vi.spyOn(auth, 'handleAuthFailure');
    apiGetMock.mockRejectedValue(new ApiError(401, 'admin authentication required'));
    render(MarketMetrics);
    await waitFor(() => expect(authSpy).toHaveBeenCalledTimes(1));
    expect(authSpy).toHaveReturnedWith(true);
    // A 401 hands the operator to the login screen; the page must not ALSO
    // paint its own failure line on top of the forced logout.
    expect(screen.queryByText(t('marketMetrics.loadFailed'))).not.toBeInTheDocument();
    authSpy.mockRestore();
  });

  it('shows the all-quiet line plus per-bucket empties when nothing is listed', async () => {
    apiGetMock.mockResolvedValue(EMPTY_METRICS);
    render(MarketMetrics);
    expect(await screen.findByText(t('marketMetrics.empty'))).toBeInTheDocument();
    expect(screen.getAllByText(t('marketMetrics.bucketEmpty'))).toHaveLength(6);
  });

  it('renders the auto-refresh toggle with its interval label', async () => {
    render(MarketMetrics);
    await screen.findByText('Wyrmfall Core');
    expect(screen.getByText(t('marketMetrics.autoRefresh', { seconds: 30 }))).toBeInTheDocument();
  });

  it('auto-refresh refetches on the 30 s interval and the toggle-off cancels it', async () => {
    // The interval itself, driven (the Phase 16 QA): the label-only case
    // above stays green with the setInterval or the toggle wiring deleted.
    vi.useFakeTimers();
    try {
      render(MarketMetrics);
      await vi.advanceTimersByTimeAsync(0); // flush the mount fetch
      expect(apiGetMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(apiGetMock).toHaveBeenCalledTimes(2);
      const toggle = screen.getByRole('checkbox') as HTMLInputElement;
      expect(toggle.checked).toBe(true);
      toggle.click();
      await vi.advanceTimersByTimeAsync(90_000); // three would-be intervals
      expect(apiGetMock, 'the cancelled interval refetched').toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
