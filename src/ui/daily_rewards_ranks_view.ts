// The daily-rewards rewards tab's two RANK panels: today's leaderboard and the
// payout history.
//
// Extracted from src/ui/daily_rewards_window.ts by Bank Storage phase 17's
// review round, and taken for what it buys rather than for tidiness: the fix
// round spent the lines the spin extraction had bought and the file was over its
// ceiling. Raising a ceiling is a maintainer decision, so the phase paid for the
// fixes the way it paid for everything else in it, with the next clean
// extraction.
//
// They are one module because they are one shape: a `.dr-section` holding a
// `.dr-ranks` list that answers the SAME empty state, and both are pure
// functions of a wire record with no window state behind them. Registered in
// UI_PURE_CORES.

import type { DailyRewardHistory, DailyRewardStatus } from '../world_api';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { usdDollarsText } from './usd_text';

/** Today's leaderboard: the participant total, then the ranked rows, with the
 *  viewer's own row marked. An empty board says so rather than rendering an
 *  empty list. */
export function dailyRewardsLeaderboardHtml(status: DailyRewardStatus): string {
  const totalKey =
    status.leaderboardTotal === 1
      ? 'hudChrome.dailyRewards.totalPlayer'
      : 'hudChrome.dailyRewards.totalPlayers';
  const total = `<div class="dr-leaderboard-total">${esc(t(totalKey, { count: formatNumber(status.leaderboardTotal, { maximumFractionDigits: 0 }) }))}</div>`;
  const rows =
    status.leaderboard.length === 0
      ? `<div class="dr-empty">${esc(t('hudChrome.dailyRewards.noLeaders'))}</div>`
      : status.leaderboard
          .map(
            (row) =>
              `<div class="dr-rank${row.me ? ' mine' : ''}"><span>${row.rank}</span><b>${esc(row.name)}</b><strong>${formatNumber(row.points, { maximumFractionDigits: 0 })}</strong></div>`,
          )
          .join('');
  return `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.leaderboard'))}</h3>${total}<div class="dr-ranks dr-leaderboard-ranks">${rows}</div></section>`;
}

/** The last ten payouts, newest first as the wire sends them. */
export function dailyRewardsHistoryHtml(history: DailyRewardHistory): string {
  const rows =
    history.payouts.length === 0
      ? `<div class="dr-empty">${esc(t('hudChrome.dailyRewards.noHistory'))}</div>`
      : history.payouts
          .slice(0, 10)
          .map((row) => {
            const prize = t('hudChrome.dailyRewards.usd', {
              amount: usdDollarsText(row.prizeUsd),
            });
            return `<div class="dr-rank"><span>${esc(row.day)} #${row.rank}</span><b>${esc(row.name)}</b><strong>${esc(prize)}</strong></div>`;
          })
          .join('');
  return `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.history'))}</h3><div class="dr-ranks">${rows}</div></section>`;
}
