// The Daily Rewards eligibility line (src/ui/daily_rewards_window.ts): the
// reason a wallet cannot claim today, with a ban's remaining time spelled
// through the formatters. Pure (i18n keys plus Intl), so a Vitest pins the
// wording without the window; moved out of the window when the mount inspect
// wiring landed so the coordinator stays under its ratchet.

import type { DailyRewardStatus } from '../world_api';
import { formatDateTime, formatNumber, t } from './i18n';

function remainingBanText(expiresAt: string, nowMs: number): string {
  const totalMinutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMs) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  if (days > 0) {
    return t('hudChrome.dailyRewards.remainingDaysHours', {
      days: formatNumber(days, { maximumFractionDigits: 0 }),
      hours: formatNumber(hours, { maximumFractionDigits: 0 }),
    });
  }
  if (totalMinutes < 1) return t('hudChrome.dailyRewards.remainingLessThanMinute');
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return t('hudChrome.dailyRewards.remainingMinutes', {
      minutes: formatNumber(minutes, { maximumFractionDigits: 0 }),
    });
  }
  return t('hudChrome.dailyRewards.remainingHoursMinutes', {
    hours: formatNumber(hours, { maximumFractionDigits: 0 }),
    minutes: formatNumber(minutes, { maximumFractionDigits: 0 }),
  });
}

export function dailyRewardReasonText(
  eligibility: DailyRewardStatus['eligibility'],
  nowMs: number,
): string {
  switch (eligibility.reason) {
    case 'eligible':
      return t('hudChrome.dailyRewards.reason.eligible');
    case 'no_wallet':
      return t('hudChrome.dailyRewards.reason.no_wallet');
    case 'under_minimum':
      return t('hudChrome.dailyRewards.reason.under_minimum');
    case 'price_unavailable':
      return t('hudChrome.dailyRewards.reason.price_unavailable');
    case 'banned':
      if (eligibility.banExpiresAt && Number.isFinite(Date.parse(eligibility.banExpiresAt))) {
        return t('hudChrome.dailyRewards.reason.bannedUntil', {
          reason: eligibility.banReason ?? t('hudChrome.dailyRewards.unknown'),
          remaining: remainingBanText(eligibility.banExpiresAt, nowMs),
          until: formatDateTime(new Date(eligibility.banExpiresAt), {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
        });
      }
      return t('hudChrome.dailyRewards.reason.banned', {
        reason: eligibility.banReason ?? t('hudChrome.dailyRewards.unknown'),
      });
  }
}
