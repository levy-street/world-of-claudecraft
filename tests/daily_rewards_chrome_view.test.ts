// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  dailyRewardsRemainingText,
  dailyRewardsSummaryHtml,
  wocStoreTabsHtml,
} from '../src/ui/daily_rewards_chrome_view';
import type { DailyRewardsView } from '../src/ui/daily_rewards_view';
import { t } from '../src/ui/i18n';

describe('daily reward summary', () => {
  const resetAt = '2026-08-26T00:00:00.000Z';
  const reset = Date.parse(resetAt);

  it.each([
    [reset + 1, 'hudChrome.dailyRewards.remainingLessThanMinute', {}],
    [reset - 1, 'hudChrome.dailyRewards.remainingMinutes', { minutes: '1' }],
    [
      reset - 61 * 60_000,
      'hudChrome.dailyRewards.remainingHoursMinutes',
      { hours: '1', minutes: '1' },
    ],
  ] as const)('formats the countdown at %s from the supplied clock', (now, key, values) => {
    expect(dailyRewardsRemainingText(resetAt, now)).toBe(t(key, values));
  });

  it('renders unknown balances and retains the countdown target and eligibility state', () => {
    const view = {
      kind: 'ready',
      locked: true,
      lockReason: 'no_wallet',
      status: {
        resetAt,
        prizePoolSol: null,
        prizePoolUsd: 0,
        score: 12,
        eligibility: { reason: 'no_wallet', usdValue: null },
      },
    } as Extract<DailyRewardsView, { kind: 'ready' }>;
    const host = document.createElement('div');
    host.innerHTML = dailyRewardsSummaryHtml(view, reset);
    expect(
      host
        .querySelector('[data-daily-rewards-countdown]')
        ?.getAttribute('data-daily-rewards-countdown'),
    ).toBe(resetAt);
    expect(host.querySelector('[data-daily-rewards-countdown]')?.textContent).toBe(
      t('hudChrome.dailyRewards.endsIn', {
        time: t('hudChrome.dailyRewards.remainingLessThanMinute'),
      }),
    );
    expect(host.querySelectorAll('strong')[0].textContent).toBe(
      t('hudChrome.dailyRewards.unknown'),
    );
    expect(host.querySelector('.dr-lock')).not.toBeNull();
  });
});

describe('wocStoreTabsHtml', () => {
  it('keeps only tabs inside the tablist and places live statuses beside it', () => {
    const host = document.createElement('div');
    host.innerHTML = wocStoreTabsHtml();
    const strip = host.querySelector('.woc-store-tabs') as HTMLElement;
    expect(strip).not.toBeNull();
    const tablist = strip.querySelector('.woc-store-tablist[role="tablist"]') as HTMLElement;
    expect(tablist).not.toBeNull();
    expect([...tablist.children].map((child) => child.getAttribute('role'))).toEqual([
      'tab',
      'tab',
    ]);
    expect(tablist.querySelector('[role="status"]')).toBeNull();
    expect(strip.querySelector('[data-woc-store-loading]')?.parentElement).toBe(strip);
    expect(strip.querySelector('[data-charter-live]')?.parentElement).toBe(strip);
  });
});
