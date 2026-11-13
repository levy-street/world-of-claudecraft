// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  dailyRewardsLoadingHtml,
  dailyRewardsTitleHtml,
  wocStoreTabsHtml,
} from '../src/ui/daily_rewards_chrome_view';
import { t } from '../src/ui/i18n';

// The window is the WOC Store only: the daily spin, tasks and leaderboard body
// that once stood in for a disabled store is gone (menu consolidation step 7).
describe('WOC Store shell', () => {
  it('titles and closes the window as the WOC Store', () => {
    const host = document.createElement('div');
    host.innerHTML = dailyRewardsTitleHtml();
    expect(host.querySelector('#daily-rewards-title')?.textContent).toBe(
      t('hudChrome.wocStore.title'),
    );
    expect(host.querySelector('[data-close]')?.getAttribute('aria-label')).toBe(
      t('hudChrome.wocStore.close'),
    );
  });

  it('opens on the Store tabpanel with a decorative spinner', () => {
    const host = document.createElement('div');
    host.innerHTML = dailyRewardsLoadingHtml();
    const panel = host.querySelector('#woc-store-panel');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('woc-store-tab-store');
    expect(panel?.querySelector('.cl-loading')?.getAttribute('aria-hidden')).toBe('true');
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
