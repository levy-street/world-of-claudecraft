import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { MarketFilters } from '../src/ui/market_filters';
import { MARKET_PAGE_SIZE } from '../src/ui/market_filters';
import {
  buildMarketBrowse,
  buildMarketCollect,
  buildMarketSell,
  buildMarketView,
  COPPER_PER_GOLD,
  COPPER_PER_SILVER,
  marketCollectBadgeCount,
} from '../src/ui/market_view';
import type { MarketInfo, MarketListingView } from '../src/world_api';

function listing(itemId: string, over: Partial<MarketListingView> = {}): MarketListingView {
  return {
    id: itemId.length,
    sellerName: 'Seller',
    itemId,
    count: 1,
    price: 100,
    mine: false,
    house: false,
    ...over,
  };
}

function info(over: Partial<MarketInfo> = {}): MarketInfo {
  return {
    listings: [],
    totalCount: 0,
    filter: '',
    collectionCopper: 0,
    collectionItems: [],
    cutPct: 5,
    maxListings: 10,
    myListingCount: 0,
    ...over,
  };
}

const ALL: MarketFilters = { itemType: 'all', subtype: 'all', rarity: 'all' };

describe('market_view: top-level state union', () => {
  it('reports no-data when the snapshot has not arrived (loading / no merchant)', () => {
    expect(
      buildMarketView({
        info: null,
        tab: 'browse',
        filters: ALL,
        browsePage: 0,
        sellItemId: null,
        sellHave: 0,
      }),
    ).toEqual({ kind: 'no-data' });
    // The data-absent state is tab-independent: sell and collect collapse to it too.
    expect(
      buildMarketView({
        info: null,
        tab: 'sell',
        filters: ALL,
        browsePage: 0,
        sellItemId: 'worn_sword',
        sellHave: 3,
      }).kind,
    ).toBe('no-data');
    expect(
      buildMarketView({
        info: null,
        tab: 'collect',
        filters: ALL,
        browsePage: 0,
        sellItemId: null,
        sellHave: 0,
      }).kind,
    ).toBe('no-data');
  });

  it('routes each tab to its body', () => {
    const i = info({ listings: [listing('keen_dirk')] });
    expect(
      buildMarketView({
        info: i,
        tab: 'browse',
        filters: ALL,
        browsePage: 0,
        sellItemId: null,
        sellHave: 0,
      }).kind,
    ).toBe('browse');
    const sell = buildMarketView({
      info: i,
      tab: 'sell',
      filters: ALL,
      browsePage: 0,
      sellItemId: null,
      sellHave: 0,
    });
    expect(sell.kind).toBe('sell');
    if (sell.kind === 'sell')
      expect(sell.meta).toEqual({ cutPct: 5, myListingCount: 0, maxListings: 10 });
    expect(
      buildMarketView({
        info: i,
        tab: 'collect',
        filters: ALL,
        browsePage: 0,
        sellItemId: null,
        sellHave: 0,
      }).kind,
    ).toBe('collect');
  });
});

describe('market_view: browse states', () => {
  it('distinguishes the three empty reasons', () => {
    expect(buildMarketBrowse(info({ listings: [] }), ALL, 0)).toEqual({
      state: 'empty',
      reason: 'browse',
    });
    expect(buildMarketBrowse(info({ listings: [], filter: 'wolf' }), ALL, 0)).toEqual({
      state: 'empty',
      reason: 'search',
    });
    // listings exist but the local armor filter excludes the only (weapon) listing
    expect(
      buildMarketBrowse(
        info({ listings: [listing('keen_dirk')] }),
        { itemType: 'armor', rarity: 'all' },
        0,
      ),
    ).toEqual({
      state: 'empty',
      reason: 'filtered',
    });
  });

  it('resolves a page of rows and drops listings whose item is unknown', () => {
    const body = buildMarketBrowse(
      info({
        listings: [listing('keen_dirk'), listing('not_a_real_item'), listing('greyjaw_pelt_cloak')],
      }),
      ALL,
      0,
    );
    expect(body.state).toBe('list');
    if (body.state !== 'list') return;
    expect(body.page.items.map((r) => r.listing.itemId)).toEqual([
      'keen_dirk',
      'greyjaw_pelt_cloak',
    ]);
    expect(body.page.items[0].item).toBe(ITEMS.keen_dirk);
    // market_filters already drops the unknown listing, so total counts the 2 resolvable rows
    expect(body.page.total).toBe(2);
  });

  it('filters through market_filters rather than re-deriving (armor excludes the weapon)', () => {
    const body = buildMarketBrowse(
      info({ listings: [listing('keen_dirk'), listing('greyjaw_pelt_cloak')] }),
      { itemType: 'armor', rarity: 'all' },
      0,
    );
    expect(body.state).toBe('list');
    if (body.state !== 'list') return;
    expect(body.page.items.map((r) => r.listing.itemId)).toEqual(['greyjaw_pelt_cloak']);
  });

  it('paginates with the shared page size and clamps the page index', () => {
    const many = Array.from({ length: MARKET_PAGE_SIZE + 5 }, (_, n) =>
      listing('bone_fragments', { id: n }),
    );
    const first = buildMarketBrowse(info({ listings: many }), ALL, 0);
    const last = buildMarketBrowse(info({ listings: many }), ALL, 99);
    if (first.state !== 'list' || last.state !== 'list') throw new Error('expected list');
    expect(first.page.items).toHaveLength(MARKET_PAGE_SIZE);
    expect(first.page.pageCount).toBe(2);
    expect(last.page.page).toBe(1); // clamped to the last page
    expect(last.page.items).toHaveLength(5);
  });
});

describe('market_view: sell states', () => {
  it('is pick-empty with nothing staged or nothing held', () => {
    expect(buildMarketSell(null, 0)).toEqual({ state: 'pick-empty' });
    expect(buildMarketSell('worn_sword', 0)).toEqual({ state: 'pick-empty' });
  });

  it('refuses quest items and no-list items', () => {
    expect(buildMarketSell('boar_hide', 1)).toEqual({ state: 'cannot-market' }); // quest item
    expect(buildMarketSell('alien_armor_plate', 1)).toEqual({ state: 'cannot-market' }); // noMarketList
  });

  it('builds the price form with a suggested ask split into coins', () => {
    const body = buildMarketSell('worn_sword', 3);
    expect(body.state).toBe('form');
    if (body.state !== 'form') return;
    expect(body.form.itemId).toBe('worn_sword');
    expect(body.form.have).toBe(3);
    // worn_sword: no buyValue, sellValue 10 -> suggested max(1, 10*4) = 40c
    expect(body.form.suggested).toEqual({ gold: 0, silver: 0, copper: 40 });
    const reconstructed =
      body.form.suggested.gold * COPPER_PER_GOLD +
      body.form.suggested.silver * COPPER_PER_SILVER +
      body.form.suggested.copper;
    expect(reconstructed).toBe(40);
  });

  it('takes the buyValue branch and splits it across silver + copper', () => {
    // healing_potion has a defined buyValue (170c), so the suggested ask takes the
    // `buyValue ??` left arm; 170c splits to 1s 70c, exercising the silver modulo
    // and the copper remainder that the copper-only 40c case above never reaches.
    const body = buildMarketSell('healing_potion', 5);
    expect(body.state).toBe('form');
    if (body.state !== 'form') return;
    expect(body.form.suggested).toEqual({ gold: 0, silver: 1, copper: 70 });
    const reconstructed =
      body.form.suggested.gold * COPPER_PER_GOLD +
      body.form.suggested.silver * COPPER_PER_SILVER +
      body.form.suggested.copper;
    expect(reconstructed).toBe(170);
  });

  it('splits a high ask into nonzero gold via the sellValue*4 branch', () => {
    // deathlord_warplate has no buyValue, so the suggested ask is sellValue * 4 =
    // 9000 * 4 = 36000c, which splits to 3g 60s, exercising the gold floor-division
    // (the divisor + ordering a copper-only case cannot catch).
    const body = buildMarketSell('deathlord_warplate', 1);
    expect(body.state).toBe('form');
    if (body.state !== 'form') return;
    expect(body.form.suggested).toEqual({ gold: 3, silver: 60, copper: 0 });
    const reconstructed =
      body.form.suggested.gold * COPPER_PER_GOLD +
      body.form.suggested.silver * COPPER_PER_SILVER +
      body.form.suggested.copper;
    expect(reconstructed).toBe(36000);
  });
});

describe('market_view: collect states', () => {
  it('is empty with no proceeds and no items', () => {
    expect(buildMarketCollect(info())).toEqual({ state: 'empty' });
  });

  it('lists proceeds and resolved item stacks', () => {
    const body = buildMarketCollect(
      info({
        collectionCopper: 500,
        collectionItems: [
          { itemId: 'bone_fragments', count: 3 },
          { itemId: 'gone', count: 1 },
        ],
      }),
    );
    expect(body.state).toBe('items');
    if (body.state !== 'items') return;
    expect(body.proceeds).toBe(500);
    expect(body.rows.map((r) => r.item.id)).toEqual(['bone_fragments']); // unknown 'gone' dropped
    expect(body.rows[0].count).toBe(3);
  });

  it('counts the collect badge: a proceeds purse plus each returned stack', () => {
    expect(marketCollectBadgeCount(null)).toBe(0);
    expect(marketCollectBadgeCount(info())).toBe(0);
    expect(
      marketCollectBadgeCount(
        info({
          collectionCopper: 1,
          collectionItems: [
            { itemId: 'a', count: 1 },
            { itemId: 'b', count: 1 },
          ],
        }),
      ),
    ).toBe(3);
  });
});

describe('market_view: determinism + ClientWorld-vs-Sim parity', () => {
  it('is a pure function: same input yields an equal view-model', () => {
    const input = {
      info: info({
        listings: [listing('keen_dirk'), listing('greyjaw_pelt_cloak')],
        collectionCopper: 12,
      }),
      tab: 'browse' as const,
      filters: ALL,
      browsePage: 0,
      sellItemId: null,
      sellHave: 0,
    };
    expect(buildMarketView(input)).toEqual(buildMarketView(input));
  });

  it('yields identical view-models from a Sim-shaped snapshot and a ClientWorld-mirror snapshot', () => {
    // Offline Sim hands a prototyped object carrying server-only fields the core
    // must ignore; the online ClientWorld mirror is a JSON round-trip of the
    // snapshot (own enumerable fields only, no prototype).
    const simInfo = Object.assign(
      Object.create({ wireVersion: 7 }),
      info({
        listings: [listing('keen_dirk'), listing('greyjaw_pelt_cloak'), listing('roasted_boar')],
        filter: '',
        collectionCopper: 250,
        collectionItems: [{ itemId: 'bone_fragments', count: 4 }],
      }),
    ) as MarketInfo;
    const mirrorInfo = JSON.parse(JSON.stringify(simInfo)) as MarketInfo;

    for (const tab of ['browse', 'sell', 'collect'] as const) {
      const sim = buildMarketView({
        info: simInfo,
        tab,
        filters: ALL,
        browsePage: 0,
        sellItemId: 'worn_sword',
        sellHave: 2,
      });
      const mirror = buildMarketView({
        info: mirrorInfo,
        tab,
        filters: ALL,
        browsePage: 0,
        sellItemId: 'worn_sword',
        sellHave: 2,
      });
      expect(sim).toEqual(mirror);
    }
  });
});
