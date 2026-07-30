// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.fn(async (path: string) => {
  if (path.includes('/daily-rewards-events')) {
    return {
      day: '2026-07-16',
      rows: [],
      total: 0,
      truncated: false,
    };
  }
  const accountId = path.endsWith('/43') ? 43 : 42;
  return {
    id: accountId,
    username: accountId === 43 ? 'bob' : 'alice',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
    isAdmin: false,
    isAi: false,
    isStreamer: false,
    streamerLinks: {},
    online: false,
    bannedAt: null,
    suspendedUntil: null,
    moderationReason: '',
    chatMutedUntil: null,
    chatMuteReason: '',
    chatStrikes: 0,
    dailyRewardsBan: null,
    dailyRewardsIpBans: [],
    lastLoginIp: null,
    playtimeSeconds: 0,
    characters: [],
    recentSessions: [],
    moderationHistory: [],
  };
});

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (path: string) => apiGet(path),
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import AccountModal from '../../src/admin/components/AccountModal.svelte';
import { t } from '../../src/admin/i18n';

beforeEach(() => {
  apiGet.mockClear();
});

describe('Account modal reward-point tab', () => {
  it('loads lazily, supports keyboard tabs, and resets when the account changes', async () => {
    const onClose = vi.fn();
    const view = render(AccountModal, { props: { accountId: 42, onClose } });

    expect(await screen.findByText('Account: alice')).toBeInTheDocument();
    const overview = screen.getByRole('tab', { name: t('accountModal.tabOverview') });
    const rewards = screen.getByRole('tab', { name: t('accountModal.tabRewardPoints') });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(rewards).toHaveAttribute('tabindex', '-1');
    expect(apiGet.mock.calls.some(([path]) => path.includes('/daily-rewards-events'))).toBe(false);

    await fireEvent.click(rewards);
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/admin/api/accounts/42/daily-rewards-events?limit=100');
    });
    const rewardPanel = screen.getByRole('tabpanel');
    expect(rewardPanel).toHaveAttribute('aria-labelledby', 'account-tab-reward-points');

    rewards.focus();
    await fireEvent.keyDown(rewards, { key: 'ArrowLeft' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveFocus();

    await fireEvent.click(rewards);
    await fireEvent.click(screen.getByRole('button', { name: t('accountRewards.yesterday') }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/admin/api/accounts/42/daily-rewards-events?limit=100&day=2026-07-15',
      );
    });

    await view.rerender({ accountId: 43, onClose });
    expect(await screen.findByText('Account: bob')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: t('accountModal.tabOverview') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      apiGet.mock.calls.some(([path]) => path.includes('/accounts/43/daily-rewards-events')),
    ).toBe(false);
  });
});
