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
    sweepQuote: null,
    orders: [],
    myOrderCount: 0,
    maxOrders: 6,
    unlistedMaterials: [],
    ...over,
  };
}

interface Harness {
  root: HTMLElement;
  window: MarketWindow;
  /** Swap what the window reads next, simulating a snapshot arriving. */
  setInfo(next: MarketInfo | null): void;
  /** Swap the carried bags, simulating a listing escrow or a loot landing. */
  setBags(next: { itemId: string; count: number; instance?: unknown }[]): void;
  /** Every fungible marketList call: item, quantity, total price. */
  lists: [string, number, number][];
}

function harness(initial: MarketInfo): Harness {
  const lists: [string, number, number][] = [];
  const root = document.createElement('div');
  document.body.appendChild(root);
  const world = {
    marketInfo: initial as MarketInfo | null,
    marketCollectPending: false,
    inventory: [{ itemId: ITEM, count: 3 }] as {
      itemId: string;
      count: number;
      instance?: unknown;
    }[],
    marketSearch: () => {},
    marketSellPriceCheck: () => {},
    marketList: (itemId: string, qty: number, total: number) =>
      void lists.push([itemId, qty, total]),
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
    setBags: (next) => {
      world.inventory = next;
    },
    lists,
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

describe('market_window: the Sell tab stock and listing count stay live (world market listed-count report)', () => {
  // Player report: "world market won't update the number of items you listed
  // when selling". The Sell tab is excluded from the general rebuild (it holds
  // typed inputs), so before this fix only the price reference ever repainted:
  // the "of N" label, the quantity cap, and the note's used/max listing count
  // all froze at whatever the form was opened with.
  const qtyOf = (root: HTMLElement): string => root.querySelector('.mkt-qty-of')?.textContent ?? '';
  const qtyInput = (root: HTMLElement): HTMLInputElement | null =>
    root.querySelector<HTMLInputElement>('#mkt-qty');
  const note = (root: HTMLElement): string => root.querySelector('.mkt-note')?.textContent ?? '';

  it('patches the "of N" label and the quantity max when the staged stack changes, keeping typed input', () => {
    const h = harness(info());
    openOnSellTab(h);
    expect(qtyInput(h.root)?.max).toBe('3');
    const qty = qtyInput(h.root);
    const gold = h.root.querySelector<HTMLInputElement>('#mkt-g');
    if (qty) qty.value = '2';
    if (gold) gold.value = '7';

    h.setBags([{ itemId: ITEM, count: 5 }]);
    h.window.refreshIfChanged();

    // Patched in place: the same nodes survive, with the typed values intact.
    expect(qtyInput(h.root)).toBe(qty);
    expect(qtyInput(h.root)?.max).toBe('5');
    expect(qtyInput(h.root)?.value).toBe('2');
    expect(h.root.querySelector<HTMLInputElement>('#mkt-g')?.value).toBe('7');
    expect(qtyOf(h.root)).toContain('5');
  });

  it('rebuilds once (carrying the typed price) when the stock no longer needs a quantity row', () => {
    const h = harness(info());
    openOnSellTab(h);
    const gold = h.root.querySelector<HTMLInputElement>('#mkt-g');
    if (gold) gold.value = '9';

    h.setBags([{ itemId: ITEM, count: 1 }]);
    h.window.refreshIfChanged();

    expect(qtyInput(h.root)).toBeNull();
    expect(h.root.querySelector<HTMLInputElement>('#mkt-g')?.value).toBe('9');
  });

  it('drops to the pick-empty state once the staged stack is gone from the bags', () => {
    const h = harness(info());
    openOnSellTab(h);
    h.setBags([]);
    h.window.refreshIfChanged();
    expect(h.root.querySelector('#mkt-g')).toBeNull();
    expect(h.root.querySelector('.mkt-sell-pick')?.textContent).toBe(
      t('itemUi.market.sellPickEmpty'),
    );
  });

  it('List clamps the typed quantity to the LIVE stack, not the count the form opened with', () => {
    const h = harness(info());
    openOnSellTab(h);
    const qty = qtyInput(h.root);
    const gold = h.root.querySelector<HTMLInputElement>('#mkt-g');
    if (qty) qty.value = '3';
    if (gold) gold.value = '1';
    // Two of the three sold to a vendor while the form stayed open.
    h.setBags([{ itemId: ITEM, count: 2 }]);
    h.window.refreshIfChanged();
    expect(qtyInput(h.root)).toBe(qty);
    h.root.querySelector<HTMLButtonElement>('.mkt-list-btn')?.click();
    expect(h.lists).toHaveLength(1);
    expect(h.lists[0][1]).toBe(2);
  });

  it('drops a staged instanced copy once that copy leaves the bags', () => {
    const h = harness(info());
    const copy = { guid: 'g-1' };
    h.setBags([{ itemId: ITEM, count: 1, instance: copy }]);
    h.window.open();
    h.root.querySelector<HTMLElement>('[data-tab="sell"]')?.click();
    h.window.stageSell(ITEM, copy as never);
    expect(h.root.querySelector('#mkt-g')).not.toBeNull();
    // The online mirror rebuilds the payload object: an equal copy still counts.
    h.setBags([{ itemId: ITEM, count: 1, instance: { guid: 'g-1' } }]);
    h.window.refreshIfChanged();
    expect(h.root.querySelector('#mkt-g')).not.toBeNull();
    // Vendored away while staged: the form must not keep offering it.
    h.setBags([{ itemId: ITEM, count: 1, instance: { guid: 'g-2' } }]);
    h.window.refreshIfChanged();
    expect(h.root.querySelector('#mkt-g')).toBeNull();
  });

  it('patches the note listing count when the snapshot echoes a new listing', () => {
    const h = harness(info());
    openOnSellTab(h);
    expect(note(h.root)).not.toContain('4');
    h.setInfo(info({ myListingCount: 4 }));
    h.window.refreshIfChanged();
    expect(note(h.root)).toContain('4');
  });

  it('an unchanged repeat poll writes nothing (no rebuild, no patch)', () => {
    const h = harness(info({ sellPriceItemId: ITEM, sellLowestPrice: 50 }));
    openOnSellTab(h);
    h.window.refreshIfChanged(); // settle any first-poll latch
    const before = h.root.querySelector('#market-body')?.firstElementChild;
    const writes: MutationRecord[] = [];
    const obs = new MutationObserver((m) => writes.push(...m));
    obs.observe(h.root, { subtree: true, childList: true, attributes: true, characterData: true });
    h.window.refreshIfChanged();
    h.window.refreshIfChanged();
    writes.push(...obs.takeRecords());
    obs.disconnect();
    expect(writes).toEqual([]);
    expect(h.root.querySelector('#market-body')?.firstElementChild).toBe(before);
  });

  it('paints the form once market data arrives after a no-data Sell paint', () => {
    const h = harness(info());
    openOnSellTab(h);
    h.setInfo(null);
    h.window.render();
    expect(h.root.querySelector('#mkt-g')).toBeNull();
    h.setInfo(info());
    h.window.refreshIfChanged();
    expect(h.root.querySelector('#mkt-g')).not.toBeNull();
  });
});
