import { describe, expect, it } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { buildVendorView } from '../src/ui/vendor_view';

// Minimal ItemDef fixtures: buildVendorView only reads id / buyValue / sellValue.
function item(
  id: string,
  opts: { buyValue?: number; sellValue?: number; kind?: ItemDef['kind'] } = {},
): ItemDef {
  return {
    id,
    name: id,
    quality: 'common',
    kind: opts.kind ?? 'junk',
    slot: 'trinket',
    sellValue: opts.sellValue ?? 0,
    buyValue: opts.buyValue,
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
