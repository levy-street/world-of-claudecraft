// Shared shell markup for the Daily Rewards / WOC Store window. Kept outside
// the coordinator so title, tabs, persistent live region, and first-load state
// remain one cold, localized view builder.

import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

export function dailyRewardsTitleHtml(storeEnabled: boolean): string {
  const title = storeEnabled ? t('hudChrome.wocStore.title') : t('hudChrome.dailyRewards.title');
  const close = storeEnabled ? t('hudChrome.wocStore.close') : t('hudChrome.dailyRewards.close');
  return (
    `<div class="panel-title"><span id="daily-rewards-title">${esc(title)}</span>` +
    `<button type="button" class="x-btn" data-close aria-label="${esc(close)}">${svgIcon('close')}</button></div>`
  );
}

export function wocStoreTabsHtml(): string {
  return (
    '<div class="woc-store-tabs">' +
    `<div class="woc-store-tablist" role="tablist" aria-label="${esc(t('hudChrome.wocStore.tabsLabel'))}">` +
    `<button id="woc-store-tab-store" type="button" role="tab" aria-controls="woc-store-panel" data-woc-store-tab="store">${esc(t('hudChrome.wocStore.storeTab'))}</button>` +
    `<button id="woc-store-tab-rewards" type="button" role="tab" aria-controls="woc-store-panel" data-woc-store-tab="rewards">${esc(t('hudChrome.wocStore.rewardsTab'))}</button>` +
    '</div>' +
    `<span class="woc-store-loading" data-woc-store-loading role="status" aria-live="polite" aria-label="${esc(t('hudChrome.wocStore.loading'))}" aria-busy="false"><i aria-hidden="true"></i></span>` +
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
