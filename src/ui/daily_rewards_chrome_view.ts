// Shared shell markup for the Daily Rewards / WOC Store window. Kept outside
// the coordinator so title, tabs, persistent live region, and first-load state
// remain one cold, localized view builder.

import { dailyRewardReasonText } from './daily_rewards_reason_view';
import type { DailyRewardsView } from './daily_rewards_view';
import { esc } from './esc';
import { formatDateTime, formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';
import { usdDollarsText } from './usd_text';

export function dailyRewardsTitleHtml(storeEnabled: boolean): string {
  const title = storeEnabled ? t('hudChrome.wocStore.title') : t('hudChrome.dailyRewards.title');
  const close = storeEnabled ? t('hudChrome.wocStore.close') : t('hudChrome.dailyRewards.close');
  return (
    `<div class="panel-title ui-win-head"><span id="daily-rewards-title" class="ui-win-title">${esc(title)}</span>` +
    `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(close)}">${svgIcon('close')}</button></div>`
  );
}

export function wocStoreTabsHtml(): string {
  return (
    '<div class="woc-store-tabs">' +
    `<div class="woc-store-tablist ui-seg" role="tablist" aria-label="${esc(t('hudChrome.wocStore.tabsLabel'))}">` +
    `<button id="woc-store-tab-store" class="ui-seg-tab" type="button" role="tab" aria-controls="woc-store-panel" data-woc-store-tab="store">${esc(t('hudChrome.wocStore.storeTab'))}</button>` +
    `<button id="woc-store-tab-memberships" class="ui-seg-tab" type="button" role="tab" aria-controls="woc-store-panel" data-woc-store-tab="memberships">${esc(t('hudChrome.wocStore.membershipsTab'))}</button>` +
    '</div>' +
    `<span class="woc-store-loading" data-woc-store-loading role="status" aria-live="polite" aria-label="${esc(t('hudChrome.wocStore.loading'))}" aria-busy="false"><i aria-hidden="true"></i></span>` +
    '<span class="visually-hidden" data-membership-announcement role="status" aria-live="polite" aria-atomic="true"></span>' +
    `<span class="visually-hidden" data-charter-live role="status" aria-live="polite" aria-atomic="true"></span></div>`
  );
}

export function dailyRewardsLoadingHtml(storeEnabled: boolean): string {
  const spinner = (label: string, live: boolean): string =>
    `<div class="cl-loading"${live ? ' role="status" aria-live="polite"' : ' aria-hidden="true"'}>` +
    '<span class="cl-spinner" aria-hidden="true"></span>' +
    `<span>${esc(label)}</span></div>`;
  return storeEnabled
    ? `<div id="woc-store-panel" class="dr-body woc-store-body" role="tabpanel" aria-labelledby="woc-store-tab-store">${spinner(t('hudChrome.wocStore.loading'), false)}</div>`
    : `<div class="dr-body woc-store-body">${spinner(t('hudChrome.dailyRewards.loading'), true)}</div>`;
}

export function dailyRewardsSummaryHtml(
  view: Extract<DailyRewardsView, { kind: 'ready' }>,
  now: number,
): string {
  const s = view.status;
  const prize =
    s.prizePoolSol === null
      ? t('hudChrome.dailyRewards.unknown')
      : `${t('hudChrome.dailyRewards.sol', {
          amount: formatNumber(s.prizePoolSol, { maximumFractionDigits: 3 }),
        })} (${t('hudChrome.dailyRewards.usd', {
          amount: usdDollarsText(s.prizePoolUsd),
        })})`;
  const reset = formatDateTime(new Date(s.resetAt), { hour: 'numeric', minute: '2-digit' });
  const remaining = dailyRewardsRemainingText(s.resetAt, now);
  const value =
    s.eligibility.usdValue === null
      ? t('hudChrome.dailyRewards.unknown')
      : t('hudChrome.dailyRewards.usd', {
          amount: usdDollarsText(s.eligibility.usdValue),
        });
  const reason = dailyRewardReasonText(s.eligibility, now);
  return (
    `<p class="dr-intro">${esc(t('hudChrome.dailyRewards.intro'))}</p>` +
    `<p class="dr-disclaimer">${esc(t('hudChrome.dailyRewards.disclaimer'))}</p>` +
    `<div class="dr-summary ui-card">` +
    `<div class="ui-card-tile"><span>${esc(t('hudChrome.dailyRewards.prize'))}</span><strong>${esc(prize)}</strong></div>` +
    `<div class="ui-card-tile"><span>${esc(t('hudChrome.dailyRewards.reset'))}</span><strong>${esc(reset)}</strong></div>` +
    `<div class="dr-countdown ui-card-tile"><span data-daily-rewards-countdown="${esc(s.resetAt)}">${esc(t('hudChrome.dailyRewards.endsIn', { time: remaining }))}</span></div>` +
    `<div class="ui-card-tile"><span>${esc(t('hudChrome.dailyRewards.score'))}</span><strong>${formatNumber(s.score, { maximumFractionDigits: 0 })}</strong></div>` +
    `<div class="ui-card-tile"><span>${esc(t('hudChrome.dailyRewards.walletValue'))}</span><strong>${esc(value)}</strong></div>` +
    `<p class="${view.locked ? 'dr-lock' : 'dr-ok'}">${esc(reason)}</p>` +
    `</div>`
  );
}

export function dailyRewardsRemainingText(resetAt: string, now: number): string {
  const ms = Date.parse(resetAt) - now;
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  if (totalMinutes < 1) return t('hudChrome.dailyRewards.remainingLessThanMinute');
  const hours = Math.floor(totalMinutes / 60);
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
