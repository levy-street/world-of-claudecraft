// @vitest-environment happy-dom
//
// The World Market Browse "lowest price of each" toggle (issue #3103): a real
// labeled checkbox that round-trips through marketSearch like every other filter
// axis (search box / type / subtype / armor class / primary stat / rarity), so the
// server can collapse the WHOLE market, not just the wired page. Driven against the
// real MarketWindow painter (the market_buy_confirm harness idiom), not source text.

import { describe, expect, it } from 'vitest';
import type { MarketQuery } from '../src/sim/market_query';
import type { ItemSlot } from '../src/sim/types';
import { MarketWindow, type MarketWindowDeps } from '../src/ui/market_window';
import type { IWorld, MarketInfo } from '../src/world_api';

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
    maxListings: 16,
    myListingCount: 0,
    sellPriceItemId: null,
    sellLowestPrice: null,
    ...over,
  };
}

interface Harness {
  root: HTMLElement;
  window: MarketWindow;
  queries: MarketQuery[];
}

function harness(): Harness {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const queries: MarketQuery[] = [];
  const world = {
    marketInfo: info() as MarketInfo | null,
    marketCollectPending: false,
    inventory: [],
    marketSearch: (q: MarketQuery) => queries.push(q),
    marketSellPriceCheck: () => {},
    marketList: () => {},
    marketBuy: () => {},
    marketCancel: () => {},
    marketCollect: () => {},
  };
  const noop = (): void => {};
  const deps: MarketWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showError: noop,
    slotName: (slot: ItemSlot) => String(slot),
    syncBags: noop,
    confirmDialog: noop as unknown as MarketWindowDeps['confirmDialog'],
  };
  return { root, window: new MarketWindow(deps), queries };
}

function toggle(root: HTMLElement): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>('.mkt-collapse-checkbox');
  expect(el, 'the lowest-price toggle checkbox must render on the Browse tab').toBeTruthy();
  if (!el) throw new Error('unreachable');
  return el;
}

describe('market window: lowest-price Browse toggle (issue #3103)', () => {
  it('opens unchecked and sends collapseLowest:false with the initial query', () => {
    const h = harness();
    h.window.open();
    expect(toggle(h.root).checked).toBe(false);
    expect(h.queries.at(-1)?.collapseLowest).toBe(false);
  });

  it('checking the toggle re-sends the query with collapseLowest:true and resets the page', () => {
    const h = harness();
    h.window.open();
    const box = toggle(h.root);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    const last = h.queries.at(-1);
    expect(last?.collapseLowest).toBe(true);
    expect(last?.page).toBe(0);
    // The control survives its own rebuild in the checked state (WCAG 2.4.3 focus
    // aside; this asserts the repaint reflects the state that drove it).
    expect(toggle(h.root).checked).toBe(true);
  });

  it('unchecking it again round-trips collapseLowest back to false', () => {
    const h = harness();
    h.window.open();
    const box = toggle(h.root);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    const boxAgain = toggle(h.root);
    boxAgain.checked = false;
    boxAgain.dispatchEvent(new Event('change'));
    expect(h.queries.at(-1)?.collapseLowest).toBe(false);
    expect(toggle(h.root).checked).toBe(false);
  });

  it('resets to unchecked on a fresh open, even after being left checked', () => {
    const h = harness();
    h.window.open();
    const box = toggle(h.root);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    h.window.close();
    h.window.open();
    expect(toggle(h.root).checked).toBe(false);
    expect(h.queries.at(-1)?.collapseLowest).toBe(false);
  });

  it('is a real labeled checkbox, not a bare icon toggle (WCAG 2.2 AA name)', () => {
    const h = harness();
    h.window.open();
    const label = h.root.querySelector('label.mkt-collapse-toggle');
    expect(label).toBeTruthy();
    expect(label?.querySelector('input[type="checkbox"].mkt-collapse-checkbox')).toBeTruthy();
    expect(label?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
