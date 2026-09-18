// @vitest-environment happy-dom
//
// The Market Sweep card through the real MarketWindow painter (the
// market_buy_confirm.test.ts harness idiom): a browse row's Sweep button stages
// the card, editing the count re-asks the server, the quote line lands when the
// echo arrives, and the Sweep button confirms the QUOTED total before sending it
// as the cap; a quote that moved under the prompt is refused with a reason.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemSlot } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { formatMoney, t } from '../src/ui/i18n';
import { MarketWindow, type MarketWindowDeps } from '../src/ui/market_window';
import type { IWorld, MarketInfo, MarketListingView, MarketSweepQuote } from '../src/world_api';

const ORE = 'copper_ore';

function listing(over: Partial<MarketListingView> = {}): MarketListingView {
  return {
    id: 7,
    sellerName: 'Halden',
    itemId: ORE,
    count: 5,
    price: 25,
    mine: false,
    house: false,
    ...over,
  };
}

function info(
  listings: MarketListingView[],
  sweepQuote: MarketSweepQuote | null = null,
): MarketInfo {
  return {
    listings,
    totalCount: listings.length,
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
    sweepQuote,
  };
}

interface Confirm {
  title: string;
  body: string;
  ok: string;
  onOk: () => void;
}

function harness(initial: MarketInfo) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const confirms: Confirm[] = [];
  const quotes: [string, number][] = [];
  const sweeps: [string, number, number][] = [];
  const errors: string[] = [];
  const world = {
    marketInfo: initial as MarketInfo | null,
    marketCollectPending: false,
    inventory: [],
    marketSearch: () => {},
    marketSellPriceCheck: () => {},
    marketList: () => {},
    marketBuy: () => {},
    marketSweepQuote: (item: string, count: number) => quotes.push([item, count]),
    marketSweep: (item: string, count: number, max: number) => sweeps.push([item, count, max]),
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
    showError: (text: string) => errors.push(text),
    slotName: (slot: ItemSlot) => String(slot),
    syncBags: noop,
    confirmDialog: (title, body, ok, _cancel, onOk) => confirms.push({ title, body, ok, onOk }),
  };
  const window = new MarketWindow(deps);
  window.open();
  return {
    root,
    window,
    setInfo: (next: MarketInfo | null) => {
      world.marketInfo = next;
    },
    confirms,
    quotes,
    sweeps,
    errors,
  };
}

const sweepButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.mkt-sweep-btn');
const card = (root: HTMLElement) => root.querySelector<HTMLElement>('.mkt-sweep');
const quoteLine = (root: HTMLElement) => card(root)?.querySelector<HTMLElement>('.mkt-sweep-quote');
const goButton = (root: HTMLElement) =>
  card(root)?.querySelector<HTMLButtonElement>('.mkt-sweep-go');
const qtyInput = (root: HTMLElement) =>
  card(root)?.querySelector<HTMLInputElement>('#mkt-sweep-qty');

const quote = (over: Partial<MarketSweepQuote> = {}): MarketSweepQuote => ({
  itemId: ORE,
  count: 1,
  units: 5,
  listings: 1,
  total: 25,
  short: false,
  ...over,
});

describe('market window: the Market Sweep card', () => {
  it('offers Sweep only on eligible rows and stages the card with a quote request', () => {
    const h = harness(
      info([
        listing(),
        listing({ id: 8, mine: true }),
        listing({ id: 9, house: true }),
        listing({ id: 10, craftedRecipeId: 'recipe_copper_bar' }),
      ]),
    );
    expect(h.root.querySelectorAll('.mkt-sweep-btn').length).toBe(1);
    expect(card(h.root)).toBeNull();
    sweepButton(h.root)?.click();
    const c = card(h.root);
    expect(c).not.toBeNull();
    expect(c?.getAttribute('aria-label')).toBe(
      t('itemUi.market.sweepTitle', { item: itemDisplayName(ITEMS[ORE]) }),
    );
    expect(h.quotes).toEqual([[ORE, 1]]);
    // No echo yet: the line is empty and Sweep is disabled (never a stale quote).
    expect(quoteLine(h.root)?.textContent).toBe('');
    expect(goButton(h.root)?.disabled).toBe(true);
  });

  it('re-asks on a count edit and paints the quote when the matching echo lands', () => {
    const h = harness(info([listing()]));
    sweepButton(h.root)?.click();
    const qty = qtyInput(h.root);
    if (!qty) throw new Error('no count field');
    qty.value = '12';
    qty.dispatchEvent(new Event('input'));
    expect(h.quotes).toEqual([
      [ORE, 1],
      [ORE, 12],
    ]);
    // A snapshot answering the OLD count is ignored...
    h.setInfo(info([listing()], quote({ count: 1 })));
    h.window.refreshIfChanged();
    expect(quoteLine(h.root)?.textContent).toBe('');
    // ...the one answering the staged count is painted in place, the field intact.
    h.setInfo(info([listing()], quote({ count: 12, units: 15, listings: 3, total: 75 })));
    h.window.refreshIfChanged();
    expect(qtyInput(h.root)?.value).toBe('12');
    expect(quoteLine(h.root)?.textContent).toBe(
      t('itemUi.market.sweepQuoteLine', {
        units: '15',
        listings: '3',
        total: formatMoney(75),
        each: formatMoney(5),
      }),
    );
    expect(goButton(h.root)?.disabled).toBe(false);
  });

  it('names a short book and an empty one', () => {
    const h = harness(info([listing()]));
    sweepButton(h.root)?.click();
    h.setInfo(info([listing()], quote({ units: 5, total: 25, short: true })));
    h.window.refreshIfChanged();
    expect(quoteLine(h.root)?.textContent).toBe(
      t('itemUi.market.sweepQuoteShort', {
        units: '5',
        listings: '1',
        total: formatMoney(25),
        each: formatMoney(5),
      }),
    );
    h.setInfo(info([listing()], quote({ units: 0, listings: 0, total: 0, short: true })));
    h.window.refreshIfChanged();
    expect(quoteLine(h.root)?.textContent).toBe(t('itemUi.market.sweepQuoteNone'));
    expect(goButton(h.root)?.disabled).toBe(true);
  });

  it('confirms the quoted terms, then sends the quoted total as the cap', () => {
    const h = harness(info([listing()]));
    sweepButton(h.root)?.click();
    h.setInfo(info([listing()], quote()));
    h.window.refreshIfChanged();
    goButton(h.root)?.click();
    expect(h.sweeps).toEqual([]);
    expect(h.confirms.length).toBe(1);
    expect(h.confirms[0].title).toBe(t('itemUi.market.sweepConfirmTitle'));
    expect(h.confirms[0].body).toBe(
      t('itemUi.market.sweepConfirmBody', {
        item: itemDisplayName(ITEMS[ORE]),
        units: '5',
        listings: '1',
        total: formatMoney(25),
        each: formatMoney(5),
      }),
    );
    h.confirms[0].onOk();
    expect(h.sweeps).toEqual([[ORE, 1, 25]]);
    expect(h.errors).toEqual([]);
  });

  it('refuses a quote that moved under the prompt, and one that vanished', () => {
    const h = harness(info([listing()]));
    sweepButton(h.root)?.click();
    h.setInfo(info([listing()], quote()));
    h.window.refreshIfChanged();
    goButton(h.root)?.click();
    h.setInfo(info([listing()], quote({ total: 30 })));
    h.confirms[0].onOk();
    expect(h.sweeps).toEqual([]);
    expect(h.errors).toEqual([t('itemUi.market.sweepChanged')]);
    h.setInfo(null);
    h.confirms[0].onOk();
    expect(h.sweeps).toEqual([]);
    expect(h.errors[1]).toBe(t('itemUi.errors.sweepNoListings'));
  });

  it('clears the staged quote when the player leaves the Browse tab', () => {
    const h = harness(info([listing()]));
    sweepButton(h.root)?.click();
    h.root.querySelector<HTMLElement>('[data-tab="sell"]')?.click();
    expect(h.quotes).toEqual([
      [ORE, 1],
      [ORE, 0],
    ]);
  });

  it('closes the card on its Close button and clears the staged quote', () => {
    const h = harness(info([listing()]));
    sweepButton(h.root)?.click();
    card(h.root)?.querySelector<HTMLButtonElement>('.mkt-sweep-close')?.click();
    expect(card(h.root)).toBeNull();
    expect(h.quotes).toEqual([
      [ORE, 1],
      [ORE, 0],
    ]);
  });

  it('keeps the single-listing Buy button as the one .mkt-btn on the row', () => {
    const h = harness(info([listing()]));
    expect(h.root.querySelectorAll('.mkt-row .mkt-btn').length).toBe(1);
    expect(h.root.querySelector('.mkt-row .mkt-btn')?.textContent).toBe(t('itemUi.market.buy'));
  });
});
