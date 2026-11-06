// Shared shell markup for the WOC Store window (#daily-rewards-window, the id
// predates the store). Kept outside the coordinator so title, tabs, persistent
// live region, and first-load state remain one cold, localized view builder.
// The daily spin, tasks and leaderboard body that once stood in for a disabled
// store is gone (no longer a live feature, menu consolidation step 7).

import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

export function dailyRewardsTitleHtml(): string {
  return (
    `<div class="panel-title ui-win-head"><span id="daily-rewards-title" class="ui-win-title">${esc(t('hudChrome.wocStore.title'))}</span>` +
    `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(t('hudChrome.wocStore.close'))}">${svgIcon('close')}</button></div>`
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
    `<span class="visually-hidden" data-charter-live role="status" aria-live="polite" aria-atomic="true"></span></div>`
  );
}

export function dailyRewardsLoadingHtml(): string {
  return (
    `<div id="woc-store-panel" class="dr-body woc-store-body" role="tabpanel" aria-labelledby="woc-store-tab-store">` +
    `<div class="cl-loading" aria-hidden="true"><span class="cl-spinner" aria-hidden="true"></span>` +
    `<span>${esc(t('hudChrome.wocStore.loading'))}</span></div></div>`
  );
}
