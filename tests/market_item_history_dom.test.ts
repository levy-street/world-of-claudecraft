// @vitest-environment happy-dom
//
// The World Market browse row's Item history door (docs/design/item-tracking.md):
// a listed tracked copy (MarketListingView.history, the public projection)
// gets a visible "Item history" button beside its row on every layout (the
// keyboard and touch door) plus the right-click / Context Menu key door; an
// untracked row gets neither. Driven against the real MarketWindow painter
// (the market_collapse_toggle harness idiom) and the real shared dialog.

import { afterEach, describe, expect, it } from 'vitest';
import type { ItemProvenance, ItemSlot } from '../src/sim/types';
import { closeItemHistoryDialog } from '../src/ui/item_history_dialog';
import { MarketWindow, type MarketWindowDeps } from '../src/ui/market_window';
import type { IWorld, MarketInfo, MarketListingView } from '../src/world_api';

const HISTORY: ItemProvenance = {
  at: Date.UTC(2026, 8, 30),
  by: 'Alice',
  source: 'mob:forest_wolf',
  owners: [{ at: Date.UTC(2026, 9, 1), by: 'Bob' }],
  transfers: 1,
};

function row(over: Partial<MarketListingView>): MarketListingView {
  return {
    id: 1,
    sellerName: 'Bob',
    itemId: 'duskforged_warblade',
    count: 1,
    price: 5000,
    mine: false,
    house: false,
    ...over,
  };
}

function info(listings: MarketListingView[]): MarketInfo {
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
  };
}

let lastWindow: MarketWindow | null = null;

function open(listings: MarketListingView[]): HTMLElement {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'market-window';
  root.className = 'window panel ui-window';
  document.body.appendChild(root);
  const world = {
    marketInfo: info(listings),
    marketCollectPending: false,
    inventory: [],
    marketSearch: () => {},
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
  lastWindow = new MarketWindow(deps);
  lastWindow.open();
  return root;
}

afterEach(() => {
  closeItemHistoryDialog(false);
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('market browse row: Item history', () => {
  it('offers the button on a tracked row only, and it opens the public lines', () => {
    const root = open([
      row({ id: 1, history: HISTORY }),
      row({ id: 2, itemId: 'oiled_boots', sellerName: 'Cara' }),
    ]);
    const rows = [...root.querySelectorAll<HTMLElement>('.mkt-row')];
    expect(rows).toHaveLength(2);
    const buttons = root.querySelectorAll<HTMLButtonElement>('.item-history-action');
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    // The button sits beside the tracked row in the market row-plus-action wrapper.
    expect(button.parentElement?.classList.contains('material-source-item-market')).toBe(true);
    expect(button.parentElement?.contains(rows[0])).toBe(true);
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-label')).toContain('Duskforged Warblade');

    button.click();
    const dialog = document.getElementById('item-history-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Duskforged Warblade: history');
    expect(dialog?.textContent).toContain('Looted by Alice on ');
    expect(dialog?.textContent).toContain('Passed to Bob on ');
    expect(root.inert).toBe(true);
  });

  it('opens from a mouse right-click on the tracked row, not on the plain one', () => {
    const root = open([
      row({ id: 1, history: HISTORY }),
      row({ id: 2, itemId: 'oiled_boots', sellerName: 'Cara' }),
    ]);
    const [tracked, plain] = [...root.querySelectorAll<HTMLElement>('.mkt-row')];
    const rightClick = () => new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const onPlain = rightClick();
    plain.dispatchEvent(onPlain);
    expect(onPlain.defaultPrevented).toBe(false);
    expect(document.getElementById('item-history-dialog')).toBeNull();
    const onTracked = rightClick();
    tracked.dispatchEvent(onTracked);
    expect(onTracked.defaultPrevented).toBe(true);
    expect(document.getElementById('item-history-dialog')?.textContent).toContain(
      'Looted by Alice on ',
    );
  });

  it('offers nothing for a malformed history', () => {
    const root = open([row({ id: 1, history: { by: 'X' } as unknown as ItemProvenance })]);
    expect(root.querySelector('.item-history-action')).toBeNull();
  });

  it('closes its open history prompt when the market window closes', () => {
    const root = open([row({ id: 1, history: HISTORY })]);
    root.querySelector<HTMLButtonElement>('.item-history-action')?.click();
    expect(document.getElementById('item-history-dialog')).not.toBeNull();
    lastWindow?.close();
    expect(document.getElementById('item-history-dialog')).toBeNull();
  });
});
