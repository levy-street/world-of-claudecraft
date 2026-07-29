import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { MarketFilters } from '../src/ui/market_filters';
import {
  MARKET_ARMOR_TYPE_FILTERS,
  MARKET_BAG_SIZE_FILTERS,
  MARKET_ITEM_TYPE_FILTERS,
  MARKET_PAGE_SIZE,
  MARKET_WEAPON_TYPE_FILTERS,
} from '../src/ui/market_filters';
import {
  buildMarketBrowse,
  buildMarketCollect,
  buildMarketSell,
  buildMarketView,
  COPPER_PER_GOLD,
  COPPER_PER_SILVER,
  marketCollectBadgeCount,
  marketCollectIndicatorView,
  marketFilterMenus,
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
    itemType: 'all',
    subtype: 'all',
    armorClass: 'all',
    primaryStat: 'all',
    rarity: 'all',
    page: 0,
    pageCount: 1,
    collectionCopper: 0,
    collectionItems: [],
    collectionSales: [],
    collectionSalesOmitted: 0,
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
        sellItemId: 'worn_sword',
        sellHave: 3,
      }).kind,
    ).toBe('no-data');
    expect(
      buildMarketView({
        info: null,
        tab: 'collect',
        filters: ALL,
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
        sellItemId: null,
        sellHave: 0,
      }).kind,
    ).toBe('browse');
    const sell = buildMarketView({
      info: i,
      tab: 'sell',
      filters: ALL,
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
        sellItemId: null,
        sellHave: 0,
      }).kind,
    ).toBe('collect');
  });
});

describe('market_view: browse states', () => {
  it('distinguishes the three empty reasons', () => {
    expect(buildMarketBrowse(info({ listings: [] }), ALL)).toEqual({
      state: 'empty',
      reason: 'browse',
    });
    expect(buildMarketBrowse(info({ listings: [], filter: 'wolf' }), ALL)).toEqual({
      state: 'empty',
      reason: 'search',
    });
    // An active type/rarity filter that matched nothing reads as 'filtered' (the server
    // returned an empty page while a dropdown is narrowing).
    expect(buildMarketBrowse(info({ listings: [] }), { itemType: 'armor', rarity: 'all' })).toEqual(
      {
        state: 'empty',
        reason: 'filtered',
      },
    );
    expect(buildMarketBrowse(info({ listings: [] }), { ...ALL, armorClass: 'mail' })).toEqual({
      state: 'empty',
      reason: 'filtered',
    });
    expect(buildMarketBrowse(info({ listings: [] }), { ...ALL, primaryStat: 'int' })).toEqual({
      state: 'empty',
      reason: 'filtered',
    });
  });

  it('renders the server page rows and drops listings whose item is unknown', () => {
    const body = buildMarketBrowse(
      info({
        listings: [listing('keen_dirk'), listing('not_a_real_item'), listing('greyjaw_pelt_cloak')],
        totalCount: 2,
      }),
      ALL,
    );
    expect(body.state).toBe('list');
    if (body.state !== 'list') return;
    expect(body.page.items.map((r) => r.listing.itemId)).toEqual([
      'keen_dirk',
      'greyjaw_pelt_cloak',
    ]);
    expect(body.page.items[0].item).toBe(ITEMS.keen_dirk);
    // total comes straight from the server snapshot (the count of all matches).
    expect(body.page.total).toBe(2);
  });

  it('renders the server-paginated page and reports its index, count, and range', () => {
    // The server already filtered + paginated; info.listings IS the page to show and
    // info.page/pageCount/totalCount drive the pager and range note.
    const rows = Array.from({ length: MARKET_PAGE_SIZE }, (_, n) =>
      listing('bone_fragments', { id: n }),
    );
    const body = buildMarketBrowse(
      info({ listings: rows, totalCount: 130, page: 1, pageCount: 3 }),
      ALL,
    );
    if (body.state !== 'list') throw new Error('expected list');
    expect(body.page.items).toHaveLength(MARKET_PAGE_SIZE);
    expect(body.page.page).toBe(1);
    expect(body.page.pageCount).toBe(3);
    expect(body.page.total).toBe(130);
    // The range describes this page's OTHER listings: page 1 of 50-per-page -> 50..100.
    expect(body.page.start).toBe(MARKET_PAGE_SIZE);
    expect(body.page.end).toBe(MARKET_PAGE_SIZE * 2);
  });

  it("always shows the viewer's own listings on top without counting them in the range", () => {
    // Own listings ride on every page for quick reclaim; the range/pageCount track the
    // paged OTHER listings only.
    // totalCount is the full match count the server sends: one own + one other.
    const body = buildMarketBrowse(
      info({
        listings: [listing('keen_dirk', { mine: true }), listing('greyjaw_pelt_cloak')],
        totalCount: 2,
        page: 0,
        pageCount: 1,
      }),
      ALL,
    );
    if (body.state !== 'list') throw new Error('expected list');
    expect(body.page.items.map((r) => r.listing.mine)).toEqual([true, false]);
    expect(body.page.total).toBe(1); // only the OTHER listing counts toward the range
    expect(body.page.start).toBe(0);
    expect(body.page.end).toBe(1); // one OTHER listing on the page; the mine row is extra
  });
});

describe('market_view: sell states', () => {
  it('is pick-empty with nothing staged or nothing held', () => {
    expect(buildMarketSell(null, 0)).toEqual({ state: 'pick-empty' });
    expect(buildMarketSell('worn_sword', 0)).toEqual({ state: 'pick-empty' });
  });

  it('refuses quest, no-list, and soulbound items', () => {
    expect(buildMarketSell('boar_hide', 1)).toEqual({ state: 'cannot-market' }); // quest item
    expect(buildMarketSell('alien_armor_plate', 1)).toEqual({ state: 'cannot-market' }); // noMarketList
    expect(buildMarketSell('heroic_mark', 1)).toEqual({ state: 'cannot-market' }); // soulbound
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

  it('caps the buyValue suggestion at 10x sell value for re-priced items', () => {
    // tanned_leather_jerkin kept its historical shop buyValue (1600c) when the
    // sellValue was re-priced to 80c, so a raw buyValue read
    // would suggest a 20x ask. The cap clamps to sellValue * 10 = 800c (8s);
    // convention-priced items (buyValue exactly 10x sell) are unaffected, which
    // the healing_potion pin above proves (170c < its 320c cap, taken as-is).
    const body = buildMarketSell('tanned_leather_jerkin', 1);
    expect(body.state).toBe('form');
    if (body.state !== 'form') return;
    expect(body.form.suggested).toEqual({ gold: 0, silver: 8, copper: 0 });
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

describe('market_view: instanced staging (issue 1165)', () => {
  it('an instanced staging forces a single-copy form and carries the payload', () => {
    const body = buildMarketSell('worn_sword', 3, { signer: 'Ayla' });
    expect(body.state).toBe('form');
    if (body.state !== 'form') return;
    expect(body.form.have).toBe(1);
    expect(body.form.instance).toEqual({ signer: 'Ayla' });
  });

  it('a plain staging carries no instance key and keeps the quantity cap', () => {
    const body = buildMarketSell('worn_sword', 3);
    expect(body.state).toBe('form');
    if (body.state !== 'form') return;
    expect(body.form.have).toBe(3);
    expect('instance' in body.form).toBe(false);
  });

  it('a transfer-locked staging cannot market (defence in depth behind the bags block)', () => {
    expect(buildMarketSell('worn_sword', 1, { bindOnTrade: true })).toEqual({
      state: 'cannot-market',
    });
    expect(buildMarketSell('worn_sword', 1, { boundTo: 7 })).toEqual({ state: 'cannot-market' });
  });

  it('collect rows surface a returned copy payload for the tooltip', () => {
    const body = buildMarketCollect(
      info({
        collectionItems: [
          { itemId: 'worn_sword', count: 1, instance: { enchant: 'ench_stat_str' } },
          { itemId: 'worn_sword', count: 2 },
        ],
      }),
    );
    expect(body.state).toBe('items');
    if (body.state !== 'items') return;
    expect(body.rows[0].instance).toEqual({ enchant: 'ench_stat_str' });
    expect('instance' in body.rows[1]).toBe(false);
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

  it('itemizes the sales behind the proceeds line', () => {
    const body = buildMarketCollect(
      info({
        collectionCopper: 1140,
        collectionSales: [
          { itemId: 'bone_fragments', count: 3, price: 200, proceeds: 190, buyerName: 'Buyer' },
          { itemId: 'wolf_fang', count: 1, price: 1000, proceeds: 950, buyerName: 'Someone' },
        ],
      }),
    );
    expect(body.state).toBe('items');
    if (body.state !== 'items') return;
    expect(body.sales.map((s) => [s.item.id, s.count, s.proceeds, s.buyerName])).toEqual([
      ['bone_fragments', 3, 190, 'Buyer'],
      ['wolf_fang', 1, 950, 'Someone'],
    ]);
    expect(body.salesOmitted).toBe(0);
    expect(body.rows).toEqual([]);
  });

  it('carries the sim ledger cap through as an omitted count', () => {
    const body = buildMarketCollect(
      info({
        collectionCopper: 500,
        collectionSales: [
          { itemId: 'wolf_fang', count: 1, price: 200, proceeds: 190, buyerName: 'Buyer' },
        ],
        collectionSalesOmitted: 4,
      }),
    );
    if (body.state !== 'items') throw new Error('expected an items body');
    expect(body.sales.length).toBe(1);
    expect(body.salesOmitted).toBe(4);
  });

  it('counts a sale of a retired item id as omitted rather than dropping it silently', () => {
    const body = buildMarketCollect(
      info({
        collectionCopper: 500,
        collectionSales: [
          { itemId: 'gone', count: 1, price: 200, proceeds: 190, buyerName: 'Buyer' },
          { itemId: 'wolf_fang', count: 1, price: 400, proceeds: 380, buyerName: 'Buyer' },
        ],
        collectionSalesOmitted: 1,
      }),
    );
    if (body.state !== 'items') throw new Error('expected an items body');
    expect(body.sales.map((s) => s.item.id)).toEqual(['wolf_fang']);
    // 1 dropped by the sim's cap plus the 1 this view could not name.
    expect(body.salesOmitted).toBe(2);
  });

  // A 1-copper listing nets 0 after the Merchant's cut: gold-only emptiness would
  // hide the row entirely, and the tab would claim nothing is waiting.
  it('is NOT empty when a zero-proceeds sale is the only thing waiting', () => {
    const body = buildMarketCollect(
      info({
        collectionSales: [
          { itemId: 'wolf_fang', count: 1, price: 1, proceeds: 0, buyerName: 'Buyer' },
        ],
      }),
    );
    expect(body.state).toBe('items');
    if (body.state !== 'items') return;
    expect(body.proceeds).toBe(0);
    expect(body.sales.length).toBe(1);
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

  it('counts the purse ONCE however many sales fill it, and once for a 0-copper sale', () => {
    const sales = [
      { itemId: 'wolf_fang', count: 1, price: 200, proceeds: 190, buyerName: 'Buyer' },
      { itemId: 'bone_fragments', count: 1, price: 200, proceeds: 190, buyerName: 'Buyer' },
    ];
    // Three sales' worth of gold is still one purse, so the badge reads 1, not 3.
    expect(marketCollectBadgeCount(info({ collectionCopper: 380, collectionSales: sales }))).toBe(
      1,
    );
    // A sale that netted no copper still fills the purse slot: the tab has a row.
    expect(
      marketCollectBadgeCount(
        info({
          collectionCopper: 0,
          collectionSales: [
            { itemId: 'wolf_fang', count: 1, price: 1, proceeds: 0, buyerName: 'Buyer' },
          ],
        }),
      ),
    ).toBe(1);
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
        sellItemId: 'worn_sword',
        sellHave: 2,
      });
      const mirror = buildMarketView({
        info: mirrorInfo,
        tab,
        filters: ALL,
        sellItemId: 'worn_sword',
        sellHave: 2,
      });
      expect(sim).toEqual(mirror);
    }
  });
});

// WHICH secondary menus the browse chrome shows per item type. Extracted out of the
// painter (issue #2189) so this is a real behavioral assertion rather than a source-text
// grep: the bag arm must bring a capacity menu WITHOUT a primary-stat menu, since bags
// carry no str/agi/int and the stat filter is a no-op outside armor/weapon.
describe('marketFilterMenus', () => {
  it('gives armor all three secondary menus, weapons two, bags only capacity', () => {
    expect(marketFilterMenus('armor')).toEqual({
      subtype: MARKET_ARMOR_TYPE_FILTERS,
      subtypeKind: 'armorSlot',
      armorClass: true,
      primaryStat: true,
    });
    expect(marketFilterMenus('weapon')).toEqual({
      subtype: MARKET_WEAPON_TYPE_FILTERS,
      subtypeKind: 'weaponFamily',
      armorClass: false,
      primaryStat: true,
    });
    expect(marketFilterMenus('bag')).toEqual({
      subtype: MARKET_BAG_SIZE_FILTERS,
      subtypeKind: 'bagCapacity',
      armorClass: false,
      primaryStat: false,
    });
  });

  // The options and the wording that describes them must be decided together, or a type
  // can get its list from one place and its labels from another (the failure that would
  // have rendered a bag capacity as "Other weapons").
  it('never hands the painter options without saying what they mean', () => {
    for (const type of MARKET_ITEM_TYPE_FILTERS) {
      const menus = marketFilterMenus(type);
      expect(
        menus.subtype === null,
        `${type}: subtype options and subtypeKind must appear together`,
      ).toBe(menus.subtypeKind === null);
    }
    // Non-vacuity: at least one type on each side of that biconditional.
    expect(marketFilterMenus('bag').subtypeKind).not.toBeNull();
    expect(marketFilterMenus('consumable').subtypeKind).toBeNull();
  });

  it('gives every other item type no secondary menu at all', () => {
    const plain = MARKET_ITEM_TYPE_FILTERS.filter(
      (type) => type !== 'armor' && type !== 'weapon' && type !== 'bag',
    );
    // Non-vacuity: 'all' plus the four kind buckets must actually be in the sweep.
    expect(plain.length).toBeGreaterThanOrEqual(5);
    for (const type of plain) {
      expect(marketFilterMenus(type), `${type} must show no secondary menu`).toEqual({
        subtype: null,
        subtypeKind: null,
        armorClass: false,
        primaryStat: false,
      });
    }
  });

  it('offers a capacity option for every bag size the catalog ships, plus all', () => {
    const menus = marketFilterMenus('bag');
    const catalogSizes = [
      ...new Set(
        Object.values(ITEMS)
          .filter((item) => item.kind === 'bag')
          .map((item) => item.bagSlots ?? 0),
      ),
    ].sort((a, b) => a - b);
    expect(catalogSizes.length).toBeGreaterThan(1);
    expect(menus.subtype).toEqual(['all', ...catalogSizes.map((slots) => `${slots}`)]);
  });
});

// The minimap-corner collect indicator (the mailIndicatorView pattern): driven by
// the always-streamed IWorld.marketCollectPending bit, NOT by marketInfo (which is
// null away from the Merchant), so it lights anywhere in the world.
describe('marketCollectIndicatorView', () => {
  it('is visible exactly while a collection is pending', () => {
    expect(marketCollectIndicatorView(true)).toEqual({ visible: true });
    expect(marketCollectIndicatorView(false)).toEqual({ visible: false });
  });
});
