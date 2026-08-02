import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import { bulkBuyQuantity } from '../src/sim/vendor_buy_stack';

const item = (over: Partial<ItemDef>): ItemDef =>
  ({
    id: 'x',
    name: 'X',
    kind: 'potion',
    sellValue: 1,
    ...over,
  }) as ItemDef;

describe('bulkBuyQuantity', () => {
  it('buys the full stack size when fully affordable', () => {
    // Default stack for a non-unstacked kind (bags.ts DEFAULT_STACK) is 20.
    const def = item({});
    expect(bulkBuyQuantity(def, 10, 10_000)).toBe(20);
  });

  it('buys a smaller floor-affordable quantity when short on copper', () => {
    const def = item({});
    expect(bulkBuyQuantity(def, 10, 75)).toBe(7); // floor(75 / 10)
  });

  it('returns 0 when even one unit is unaffordable (caller floors to 1 for the error path)', () => {
    const def = item({});
    expect(bulkBuyQuantity(def, 10, 0)).toBe(0);
    expect(bulkBuyQuantity(def, 10, 9)).toBe(0);
  });

  it('never exceeds the item stack size even with ample gold', () => {
    const def = item({ stackSize: 5 });
    expect(bulkBuyQuantity(def, 1, 1_000_000)).toBe(5);
  });

  it('a free vendor (unitCopper <= 0) always returns the full stack size', () => {
    const def = item({ stackSize: 12 });
    expect(bulkBuyQuantity(def, 0, 0)).toBe(12);
    expect(bulkBuyQuantity(def, 0, 1_000_000)).toBe(12);
  });

  it('an item that does not stack (stackSize 1) never buys more than 1', () => {
    const def = item({ kind: 'weapon' });
    expect(bulkBuyQuantity(def, 10, 1_000_000)).toBe(1);
  });
});
