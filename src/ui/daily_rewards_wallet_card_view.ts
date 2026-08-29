// The daily-rewards LOCK card: the panel a player sees instead of the reward
// when their wallet cannot claim it.
//
// Extracted from src/ui/daily_rewards_window.ts by Bank Storage phase 17's
// review round, and taken for the reason the row's other two extractions were:
// correcting a load-bearing comment in that window cost three lines it did not
// have, and raising a ceiling is a maintainer decision. It is a pure function of
// the ready view with no window state behind it, which is what makes it the
// cheapest honest place to find them.
//
// Its whole job is a three-way branch on the lock REASON, and it renders NOTHING
// for a ban, which is the one arm a reader is most likely to get wrong: a banned
// player is told by a different surface entirely and must not be invited to
// connect a wallet.

import type { DailyRewardsView } from './daily_rewards_view';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

export function dailyRewardsWalletCardHtml(
  view: Extract<DailyRewardsView, { kind: 'ready' }>,
): string {
  if (!view.locked) return '';
  const reason = view.lockReason;
  if (reason === 'banned') return '';
  const title =
    reason === 'no_wallet'
      ? t('hudChrome.dailyRewards.walletConnectTitle')
      : t('hudChrome.dailyRewards.walletHoldTitle');
  const body =
    reason === 'no_wallet'
      ? t('hudChrome.dailyRewards.walletConnectBody')
      : reason === 'under_minimum'
        ? t('hudChrome.dailyRewards.walletHoldBody', {
            amount: formatNumber(view.status.eligibility.minUsd, { maximumFractionDigits: 0 }),
          })
        : t('hudChrome.dailyRewards.walletPriceBody');
  const button =
    reason === 'no_wallet'
      ? `<button type="button" class="lb-page-btn" data-wallet-connect>${esc(t('hudChrome.dailyRewards.walletConnectButton'))}</button>`
      : '';
  return (
    `<section class="dr-wallet-card">` +
    `<h3>${esc(title)}</h3>` +
    `<p>${esc(body)}</p>` +
    button +
    `</section>`
  );
}
