// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type MarketQuery, marketItemMatches } from '../src/sim/market_query';
import type { ItemSlot } from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { MarketWindow, type MarketWindowDeps } from '../src/ui/market_window';
import type { IWorld, MarketInfo } from '../src/world_api';

const OTHER = 'es';

beforeAll(async () => {
  await ensureLocaleLoaded(OTHER);
});

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
});

afterEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
});

function info(overrides: Partial<MarketInfo> = {}): MarketInfo {
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
    ...overrides,
  };
}

function harness(): {
  root: HTMLElement;
  window: MarketWindow;
  world: { marketInfo: MarketInfo | null };
  queries: MarketQuery[];
} {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const queries: MarketQuery[] = [];
  const world = {
    marketInfo: info() as MarketInfo | null,
    marketCollectPending: false,
    inventory: [],
    marketSearch: (query: MarketQuery) => queries.push(query),
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
  return { root, window: new MarketWindow(deps), world, queries };
}

function typeSearch(root: HTMLElement, value: string): void {
  const search = root.querySelector<HTMLInputElement>('.mkt-search');
  expect(search).toBeTruthy();
  if (!search) throw new Error('missing market search input');
  search.value = value;
  search.dispatchEvent(new Event('input'));
}

function chooseMarketFilter(root: HTMLElement, key: string, value: string): void {
  const option = root.querySelector<HTMLElement>(
    `[data-market-filter-menu="${key}"] [data-market-filter-option="${value}"]`,
  );
  expect(option).toBeTruthy();
  option?.click();
}

const onlineQueryRebuildCases: Array<{
  name: string;
  apply: (root: HTMLElement) => void;
  expectedQuery: Partial<MarketQuery>;
}> = [
  {
    name: 'item-type filter',
    apply: (root) => chooseMarketFilter(root, 'itemType', 'weapon'),
    expectedQuery: { itemType: 'weapon' },
  },
  {
    name: 'rarity filter',
    apply: (root) => chooseMarketFilter(root, 'rarity', 'poor'),
    expectedQuery: { rarity: 'poor' },
  },
  {
    name: 'sort order',
    apply: (root) => chooseMarketFilter(root, 'sort', 'price'),
    expectedQuery: { sort: 'price' },
  },
  {
    name: 'lowest-price collapse',
    apply: (root) => {
      const checkbox = root.querySelector<HTMLInputElement>('.mkt-collapse-checkbox');
      expect(checkbox).toBeTruthy();
      if (!checkbox) return;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    },
    expectedQuery: { collapseLowest: true },
  },
];

describe('World Market localized search query construction', () => {
  it('adds membership for the localized item name painted in the active locale', () => {
    const h = harness();
    setLanguage(OTHER);
    h.window.open();

    typeSearch(h.root, 'colmillo');

    const query = h.queries.at(-1) as MarketQuery & { localizedItemMask?: string };
    expect(query.search).toBe('colmillo');
    expect(query.localizedItemMask).toBeTruthy();
    expect(marketItemMatches('wolf_fang', query)).toBe(true);
  });

  it('recomputes the same draft in the new locale and resets to page zero', () => {
    const h = harness();
    setLanguage(OTHER);
    h.window.open();
    typeSearch(h.root, 'colmillo');
    const spanishMask = (h.queries.at(-1) as MarketQuery & { localizedItemMask?: string })
      .localizedItemMask;

    setLanguage('en');
    (h.window as MarketWindow & { relocalize(): void }).relocalize();

    const query = h.queries.at(-1) as MarketQuery & { localizedItemMask?: string };
    expect(query.search).toBe('colmillo');
    expect(query.page).toBe(0);
    expect(query.localizedItemMask).not.toBe(spanishMask);
    expect(marketItemMatches('wolf_fang', query)).toBe(false);
    expect(h.root.querySelector<HTMLInputElement>('.mkt-search')?.value).toBe('colmillo');

    setLanguage(OTHER);
    h.window.relocalize();
    expect(marketItemMatches('wolf_fang', h.queries.at(-1) as MarketQuery)).toBe(true);
  });

  it.each(['sell', 'collect'] as const)(
    'refreshes retained Browse membership when the locale changes on the %s tab',
    (tab) => {
      const h = harness();
      setLanguage(OTHER);
      h.window.open();
      typeSearch(h.root, 'colmillo');
      const spanishMask = h.queries.at(-1)?.localizedItemMask;
      h.root.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.click();
      h.queries.length = 0;

      setLanguage('en');
      h.window.relocalize();

      expect(h.queries).toHaveLength(1);
      expect(h.queries[0]?.search).toBe('colmillo');
      expect(h.queries[0]?.localizedItemMask).not.toBe(spanishMask);
      expect(h.queries[0]?.page).toBe(0);
    },
  );

  it('does not let a pre-response page echo undo the locale-change page reset', () => {
    const h = harness();
    setLanguage(OTHER);
    h.window.open();
    typeSearch(h.root, 'colmillo');
    h.world.marketInfo = info({
      listings: [
        {
          id: 1,
          sellerName: 'Rival',
          itemId: 'wolf_fang',
          count: 1,
          price: 100,
          mine: false,
          house: false,
        },
      ],
      totalCount: 60,
      filter: 'colmillo',
      page: 1,
      pageCount: 2,
    });
    h.window.refreshIfChanged();

    setLanguage('en');
    h.window.relocalize();
    expect(h.queries.at(-1)?.page).toBe(0);
    h.queries.length = 0;

    // The old page-1 MarketInfo is still mirrored while the page-0 query is in flight.
    h.window.refreshIfChanged();
    h.window.onReconnected();
    h.window.refreshIfChanged();

    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]?.page).toBe(0);
  });

  it('lets an explicit page change supersede a pending page-zero reset', () => {
    const h = harness();
    setLanguage(OTHER);
    h.window.open();
    typeSearch(h.root, 'colmillo');
    h.world.marketInfo = info({
      listings: [
        {
          id: 1,
          sellerName: 'Rival',
          itemId: 'wolf_fang',
          count: 1,
          price: 100,
          mine: false,
          house: false,
        },
      ],
      totalCount: 120,
      filter: 'colmillo',
      page: 1,
      pageCount: 3,
    });
    h.window.refreshIfChanged();

    setLanguage('en');
    h.window.relocalize();
    h.queries.length = 0;

    h.root.querySelector<HTMLButtonElement>('[data-market-page="next"]')?.click();
    expect(h.queries.at(-1)?.page).toBe(1);

    // The older page-zero response was already in flight when page 1 superseded it.
    h.world.marketInfo = info({
      listings: [
        {
          id: 2,
          sellerName: 'Stale Page Zero',
          itemId: 'wolf_fang',
          count: 1,
          price: 200,
          mine: false,
          house: false,
        },
      ],
      totalCount: 180,
      filter: 'colmillo',
      page: 0,
      pageCount: 4,
    });
    h.window.refreshIfChanged();
    expect(h.root.textContent).toContain('Rival');
    expect(h.root.textContent).not.toContain('Stale Page Zero');
    h.queries.length = 0;
    h.window.onReconnected();
    h.window.refreshIfChanged();

    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]?.page).toBe(1);
  });

  it('rejects an in-flight nonzero echo when page zero was requested from a page-zero mirror', () => {
    const h = harness();
    h.world.marketInfo = info({
      listings: [
        {
          id: 1,
          sellerName: 'Rival',
          itemId: 'wolf_fang',
          count: 1,
          price: 100,
          mine: false,
          house: false,
        },
      ],
      totalCount: 120,
      page: 0,
      pageCount: 3,
    });
    h.window.open();

    h.root.querySelector<HTMLButtonElement>('[data-market-page="next"]')?.click();
    expect(h.queries.at(-1)?.page).toBe(1);
    typeSearch(h.root, 'fang');
    expect(h.queries.at(-1)?.page).toBe(0);
    h.queries.length = 0;

    // The page-1 response was already in flight before the new search reset to page 0.
    h.world.marketInfo = info({
      listings: [
        {
          id: 2,
          sellerName: 'Stale Page One',
          itemId: 'wolf_fang',
          count: 1,
          price: 200,
          mine: false,
          house: false,
        },
      ],
      totalCount: 120,
      page: 1,
      pageCount: 3,
    });
    h.window.refreshIfChanged();
    expect(h.root.textContent).toContain('Rival');
    expect(h.root.textContent).not.toContain('Stale Page One');
    h.window.onReconnected();
    h.window.refreshIfChanged();

    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]?.search).toBe('fang');
    expect(h.queries[0]?.page).toBe(0);
  });

  it('does not paint the first response after a newer search supersedes it on the same page', () => {
    const h = harness();
    h.world.marketInfo = info({
      listings: [
        {
          id: 1,
          sellerName: 'Current Results',
          itemId: 'wolf_fang',
          count: 1,
          price: 100,
          mine: false,
          house: false,
        },
      ],
      totalCount: 1,
    });
    h.window.open();
    const priorStatus = h.root.querySelector('.mkt-status')?.textContent;

    typeSearch(h.root, 'f');
    typeSearch(h.root, 'fa');
    h.world.marketInfo = info({
      listings: [
        {
          id: 2,
          sellerName: 'Superseded Search',
          itemId: 'wolf_fang',
          count: 1,
          price: 200,
          mine: false,
          house: false,
        },
      ],
      totalCount: 1,
      filter: 'f',
    });

    h.window.refreshIfChanged();

    expect(h.root.textContent).toContain('Current Results');
    expect(h.root.textContent).not.toContain('Superseded Search');
    expect(h.root.querySelector('.mkt-status')?.textContent).toBe(priorStatus);
    expect(h.root.querySelector<HTMLInputElement>('.mkt-search')?.value).toBe('fa');
  });

  it.each(onlineQueryRebuildCases)(
    'keeps the last accepted rows visible while an online $name query is in flight',
    ({ apply, expectedQuery }) => {
      const h = harness();
      h.world.marketInfo = info({
        listings: [
          {
            id: 1,
            sellerName: 'Current Results',
            itemId: 'wolf_fang',
            count: 1,
            price: 100,
            mine: false,
            house: false,
          },
        ],
        totalCount: 1,
      });
      h.window.open();
      const priorStatus = h.root.querySelector('.mkt-status')?.textContent;
      expect(h.root.querySelector('.mkt-list')?.textContent).toContain('Current Results');
      expect(priorStatus).toBeTruthy();

      // An online host records the query here but keeps the previous MarketInfo until
      // the authoritative response completes its round trip.
      apply(h.root);

      expect(h.queries.at(-1)).toMatchObject(expectedQuery);
      expect(h.root.querySelector('.mkt-list')?.textContent).toContain('Current Results');
      expect(h.root.querySelector('.mkt-status')?.textContent).toBe(priorStatus);
    },
  );

  it('re-pushes once after reconnect even when the raw echo still matches', () => {
    const h = harness();
    setLanguage(OTHER);
    h.window.open();
    typeSearch(h.root, 'colmillo');
    h.queries.length = 0;
    h.world.marketInfo = info({ filter: 'colmillo' });

    h.window.onReconnected();
    h.window.refreshIfChanged();

    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]?.search).toBe('colmillo');
    expect(marketItemMatches('wolf_fang', h.queries[0] as MarketQuery)).toBe(true);
    h.window.refreshIfChanged();
    expect(h.queries).toHaveLength(1);
  });
});
