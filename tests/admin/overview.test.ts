// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

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
  usage: { generatedAt: '2026-06-01T00:00:00Z', windows: [], metrics: [], caches: [] },
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

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: vi.fn(async (path: string) => {
    if (path.startsWith('/admin/api/overview')) return overviewData;
    if (path.startsWith('/admin/api/online-history')) return onlineHistoryData;
    if (path.startsWith('/admin/api/online')) return { players: [] };
    if (path.startsWith('/admin/api/activity')) return activityData;
    throw new Error(`unexpected path ${path}`);
  }),
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'alice',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import Overview from '../../src/admin/pages/Overview.svelte';

describe('Overview', () => {
  it('renders live stats, online players, and activity controls', async () => {
    render(Overview);
    expect(await screen.findByText(t('stats.onlineNow'))).toBeInTheDocument();
    expect(await screen.findByText(t('stats.siteUsersNow'))).toBeInTheDocument();
    expect(screen.getByText(t('online.empty'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('charts.range.24h') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
