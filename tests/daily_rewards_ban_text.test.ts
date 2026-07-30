import { describe, expect, it } from 'vitest';
import { dailyRewardReasonText } from '../src/ui/daily_rewards_window';

describe('Daily Rewards ban messaging', () => {
  it('shows remaining time, exact expiry, and reason for a timed ban', () => {
    const now = Date.parse('2026-07-16T00:00:00.000Z');
    const message = dailyRewardReasonText(
      {
        eligible: false,
        reason: 'banned',
        walletPubkey: null,
        wocBalance: null,
        wocUsdPrice: null,
        usdValue: null,
        minUsd: 20,
        banReason: 'Leaderboard manipulation',
        banExpiresAt: '2026-07-18T03:30:00.000Z',
      },
      now,
    );

    expect(message).toContain('2d 3h');
    expect(message).toContain('Leaderboard manipulation');
    expect(message).toContain('Jul');
  });

  it('keeps the permanent-ban message when no expiry is present', () => {
    expect(
      dailyRewardReasonText({
        eligible: false,
        reason: 'banned',
        walletPubkey: null,
        wocBalance: null,
        wocUsdPrice: null,
        usdValue: null,
        minUsd: 20,
        banReason: 'Repeated abuse',
        banExpiresAt: null,
      }),
    ).toBe('You are banned from Daily Rewards. Reason: Repeated abuse');
  });
});
