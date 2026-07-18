// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const eventLog = {
  day: '2026-07-16',
  rows: [
    {
      id: 8,
      createdAt: '2026-07-16T03:00:00.000Z',
      kind: 'task',
      points: 20,
      totalPoints: 50,
      meta: { taskType: 'quest_completion', questId: 'wolf_hunt', multiplier: 2 },
    },
  ],
  total: 1,
  truncated: false,
};

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: vi.fn(async () => eventLog),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { apiGet } from '../../src/admin/api';
import DailyRewardPointEvents from '../../src/admin/components/DailyRewardPointEvents.svelte';
import DailyRewardsModerationControls from '../../src/admin/components/DailyRewardsModerationControls.svelte';
import { t } from '../../src/admin/i18n';
import type { PendingAction } from '../../src/admin/moderation_actions';

beforeEach(() => {
  vi.mocked(apiGet).mockClear();
});

describe('Daily Rewards moderation controls', () => {
  it('submits a whole-hour timed ban and identifies permanent as the blank default', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(DailyRewardsModerationControls, {
      props: {
        target: {
          id: 42,
          dailyRewardsBan: null,
          dailyRewardsIpBans: [],
          lastLogin: null,
          lastLoginIp: null,
          recentSessions: [],
        },
        onSubmit,
      },
    });

    const duration = screen.getByRole('spinbutton', {
      name: new RegExp(`^${t('detail.dailyRewardsBanDuration')}`),
    });
    expect(duration).toHaveAttribute('placeholder', t('detail.dailyRewardsBanDurationPlaceholder'));
    await fireEvent.input(duration, { target: { value: '6' } });
    await fireEvent.click(screen.getByRole('button', { name: t('detail.dailyRewardsBan') }));
    expect(screen.getByText(t('detail.lengthHours', { count: 6 }))).toBeInTheDocument();

    const reason = screen.getByPlaceholderText(t('detail.notePlaceholder'));
    await fireEvent.input(reason, { target: { value: 'Automated play' } });
    await fireEvent.click(screen.getByRole('button', { name: t('dialog.confirm') }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/moderation/accounts/42/daily-rewards-ban',
      body: { reason: 'Automated play', durationHours: 6 },
    });
  });

  it('shows an active timed ban expiry and remaining duration', () => {
    render(DailyRewardsModerationControls, {
      props: {
        target: {
          id: 42,
          dailyRewardsBan: {
            reason: 'Automated play',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
          dailyRewardsIpBans: [],
          lastLogin: null,
          lastLoginIp: null,
          recentSessions: [],
        },
        onSubmit: vi.fn(async () => true),
      },
    });

    expect(
      screen.getByText(t('detail.dailyRewardsBanReason', { value: 'Automated play' })),
    ).toBeInTheDocument();
    expect(screen.getByText(/Time remaining:/)).toBeInTheDocument();
    expect(screen.getByText(/Access returns:/)).toBeInTheDocument();
  });
});

describe('Daily Rewards point events', () => {
  it('loads the selected account and date and renders points with action metadata', async () => {
    render(DailyRewardPointEvents, { props: { accountId: 42 } });

    expect(await screen.findByText('Quest completed: wolf_hunt')).toBeInTheDocument();
    expect(screen.getByText('+20')).toBeInTheDocument();
    expect(screen.getByText('x2 reward multiplier')).toBeInTheDocument();
    expect(vi.mocked(apiGet).mock.calls[0][0]).toBe(
      '/admin/api/accounts/42/daily-rewards-events?limit=100',
    );

    await fireEvent.click(screen.getByRole('button', { name: t('accountRewards.yesterday') }));
    await waitFor(() => {
      expect(vi.mocked(apiGet).mock.calls[1][0]).toBe(
        '/admin/api/accounts/42/daily-rewards-events?limit=100&day=2026-07-15',
      );
    });
  });
});
