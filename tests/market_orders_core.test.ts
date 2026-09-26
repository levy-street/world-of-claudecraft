// The Wanted tab's pure core (src/ui/market_orders_core.ts): row building off
// MarketInfo.orders, the place form's stage validation, the typed-count clamp,
// the orderable gate, and the item picker's catalog search. Driven with plain
// snapshots and small catalogs, the market_sweep_core precedent.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { MARKET_ORDER_MAX_UNITS, type MarketOrderView } from '../src/sim/market_orders';
import { isMaterialItemId } from '../src/sim/material_ids';
import type { ItemDef } from '../src/sim/types';
import {
  buildMarketOrders,
  orderableItem,
  orderableItemById,
  orderableMatches,
  orderCountFromInput,
  orderStageProblem,
  orderStageTotal,
} from '../src/ui/market_orders_core';
import type { MarketInfo } from '../src/world_api';

const ORE = 'copper_ore';

function order(over: Partial<MarketOrderView> = {}): MarketOrderView {
  return {
    id: 1,
    buyerName: 'Halden',
    itemId: ORE,
    count: 5,
    unitPrice: 10,
    mine: false,
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

/** A plain fixture def off the real ore record, with overrides. */
function item(id: string, over: Partial<ItemDef> = {}): ItemDef {
  return { ...ITEMS[ORE], id, name: id, ...over } as ItemDef;
}

describe('buildMarketOrders', () => {
  it('resolves rows to defs, drops unknown ids, and limits deliverable to the bags', () => {
    const body = buildMarketOrders(
      info({
        orders: [
          order({ id: 1, count: 5 }),
          order({ id: 2, itemId: 'no_such_item_xyz' }),
          order({ id: 3, count: 2 }),
        ],
      }),
      () => 3,
    );
    expect(body.rows.map((r) => r.id)).toEqual([1, 3]);
    expect(body.rows[0].item).toBe(ITEMS[ORE]);
    expect(body.rows[0].buyerName).toBe('Halden');
    expect(body.rows[0].unitPrice).toBe(10);
    expect(body.rows[0]).toMatchObject({ count: 5, have: 3, deliverable: 3 });
    expect(body.rows[1]).toMatchObject({ count: 2, have: 3, deliverable: 2 });
  });

  it('gives a mine row have 0 without consulting the bags', () => {
    let asked = 0;
    const body = buildMarketOrders(info({ orders: [order({ mine: true })] }), () => {
      asked += 1;
      return 9;
    });
    expect(asked).toBe(0);
    expect(body.rows[0]).toMatchObject({ mine: true, have: 0, deliverable: 0 });
  });

  it('resolves unlisted ids to defs and drops unknown ones', () => {
    const body = buildMarketOrders(info({ unlistedMaterials: [ORE, 'no_such_item_xyz'] }), () => 0);
    expect(body.unlisted).toEqual([ITEMS[ORE]]);
  });

  it('passes the cap, the count, and the cut through', () => {
    const body = buildMarketOrders(info({ myOrderCount: 2, maxOrders: 4, cutPct: 7 }), () => 0);
    expect(body).toMatchObject({ myOrderCount: 2, maxOrders: 4, cutPct: 7 });
  });
});

describe('orderStageTotal', () => {
  it('multiplies count by unit price and floors negatives at zero', () => {
    expect(orderStageTotal({ itemId: ORE, count: 4, unitPrice: 25 })).toBe(100);
    expect(orderStageTotal({ itemId: ORE, count: -1, unitPrice: 25 })).toBe(0);
    expect(orderStageTotal({ itemId: ORE, count: 4, unitPrice: -5 })).toBe(0);
  });
});

describe('orderStageProblem', () => {
  const stage = (over: Partial<{ itemId: string | null; count: number; unitPrice: number }>) => ({
    itemId: ORE,
    count: 5,
    unitPrice: 10,
    ...over,
  });

  it('is ok when everything checks out', () => {
    expect(orderStageProblem(stage({}), 50, 0, 6)).toBe('ok');
  });
  it('names a missing item first', () => {
    expect(orderStageProblem(stage({ itemId: null }), 0, 9, 6)).toBe('no-item');
  });
  it('refuses a zero, fractional, or oversized count', () => {
    expect(orderStageProblem(stage({ count: 0 }), 1000, 0, 6)).toBe('bad-count');
    expect(orderStageProblem(stage({ count: 2.5 }), 1000, 0, 6)).toBe('bad-count');
    expect(orderStageProblem(stage({ count: MARKET_ORDER_MAX_UNITS + 1 }), 1e9, 0, 6)).toBe(
      'bad-count',
    );
    expect(orderStageProblem(stage({ count: MARKET_ORDER_MAX_UNITS }), 1e9, 0, 6)).toBe('ok');
  });
  it('refuses a zero or fractional unit price', () => {
    expect(orderStageProblem(stage({ unitPrice: 0 }), 1000, 0, 6)).toBe('bad-price');
    expect(orderStageProblem(stage({ unitPrice: 1.5 }), 1000, 0, 6)).toBe('bad-price');
  });
  it('names the cap and the purse, cap first', () => {
    expect(orderStageProblem(stage({}), 1000, 6, 6)).toBe('at-cap');
    expect(orderStageProblem(stage({}), 49, 0, 6)).toBe('cannot-afford');
    expect(orderStageProblem(stage({}), 0, 6, 6)).toBe('at-cap');
  });
});

describe('orderCountFromInput', () => {
  it('parses a positive integer and clamps junk and overflow', () => {
    expect(orderCountFromInput('')).toBe(1);
    expect(orderCountFromInput('abc')).toBe(1);
    expect(orderCountFromInput('0')).toBe(1);
    expect(orderCountFromInput('5')).toBe(5);
    expect(orderCountFromInput('999999')).toBe(MARKET_ORDER_MAX_UNITS);
    expect(orderCountFromInput('3.9')).toBe(3);
  });
});

describe('orderableItem / orderableItemById', () => {
  const catalog: Record<string, ItemDef> = {
    plain: item('plain'),
    q: item('q', { kind: 'quest' } as Partial<ItemDef>),
    nolist: item('nolist', { noMarketList: true }),
    bound: item('bound', { soulbound: true }),
  };
  it('refuses quest, no-market-list, and soulbound items', () => {
    expect(orderableItem(catalog.plain)).toBe(true);
    expect(orderableItem(catalog.q)).toBe(false);
    expect(orderableItem(catalog.nolist)).toBe(false);
    expect(orderableItem(catalog.bound)).toBe(false);
  });
  it('resolves an orderable id and nulls the rest', () => {
    expect(orderableItemById('plain', catalog)).toBe(catalog.plain);
    expect(orderableItemById('q', catalog)).toBeNull();
    expect(orderableItemById('missing', catalog)).toBeNull();
    expect(orderableItemById(ORE)).toBe(ITEMS[ORE]);
    expect(orderableItemById('no_such_item_xyz')).toBeNull();
  });
});

describe('orderableMatches', () => {
  // Material-ness is resolved by id (isMaterialItemId), so the material
  // fixtures keep their real catalog ids; the others get synthetic ones.
  const material = Object.values(ITEMS).filter((i) => isMaterialItemId(i.id) && orderableItem(i));
  const other = Object.values(ITEMS).filter((i) => !isMaterialItemId(i.id) && orderableItem(i));
  const mA = material[0].id;
  const mB = material[1].id;
  const catalog: Record<string, ItemDef> = {
    [mB]: material[1],
    [mA]: material[0],
    oA: { ...other[0], id: 'oA' },
    oB: { ...other[1], id: 'oB' },
    q: { ...other[2], id: 'q', kind: 'quest' } as ItemDef,
    none: { ...other[3], id: 'none' },
  };
  const names: Record<string, string> = {
    [mB]: 'Iron Bar',
    [mA]: 'Copper Bar',
    oA: 'Bar Stool',
    oB: 'Crowbar',
    q: 'Quest Bar',
    none: 'Nothing',
  };
  const nameOf = (i: ItemDef) => names[i.id];

  it('picks material and non-material fixtures off the real catalog', () => {
    expect(isMaterialItemId(mA)).toBe(true);
    expect(isMaterialItemId(mB)).toBe(true);
    expect(isMaterialItemId('oA')).toBe(false);
  });
  it('matches nothing on an empty query', () => {
    expect(orderableMatches('', nameOf, 8, catalog)).toEqual([]);
    expect(orderableMatches('   ', nameOf, 8, catalog)).toEqual([]);
  });
  it('matches case-insensitively, materials first, then by name, skipping unorderables', () => {
    expect(orderableMatches('BAR', nameOf, 8, catalog).map((i) => i.id)).toEqual([
      mA,
      mB,
      'oA',
      'oB',
    ]);
    expect(orderableMatches('crow', nameOf, 8, catalog).map((i) => i.id)).toEqual(['oB']);
  });
  it('respects the limit', () => {
    expect(orderableMatches('bar', nameOf, 2, catalog).map((i) => i.id)).toEqual([mA, mB]);
  });
});
