import { describe, expect, it } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { buildVendorSellRows, buildVendorView } from '../src/ui/vendor_view';

// Minimal ItemDef fixtures: buildVendorView only reads id / buyValue / sellValue;
// buildVendorSellRows additionally reads kind / noVendorSell.
function item(
  id: string,
  opts: {
    buyValue?: number;
    sellValue?: number;
    kind?: ItemDef['kind'];
    noVendorSell?: boolean;
  } = {},
): ItemDef {
  return {
    id,
    name: id,
    quality: 'common',
    kind: opts.kind ?? 'junk',
    slot: 'trinket',
    sellValue: opts.sellValue ?? 0,
    buyValue: opts.buyValue,
    noVendorSell: opts.noVendorSell,
  } as unknown as ItemDef;
}

function table(...items: ItemDef[]): Record<string, ItemDef> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

describe('buildVendorView goods', () => {
  it('lists vendor items that exist and have a buyValue, in order', () => {
    const items = table(item('bread', { buyValue: 5 }), item('water', { buyValue: 2 }));
    const view = buildVendorView(['bread', 'water'], [], items);
    expect(view.goods.map((g) => g.itemId)).toEqual(['bread', 'water']);
    expect(view.goods.map((g) => g.price)).toEqual([5, 2]);
  });

  it('tags food/drink goods with a stack quantity of 5, other goods with 1', () => {
    const items = table(
      item('bread', { buyValue: 5, kind: 'food' }),
      item('water', { buyValue: 2, kind: 'drink' }),
      item('potion', { buyValue: 9, kind: 'potion' }),
    );
    const view = buildVendorView(['bread', 'water', 'potion'], [], items);
    expect(view.goods.map((g) => g.quantity)).toEqual([5, 5, 1]);
    // Price is the total for the purchase: per-unit buyValue times the stack quantity.
    expect(view.goods.map((g) => g.price)).toEqual([25, 10, 9]);
  });

  it('skips items missing from the table', () => {
    const items = table(item('bread', { buyValue: 5 }));
    const view = buildVendorView(['bread', 'ghost'], [], items);
    expect(view.goods.map((g) => g.itemId)).toEqual(['bread']);
  });

  it('skips items with no or zero buyValue (priceless items are never sold)', () => {
    const items = table(
      item('bread', { buyValue: 5 }),
      item('quest_token'),
      item('free', { buyValue: 0 }),
    );
    const view = buildVendorView(['bread', 'quest_token', 'free'], [], items);
    expect(view.goods.map((g) => g.itemId)).toEqual(['bread']);
  });

  it('returns empty goods for an empty vendor', () => {
    expect(buildVendorView([], [], {}).goods).toEqual([]);
  });
});

describe('buildVendorView buyback', () => {
  it('lists redeemable buyback slots with sell-value price and count', () => {
    const items = table(item('sword', { sellValue: 12 }));
    const buyback: InvSlot[] = [{ itemId: 'sword', count: 3 }];
    const view = buildVendorView([], buyback, items);
    expect(view.buyback).toEqual([{ itemId: 'sword', item: items.sword, count: 3, price: 12 }]);
  });

  it('skips slots whose item no longer exists or whose count is not positive', () => {
    const items = table(item('sword', { sellValue: 12 }));
    const buyback: InvSlot[] = [
      { itemId: 'sword', count: 1 },
      { itemId: 'ghost', count: 4 },
      { itemId: 'sword', count: 0 },
    ];
    const view = buildVendorView([], buyback, items);
    expect(view.buyback.map((b) => b.itemId)).toEqual(['sword']);
    expect(view.buyback[0].count).toBe(1);
  });

  it('reports an empty buyback list distinctly from goods', () => {
    const view = buildVendorView([], [], {});
    expect(view.buyback).toEqual([]);
  });
});

describe('buildVendorView is a pure projection', () => {
  it('returns identical structure for identical input (no hidden state)', () => {
    const items = table(item('bread', { buyValue: 5 }), item('sword', { sellValue: 12 }));
    const goodsIds = ['bread'];
    const buyback: InvSlot[] = [{ itemId: 'sword', count: 2 }];
    expect(buildVendorView(goodsIds, buyback, items)).toEqual(
      buildVendorView(goodsIds, buyback, items),
    );
  });
});

describe('buildVendorSellRows', () => {
  it('lists sellable bag rows with unit sell value and a whole-stack total, in first-seen order', () => {
    const items = table(item('cloth', { sellValue: 4 }), item('ore', { sellValue: 10 }));
    const inv: InvSlot[] = [
      { itemId: 'cloth', count: 5 },
      { itemId: 'ore', count: 3 },
    ];
    const rows = buildVendorSellRows(inv, items);
    expect(rows.map((r) => r.itemId)).toEqual(['cloth', 'ore']);
    expect(rows.map((r) => r.unitPrice)).toEqual([4, 10]);
    expect(rows.map((r) => r.count)).toEqual([5, 3]);
    // total is unitPrice times count: what selling the whole stack pays out.
    expect(rows.map((r) => r.total)).toEqual([20, 30]);
    expect(rows[0].item).toBe(items.cloth);
  });

  it('aggregates split stacks of the same item into ONE row (the sim sells by itemId)', () => {
    const items = table(item('cloth', { sellValue: 4 }));
    const inv: InvSlot[] = [
      { itemId: 'cloth', count: 20 },
      { itemId: 'cloth', count: 12 },
    ];
    const rows = buildVendorSellRows(inv, items);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(32);
    expect(rows[0].total).toBe(128); // 4 * 32
  });

  it('flags a plain fungible row as NOT instanced (sells with no confirm friction)', () => {
    const items = table(item('cloth', { sellValue: 4 }));
    const rows = buildVendorSellRows([{ itemId: 'cloth', count: 5 }], items);
    expect(rows[0].instanced).toBe(false);
  });

  it('flags a row carrying per-instance (rolled-stat) payload as instanced', () => {
    const items = table(item('sword', { sellValue: 500 }));
    const inv: InvSlot[] = [
      { itemId: 'sword', count: 1, instance: { rolled: { stats: { power: 7 } } } },
    ];
    expect(buildVendorSellRows(inv, items)[0].instanced).toBe(true);
  });

  it('flags an aggregated row instanced if ANY contributing slot is instance-bearing', () => {
    const items = table(item('sword', { sellValue: 500 }));
    const inv: InvSlot[] = [
      { itemId: 'sword', count: 1 }, // plain copy
      { itemId: 'sword', count: 1, instance: { rolled: { stats: { power: 7 } } } },
    ];
    const rows = buildVendorSellRows(inv, items);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].instanced).toBe(true);
  });

  it('skips items missing from the table', () => {
    const items = table(item('cloth', { sellValue: 4 }));
    const inv: InvSlot[] = [
      { itemId: 'cloth', count: 1 },
      { itemId: 'ghost', count: 9 },
    ];
    expect(buildVendorSellRows(inv, items).map((r) => r.itemId)).toEqual(['cloth']);
  });

  it('skips quest items (they cannot be sold, matching the sim rejection)', () => {
    const items = table(
      item('cloth', { sellValue: 4 }),
      item('relic', { sellValue: 999, kind: 'quest' }),
    );
    const inv: InvSlot[] = [
      { itemId: 'cloth', count: 1 },
      { itemId: 'relic', count: 1 },
    ];
    expect(buildVendorSellRows(inv, items).map((r) => r.itemId)).toEqual(['cloth']);
  });

  it('skips noVendorSell items (matching the sim rejection)', () => {
    const items = table(
      item('cloth', { sellValue: 4 }),
      item('bound', { sellValue: 500, noVendorSell: true }),
    );
    const inv: InvSlot[] = [
      { itemId: 'cloth', count: 1 },
      { itemId: 'bound', count: 1 },
    ];
    expect(buildVendorSellRows(inv, items).map((r) => r.itemId)).toEqual(['cloth']);
  });

  it('skips items with a zero or missing sell value (nothing to gain)', () => {
    const items = table(
      item('cloth', { sellValue: 4 }),
      item('free', { sellValue: 0 }),
      item('nil'),
    );
    const inv: InvSlot[] = [
      { itemId: 'cloth', count: 1 },
      { itemId: 'free', count: 2 },
      { itemId: 'nil', count: 2 },
    ];
    expect(buildVendorSellRows(inv, items).map((r) => r.itemId)).toEqual(['cloth']);
  });

  it('skips slots whose count is not positive', () => {
    const items = table(item('cloth', { sellValue: 4 }));
    const inv: InvSlot[] = [
      { itemId: 'cloth', count: 0 },
      { itemId: 'cloth', count: -3 },
    ];
    expect(buildVendorSellRows(inv, items)).toEqual([]);
  });

  it('returns empty rows for an empty inventory', () => {
    expect(buildVendorSellRows([], {})).toEqual([]);
  });

  it('is a pure projection (identical output for identical input)', () => {
    const items = table(item('cloth', { sellValue: 4 }), item('ore', { sellValue: 10 }));
    const inv: InvSlot[] = [
      { itemId: 'cloth', count: 5 },
      { itemId: 'ore', count: 3 },
    ];
    expect(buildVendorSellRows(inv, items)).toEqual(buildVendorSellRows(inv, items));
  });
});
