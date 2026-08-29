// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { wocStoreTabsHtml } from '../src/ui/daily_rewards_chrome_view';

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
