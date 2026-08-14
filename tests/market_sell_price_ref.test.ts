// @vitest-environment happy-dom
//
// The Sell tab's async price-reference echo (issue 3043): a REGRESSION suite for
// the online repaint gap found in review. market_window.test.ts is a source-text
// scan (it pins that refreshSellPriceRef is CALLED in the right place, and that
// every sellItemId clear re-arms the check), which cannot catch a bug in what the
// patch actually PAINTS; this file drives the real MarketWindow painter through a
// real DOM instead, the market_buy_confirm.test.ts harness precedent (a stubbed
// IWorld whose marketInfo can be swapped mid-test to simulate an async snapshot
// arriving, exactly what a ClientWorld's applySnapshot does one tick later).

import { describe, expect, it } from 'vitest';
import { t } from '../src/ui/i18n';
import { MarketWindow, type MarketWindowDeps } from '../src/ui/market_window';
import type { IWorld, MarketInfo } from '../src/world_api';

const ITEM = 'worn_sword';

function info(over: Partial<MarketInfo> = {}): MarketInfo {
  return {
    listings: [],
    totalCount: 0,
    filter: '',
    itemType: 'all',
    subtype: 'all',
    armorClass: 'all',
    primaryStat: 'all',
    rarity: 'all',
    sort: 'name',
    collapseLowest: false,
    page: 0,
    pageCount: 1,
    collectionCopper: 0,
    collectionItems: [],
    collectionSales: [],
    collectionSalesOmitted: 0,
    cutPct: 5,
    maxListings: 12,
    myListingCount: 0,
    sellPriceItemId: null,
    sellLowestPrice: null,
    ...over,
  };
}

interface Harness {
  root: HTMLElement;
  window: MarketWindow;
  /** Swap what the window reads next, simulating a snapshot arriving. */
  setInfo(next: MarketInfo | null): void;
}

function harness(initial: MarketInfo): Harness {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const world = {
    marketInfo: initial as MarketInfo | null,
    marketCollectPending: false,
    inventory: [{ itemId: ITEM, count: 3 }],
    marketSearch: () => {},
    marketSellPriceCheck: () => {},
    marketList: () => {},
    marketListInstance: () => {},
    marketBuy: () => {},
    marketCancel: () => {},
    marketCollect: () => {},
  };
  const noop = (): void => {};
  const deps: MarketWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showError: noop,
    slotName: (slot) => String(slot),
    syncBags: noop,
    confirmDialog: noop,
  };
  return {
    root,
    window: new MarketWindow(deps),
    setInfo: (next) => {
      world.marketInfo = next;
    },
  };
}

function openOnSellTab(h: Harness): void {
  h.window.open();
  h.root.querySelector<HTMLElement>('[data-tab="sell"]')?.click();
  h.window.stageSell(ITEM);
}

function priceRefText(root: HTMLElement): string {
  return root.querySelector('.mkt-sell-price-ref')?.textContent ?? '';
}

function priceRefStatusText(root: HTMLElement): string {
  return root.querySelector('.mkt-sell-price-status')?.textContent ?? '';
}

describe('market_window: the Sell tab price reference repaints on the async echo (issue 3043)', () => {
  it('renders nothing while the echo has not caught up yet to the staged item', () => {
    const h = harness(info());
    openOnSellTab(h);
    // The world stub never mutates marketInfo on its own (a real ClientWorld only
    // does so on the next decoded snapshot), so the echo is still stale here,
    // matching the real online timing right after stageSell() sends its command.
    expect(priceRefText(h.root)).toBe('');
  });

  it('patches the numeric price in once the echo arrives, without another user action', () => {
    const h = harness(info());
    openOnSellTab(h);
    expect(priceRefText(h.root)).toBe('');

    h.setInfo(info({ sellPriceItemId: ITEM, sellLowestPrice: 4200 }));
    h.window.refreshIfChanged();

    expect(priceRefText(h.root)).toContain('4200');
    expect(priceRefStatusText(h.root)).toContain('4200');
  });

  it('patches the "no active listings" copy in once the echo confirms null: the exact bug found in review', () => {
    const h = harness(info());
    openOnSellTab(h);
    expect(priceRefText(h.root)).toBe('');

    // The server confirms there are no active listings: sellLowestPrice is null,
    // distinct from the "echo has not caught up yet" undefined the priceEcho
    // guard reads beforehand. JSON.stringify encodes an array's undefined
    // ELEMENT as the literal null, so a signature built with a bare
    // JSON.stringify([itemId, priceRef]) reads "pending" and "confirmed empty"
    // as the SAME value and never repaints; that was the actual defect.
    h.setInfo(info({ sellPriceItemId: ITEM, sellLowestPrice: null }));
    h.window.refreshIfChanged();

    expect(priceRefText(h.root)).toBe(t('itemUi.market.lowestPriceNone'));
    expect(priceRefStatusText(h.root)).toBe(t('itemUi.market.lowestPriceNone'));
  });

  it('never touches the typed price inputs when the echo arrives (the whole reason for the narrow patch)', () => {
    const h = harness(info());
    openOnSellTab(h);
    const goldInput = h.root.querySelector<HTMLInputElement>('#mkt-g');
    expect(goldInput, 'expected the price form to be showing').toBeTruthy();
    if (goldInput) goldInput.value = '7';

    h.setInfo(info({ sellPriceItemId: ITEM, sellLowestPrice: 4200 }));
    h.window.refreshIfChanged();

    expect(h.root.querySelector<HTMLInputElement>('#mkt-g')?.value).toBe('7');
  });

  it('ignores an echo for a DIFFERENT item than the one currently staged (a switch mid-flight)', () => {
    const h = harness(info());
    openOnSellTab(h);
    h.setInfo(info({ sellPriceItemId: 'healing_potion', sellLowestPrice: 999 }));
    h.window.refreshIfChanged();
    expect(priceRefText(h.root)).toBe('');
  });

  it('re-opening the window resets to the Browse tab, leaving no stale price-ref node behind', () => {
    const h = harness(info());
    openOnSellTab(h);
    h.setInfo(info({ sellPriceItemId: ITEM, sellLowestPrice: 4200 }));
    h.window.refreshIfChanged();
    expect(priceRefText(h.root)).toContain('4200');

    h.window.close();
    h.window.open();
    expect(h.root.querySelector('.mkt-sell-price-ref')).toBeNull();
  });
});
