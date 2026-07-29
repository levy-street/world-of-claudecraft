// @vitest-environment happy-dom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const overviewData = {
  accounts: 12,
  characters: 30,
  accountsToday: 2,
  accountsWeek: 5,
  accountsMonth: 8,
  sessionsToday: 8,
  activeAccountsToday: 4,
  activeAccountsWeek: 7,
  activeAccountsMonth: 10,
  returningAccountsToday: 2,
  avgPlaytimeSeconds: 900,
  peakOnlineToday: 9,
  peakOnlineAllTime: 14,
  playersCap: 512,
  siteUsersNow: 6,
  server: {
    online: 3,
    onlineAccounts: 2,
    peakOnline: 9,
    uptimeSeconds: 3600,
    tickMsAvg: 2,
    simEntities: 5,
    rssBytes: 1048576,
    heapUsedBytes: 524288,
  },
};
const activityData = {
  days: 7,
  registrations: [{ day: '2026-06-01', count: 3 }],
  sessions: [],
  classes: [],
  levels: [],
};
const onlineHistoryData = {
  range: '24h',
  bucket: 'hour',
  points: [
    {
      bucketStart: '2026-06-01T12:00:00Z',
      avgPlayers: 2,
      peakPlayers: 3,
      avgAccounts: 2,
      peakAccounts: 2,
      avgSiteUsers: 5,
      peakSiteUsers: 6,
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
import Overview from '../../src/admin/pages/Overview.svelte';

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/api/overview')) return overviewData;
    if (path.startsWith('/admin/api/online-history')) return onlineHistoryData;
    if (path.startsWith('/admin/api/activity')) return activityData;
    throw new Error(`unexpected path ${path}`);
  });
});

describe('Overview', () => {
  it('renders live stats and activity controls', async () => {
    render(Overview);
    expect(await screen.findByText(t('stats.onlineNow'))).toBeInTheDocument();
    expect(await screen.findByText(t('stats.siteUsersNow'))).toBeInTheDocument();
    // The realm player-cap StatCard: its label and its bound value (distinctive, so a
    // card wired to the wrong field would not render 512) both render.
    expect(screen.getByText(t('stats.playersCap'))).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('charts.range.24h') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // The live roster moved to its own Players page: the dashboard must not render it
  // nor keep paying for the roster request on its 5s tick.
  it('no longer fetches or renders the online roster', async () => {
    render(Overview);
    await screen.findByText(t('stats.onlineNow'));

    expect(screen.queryByText(t('online.colCharacter'))).not.toBeInTheDocument();
    expect(
      mocks.apiGet.mock.calls.map(([path]) => path).filter((path) => path === '/admin/api/online'),
    ).toEqual([]);
  });

  // A rejected live-stats fetch must not swallow the error into console.error alone:
  // the stats section renders a failed state instead of staying blank forever.
  it('shows a failed state when the live stats fetch rejects', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/api/overview')) throw new Error('network error');
      if (path.startsWith('/admin/api/online-history')) return onlineHistoryData;
      if (path.startsWith('/admin/api/activity')) return activityData;
      throw new Error(`unexpected path ${path}`);
    });

    render(Overview);

    expect(await screen.findByText(t('stats.loadFailed'))).toBeInTheDocument();
    expect(screen.queryByText(t('stats.onlineNow'))).not.toBeInTheDocument();
  });

  // Same contract for the activity/online-history request pair driving the charts
  // section: a rejection shows a failed state rather than blank charts.
  it('shows a failed state when the activity charts fetch rejects', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/api/overview')) return overviewData;
      if (path.startsWith('/admin/api/online-history')) throw new Error('network error');
      if (path.startsWith('/admin/api/activity')) return activityData;
      throw new Error(`unexpected path ${path}`);
    });

    render(Overview);

    expect(await screen.findByText(t('charts.loadFailed'))).toBeInTheDocument();
    expect(screen.queryByText(t('charts.classDistribution'))).not.toBeInTheDocument();
  });
});
