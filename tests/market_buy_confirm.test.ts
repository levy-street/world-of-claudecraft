// @vitest-environment happy-dom
//
// The World Market buy confirmation: a buyout spends coin outright with no
// buyback recorded, so the Browse tab asks before it dispatches.
//
// Two halves, both driven against the REAL code (the bank_window_search_reset /
// bag_item_action_menu_paint harness idiom): the pure core's captured terms and
// its confirm-time recheck, then the real MarketWindow painter clicking its own
// Buy button through a stubbed confirmDialog dep, so the "nothing is sent until
// OK" contract is asserted on the actual dispatch path rather than on source
// text. Every snapshot is built in BOTH the offline Sim shape and the online
// ClientWorld mirror shape (identical structurally; the mirror simply arrives
// from the wire), matching the market_view core's two-shape convention.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemSlot } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { formatMoney, t } from '../src/ui/i18n';
import { marketBuyConfirm, recheckMarketBuy } from '../src/ui/market_buy_confirm_core';
import { MarketWindow, type MarketWindowDeps } from '../src/ui/market_window';
import type { IWorld, MarketInfo, MarketListingView } from '../src/world_api';

// Real catalog ids so the prompt copy is built from a live item name.
const SWORD = 'worn_sword';
const ORE = 'copper_ore';

function listing(over: Partial<MarketListingView> = {}): MarketListingView {
  return {
    id: 7,
    sellerName: 'Halden',
    itemId: SWORD,
    count: 1,
    price: 12345,
    mine: false,
    house: false,
    ...over,
  };
}

function info(listings: MarketListingView[], over: Partial<MarketInfo> = {}): MarketInfo {
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
    maxListings: 16,
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

interface Confirm {
  title: string;
  body: string;
  ok: string;
  cancel: string;
  onOk: () => void;
}

interface Harness {
  root: HTMLElement;
  window: MarketWindow;
  /** Swap what the window reads next; the painter re-reads on every render. */
  setInfo(next: MarketInfo | null): void;
  confirms: Confirm[];
  bought: number[];
  /** The `count` argument each marketBuy call carried, in the same order as
   *  `bought` (undefined for a whole-stack buy, the pre-partial-buy shape). */
  boughtCounts: (number | undefined)[];
  cancelled: number[];
  errors: string[];
}

function harness(initial: MarketInfo): Harness {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const confirms: Confirm[] = [];
  const bought: number[] = [];
  const boughtCounts: (number | undefined)[] = [];
  const cancelled: number[] = [];
  const errors: string[] = [];
  const world = {
    marketInfo: initial as MarketInfo | null,
    marketCollectPending: false,
    inventory: [],
    marketSearch: () => {},
    marketSellPriceCheck: () => {},
    marketList: () => {},
    marketBuy: (id: number, count?: number) => {
      bought.push(id);
      boughtCounts.push(count);
    },
    marketCancel: (id: number) => cancelled.push(id),
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
    confirmDialog: (title, body, ok, cancel, onOk) =>
      confirms.push({ title, body, ok, cancel, onOk }),
  };
  return {
    root,
    window: new MarketWindow(deps),
    setInfo: (next) => {
      world.marketInfo = next;
    },
    confirms,
    bought,
    boughtCounts,
    cancelled,
    errors,
  };
}

/** The one action button on the Nth browse row (Buy, or Reclaim when mine). */
function rowButton(root: HTMLElement, index = 0): HTMLButtonElement {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.mkt-row .mkt-btn')];
  const el = buttons[index];
  expect(el, `browse row ${index} action button missing`).toBeTruthy();
  return el;
}

/** The Nth row's partial-buy quantity field + its own Buy trigger (a bulk
 *  stack's alternative to buying the whole row via `rowButton`). */
function rowPartialBuy(
  root: HTMLElement,
  index = 0,
): { input: HTMLInputElement; button: HTMLButtonElement } {
  const groups = [...root.querySelectorAll<HTMLElement>('.mkt-row .mkt-buy-partial')];
  const group = groups[index];
  expect(group, `browse row ${index} partial-buy control missing`).toBeTruthy();
  const input = group.querySelector<HTMLInputElement>('.mkt-buy-partial-qty')!;
  const button = group.querySelector<HTMLButtonElement>('.mkt-buy-partial-btn')!;
  expect(input && button, `browse row ${index} partial-buy field/button missing`).toBeTruthy();
  return { input, button };
}

describe('market_buy_confirm_core', () => {
  it('captures the listing terms, with no per-unit ask for a single', () => {
    expect(marketBuyConfirm(listing())).toEqual({
      listingId: 7,
      itemId: SWORD,
      count: 1,
      price: 12345,
      unitPrice: null,
      buyCount: 1,
      buyPrice: 12345,
    });
  });

  it('quotes the stack per-unit ask the browse row shows (ceil, not floor)', () => {
    // 1000 / 3 = 333.33: the row prints ceil (334) and the prompt must agree, or
    // it quotes a unit price the player never saw.
    const captured = marketBuyConfirm(listing({ count: 3, price: 1000 }));
    expect(captured.unitPrice).toBe(334);
    expect(captured.count).toBe(3);
    expect(captured.price).toBe(1000);
    // No requestedCount: a whole-stack buy, byte-identical to before partial buys.
    expect(captured.buyCount).toBe(3);
    expect(captured.buyPrice).toBe(1000);
  });

  // A buyer may take fewer than the whole stack of a bulk listing (the sim's own
  // marketBuy, src/sim/market.ts). This core's rounding must agree with the sim's
  // byte for byte, or the confirm prompt quotes a price the server would not honor.
  it('quotes a partial buy: rounds the buyer share UP, capped below the full price', () => {
    // price 1000 over 3 units: per-unit ceil is 334. Buying 1 of 3 costs
    // ceil(1000*1/3) = 334, buying 2 of 3 costs ceil(1000*2/3) = 667.
    const stack = listing({ count: 3, price: 1000 });
    expect(marketBuyConfirm(stack, 1)).toMatchObject({ buyCount: 1, buyPrice: 334 });
    expect(marketBuyConfirm(stack, 2)).toMatchObject({ buyCount: 2, buyPrice: 667 });
  });

  it('a requestedCount at or above the stack size buys it whole', () => {
    const stack = listing({ count: 3, price: 1000 });
    expect(marketBuyConfirm(stack, 3)).toMatchObject({ buyCount: 3, buyPrice: 1000 });
    expect(marketBuyConfirm(stack, 99)).toMatchObject({ buyCount: 3, buyPrice: 1000 });
  });

  it('clamps a non-finite or sub-1 requestedCount to a sane partial buy', () => {
    const stack = listing({ count: 5, price: 100 });
    expect(marketBuyConfirm(stack, Number.NaN)).toMatchObject({ buyCount: 5, buyPrice: 100 });
    expect(marketBuyConfirm(stack, 0)).toMatchObject({ buyCount: 1, buyPrice: 20 });
    expect(marketBuyConfirm(stack, -4)).toMatchObject({ buyCount: 1, buyPrice: 20 });
  });

  it('never prices a partial buy remainder below 1 copper', () => {
    // price 7 over 5 units, buying 4: naive ceil(7*4/5) = ceil(5.6) = 6, leaving
    // the remaining 1 unit exactly 1 copper (the floor), not 0.
    const stack = listing({ count: 5, price: 7 });
    const captured = marketBuyConfirm(stack, 4);
    expect(captured.buyPrice).toBe(6);
    expect(stack.price - captured.buyPrice).toBeGreaterThanOrEqual(1);
  });

  it('passes when the captured listing is still live, in both world shapes', () => {
    const captured = marketBuyConfirm(listing());
    const sim = info([listing()]);
    // The ClientWorld mirror carries the same row plus the wired instance payload
    // an instanced listing arrives with; neither is part of the agreed terms.
    const mirror = info([listing({ instance: { rolled: { quality: 'fine' } } })]);
    expect(recheckMarketBuy(sim, captured)).toEqual({ state: 'ok' });
    expect(recheckMarketBuy(mirror, captured)).toEqual({ state: 'ok' });
  });

  it('refuses a listing that left the snapshot, and a null snapshot', () => {
    const captured = marketBuyConfirm(listing());
    expect(recheckMarketBuy(info([]), captured)).toEqual({ state: 'gone' });
    expect(recheckMarketBuy(info([listing({ id: 8 })]), captured)).toEqual({ state: 'gone' });
    // Walked out of the Merchant's range with the prompt up: no snapshot to agree with.
    expect(recheckMarketBuy(null, captured)).toEqual({ state: 'gone' });
  });

  it('refuses per changed dimension: price, count, item, and ownership', () => {
    const captured = marketBuyConfirm(listing());
    const changed = { state: 'changed' };
    expect(recheckMarketBuy(info([listing({ price: 12346 })]), captured)).toEqual(changed);
    expect(recheckMarketBuy(info([listing({ price: 1 })]), captured)).toEqual(changed);
    expect(recheckMarketBuy(info([listing({ count: 2 })]), captured)).toEqual(changed);
    expect(recheckMarketBuy(info([listing({ itemId: ORE })]), captured)).toEqual(changed);
    // A reused id now answering as the viewer's own listing is a DIFFERENT listing;
    // the Browse row only ever offered Buy on someone else's.
    expect(recheckMarketBuy(info([listing({ mine: true })]), captured)).toEqual(changed);
  });
});

describe('market window: buying asks first', () => {
  it('sends nothing on the Buy click and states the listing terms in the prompt', () => {
    const h = harness(info([listing()]));
    h.window.open();
    rowButton(h.root).click();
    expect(h.bought, 'the buy command must wait for the confirmation').toEqual([]);
    expect(h.confirms).toHaveLength(1);
    const [prompt] = h.confirms;
    expect(prompt.title).toBe(t('itemUi.market.buyConfirmTitle'));
    expect(prompt.ok).toBe(t('itemUi.market.buyConfirmAccept'));
    expect(prompt.cancel).toBe(t('itemUi.market.buyConfirmCancel'));
    expect(prompt.body).toBe(
      t('itemUi.market.buyConfirmBody', {
        item: itemDisplayName(ITEMS[SWORD]),
        price: formatMoney(12345),
      }),
    );
    // The body carries the real item name and the real ask, not a placeholder.
    expect(prompt.body).toContain(itemDisplayName(ITEMS[SWORD]));
    expect(prompt.body).toContain(formatMoney(12345));
  });

  it('quotes the stack count and the per-unit ask for a stacked listing', () => {
    const h = harness(info([listing({ itemId: ORE, count: 3, price: 1000 })]));
    h.window.open();
    rowButton(h.root).click();
    expect(h.confirms[0].body).toBe(
      t('itemUi.market.buyConfirmBodyStack', {
        item: itemDisplayName(ITEMS[ORE]),
        count: '3',
        price: formatMoney(1000),
        each: formatMoney(334),
      }),
    );
  });

  it('sends the buy for the confirmed listing only once OK runs', () => {
    const h = harness(info([listing()]));
    h.window.open();
    rowButton(h.root).click();
    h.confirms[0].onOk();
    expect(h.bought).toEqual([7]);
    expect(h.errors).toEqual([]);
  });

  it('refuses at confirm time when the listing sold under the open prompt', () => {
    const h = harness(info([listing()]));
    h.window.open();
    rowButton(h.root).click();
    h.setInfo(info([]));
    h.confirms[0].onOk();
    expect(h.bought, 'a listing that is gone must not be bought').toEqual([]);
    expect(h.errors).toEqual([t('itemUi.errors.listingUnavailable')]);
  });

  it('refuses at confirm time when the listing was re-priced under the open prompt', () => {
    const h = harness(info([listing()]));
    h.window.open();
    rowButton(h.root).click();
    // Same id, new terms: buying now would spend a price the player never read.
    h.setInfo(info([listing({ price: 99999 })]));
    h.confirms[0].onOk();
    expect(h.bought).toEqual([]);
    expect(h.errors).toEqual([t('itemUi.market.buyChanged')]);
  });

  it('leaves Reclaim on its own listing a single click (no coin at stake)', () => {
    const h = harness(info([listing({ mine: true })]));
    h.window.open();
    rowButton(h.root).click();
    expect(h.cancelled).toEqual([7]);
    expect(h.confirms).toEqual([]);
  });

  it('offers no partial-buy control for a single-copy listing', () => {
    const h = harness(info([listing()])); // count: 1
    h.window.open();
    expect(h.root.querySelector('.mkt-buy-partial')).toBeNull();
  });

  it("offers no partial-buy control on the viewer's own bulk listing", () => {
    const h = harness(info([listing({ itemId: ORE, count: 5, price: 100, mine: true })]));
    h.window.open();
    expect(h.root.querySelector('.mkt-buy-partial')).toBeNull();
  });

  it('the main Buy button still buys a bulk stack whole (no count sent)', () => {
    const h = harness(info([listing({ itemId: ORE, count: 5, price: 100 })]));
    h.window.open();
    rowButton(h.root).click();
    h.confirms[0].onOk();
    expect(h.bought).toEqual([7]);
    expect(h.boughtCounts).toEqual([undefined]);
  });

  it('the partial-buy control defaults to a quantity of 1 and states it in the prompt', () => {
    const h = harness(info([listing({ itemId: ORE, count: 5, price: 100 })]));
    h.window.open();
    const { input, button } = rowPartialBuy(h.root);
    expect(input.value).toBe('1');
    button.click();
    expect(h.bought, 'must wait for confirmation like the main Buy button').toEqual([]);
    expect(h.confirms).toHaveLength(1);
    expect(h.confirms[0].body).toBe(
      t('itemUi.market.buyConfirmBodyPartial', {
        item: itemDisplayName(ITEMS[ORE]),
        count: '1',
        total: '5',
        price: formatMoney(20), // ceil(100 * 1 / 5)
        each: formatMoney(20), // ceil(100 / 5), same as the whole-stack per-unit ask
      }),
    );
    h.confirms[0].onOk();
    expect(h.bought).toEqual([7]);
    expect(h.boughtCounts).toEqual([1]);
  });

  it('the partial-buy control honors a raised quantity, clamped to the stack size', () => {
    const h = harness(info([listing({ itemId: ORE, count: 5, price: 100 })]));
    h.window.open();
    const { input, button } = rowPartialBuy(h.root);
    input.value = '3';
    button.click();
    expect(h.confirms[0].body).toContain(formatMoney(60)); // ceil(100 * 3 / 5)
    h.confirms[0].onOk();
    expect(h.boughtCounts).toEqual([3]);

    // A raised quantity at or above the full stack size buys it whole (the
    // same clamp the sim itself applies), sending no count.
    const h2 = harness(info([listing({ itemId: ORE, count: 5, price: 100 })]));
    h2.window.open();
    const partial2 = rowPartialBuy(h2.root);
    partial2.input.value = '999';
    partial2.button.click();
    h2.confirms[0].onOk();
    expect(h2.boughtCounts).toEqual([undefined]);
  });

  it('refuses a partial buy at confirm time when the stack changed under the open prompt', () => {
    const h = harness(info([listing({ itemId: ORE, count: 5, price: 100 })]));
    h.window.open();
    const { button } = rowPartialBuy(h.root); // defaults to quantity 1
    button.click();
    h.setInfo(info([listing({ itemId: ORE, count: 4, price: 80 })]));
    h.confirms[0].onOk();
    expect(h.bought).toEqual([]);
    expect(h.errors).toEqual([t('itemUi.market.buyChanged')]);
  });
});
