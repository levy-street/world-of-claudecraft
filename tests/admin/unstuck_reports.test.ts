// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: mocks.apiGet,
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import UnstuckReports from '../../src/admin/pages/UnstuckReports.svelte';

const firstPage = {
  reports: [
    {
      id: 41,
      characterId: 12000,
      characterName: 'Ari',
      area: {
        kind: 'dungeon',
        id: 'hollow_crypt',
        instanceId: 'dungeon-17',
        slot: 3,
      },
      origin: { x: 101.2, y: 7, z: 203.4, localX: 11.2, localY: 7, localZ: 23.4 },
      destination: { x: 110, y: 8, z: 210, localX: 20, localY: 8, localZ: 30 },
      outcome: 'completed',
      reason: 'nearest_safe_position',
      invokedAt: '2026-07-13T08:00:00Z',
      resolvedAt: '2026-07-13T08:00:10Z',
    },
  ],
  hotspots: [
    {
      area: {
        kind: 'dungeon',
        id: 'hollow_crypt',
        // Hotspots aggregate content-local buckets across runtime copies.
        instanceId: null,
        slot: null,
      },
      bucket: { x: 10, y: 5, z: 20 },
      count: 9,
      completed: 6,
      cancelled: 2,
      failed: 1,
      lastUsedAt: '2026-07-13T08:00:00Z',
    },
  ],
  days: 30,
  limit: 50,
  hasMore: true,
  nextBeforeId: 41,
};

const secondPage = {
  reports: [
    {
      id: 40,
      characterId: null,
      characterName: 'Mira',
      area: { kind: 'overworld', id: 'eastbrook_vale', instanceId: null, slot: null },
      origin: { x: 5, y: 2, z: 9, localX: 5, localY: 2, localZ: 9 },
      destination: null,
      outcome: 'cancelled',
      reason: 'moved',
      invokedAt: '2026-07-12T08:00:00Z',
      resolvedAt: '2026-07-12T08:00:03Z',
    },
  ],
  // Cursor pages omit aggregate hotspots; the first page remains authoritative.
  hotspots: [],
  days: 30,
  limit: 50,
  hasMore: false,
  nextBeforeId: null,
};

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) =>
    path.includes('beforeId=41') ? secondPage : firstPage,
  );
});

describe('UnstuckReports', () => {
  it('shows visible area and coordinate details with localized outcomes', async () => {
    render(UnstuckReports);

    expect(await screen.findByText('Ari')).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith('/admin/api/unstuck-reports?days=30&limit=50');
    expect(screen.getAllByText('Area: hollow_crypt')).toHaveLength(2);
    expect(screen.getByText('Instance: dungeon-17')).toBeInTheDocument();
    expect(screen.getByText('Slot: 3')).toBeInTheDocument();
    expect(screen.getByText('Character #12,000')).toBeInTheDocument();
    expect(screen.getByText('Local: 11.2, 7, 23.4')).toBeInTheDocument();
    expect(screen.getByText('World: 101.2, 7, 203.4')).toBeInTheDocument();
    expect(
      screen
        .getAllByText(t('unstuckReports.outcome.completed'))
        .some((element) => element.classList.contains('badge')),
    ).toBe(true);
    expect(screen.getByText('nearest_safe_position')).toBeInTheDocument();

    const hotspots = screen.getByRole('region', {
      name: t('unstuckReports.hotspotsCaption'),
    });
    const reports = screen.getByRole('region', {
      name: t('unstuckReports.reportsCaption'),
    });
    expect(hotspots).toHaveAttribute('tabindex', '0');
    expect(reports).toHaveAttribute('tabindex', '0');
    expect(within(hotspots).queryByText('Instance: dungeon-17')).not.toBeInTheDocument();
    expect(within(hotspots).queryByText('Slot: 3')).not.toBeInTheDocument();
  });

  it('appends the next cursor page and keeps the earlier reports', async () => {
    render(UnstuckReports);
    expect(await screen.findByText('Ari')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: t('unstuckReports.loadMore') }));

    expect(await screen.findByText('Mira')).toBeInTheDocument();
    expect(screen.getByText('Ari')).toBeInTheDocument();
    expect(screen.getAllByText('Area: hollow_crypt')).toHaveLength(2);
    expect(mocks.apiGet).toHaveBeenLastCalledWith(
      '/admin/api/unstuck-reports?days=30&limit=50&beforeId=41',
    );
    expect(
      screen
        .getAllByText(t('unstuckReports.outcome.cancelled'))
        .some((element) => element.classList.contains('badge')),
    ).toBe(true);
    expect(
      screen.queryByRole('button', { name: t('unstuckReports.loadMore') }),
    ).not.toBeInTheDocument();
  });

  it('localizes empty result states', async () => {
    mocks.apiGet.mockResolvedValue({
      reports: [],
      hotspots: [],
      days: 30,
      limit: 50,
      hasMore: false,
      nextBeforeId: null,
    });

    render(UnstuckReports);

    expect(await screen.findByText(t('unstuckReports.emptyHotspots'))).toBeInTheDocument();
    expect(screen.getByText(t('unstuckReports.emptyReports'))).toBeInTheDocument();
  });

  it('shows an initial failure and retries the full first page', async () => {
    mocks.apiGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(firstPage);

    render(UnstuckReports);

    expect(await screen.findByText(t('unstuckReports.loadFailed'))).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: t('unstuckReports.retry') }));
    expect(await screen.findByText('Ari')).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it('keeps first-page reports and hotspots when a cursor request fails, then retries', async () => {
    let cursorAttempts = 0;
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (!path.includes('beforeId=41')) return firstPage;
      cursorAttempts += 1;
      if (cursorAttempts === 1) throw new Error('offline');
      return secondPage;
    });

    render(UnstuckReports);
    expect(await screen.findByText('Ari')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: t('unstuckReports.loadMore') }));
    expect(await screen.findByText(t('unstuckReports.loadMoreFailed'))).toBeInTheDocument();
    expect(screen.getByText('Ari')).toBeInTheDocument();
    expect(screen.getAllByText('Area: hollow_crypt')).toHaveLength(2);

    await fireEvent.click(screen.getByRole('button', { name: t('unstuckReports.loadMore') }));
    expect(await screen.findByText('Mira')).toBeInTheDocument();
    expect(screen.getAllByText('Area: hollow_crypt')).toHaveLength(2);
  });
});
