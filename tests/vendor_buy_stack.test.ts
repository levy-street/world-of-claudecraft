import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemDef } from '../src/sim/types';
import {
  bulkBuyQuantity,
  buyPurchaseTotals,
  maxBuyCount,
  sanitizeBuyCount,
  vendorCountForced,
} from '../src/sim/vendor_buy_stack';

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

describe('sanitizeBuyCount (phase 21, Q20: hostile counts refused, never coerced)', () => {
  it('absent means the ordinary single purchase', () => {
    expect(sanitizeBuyCount(undefined)).toBe(1);
  });

  it('accepts legal integer requests as-is', () => {
    expect(sanitizeBuyCount(1)).toBe(1);
    expect(sanitizeBuyCount(2)).toBe(2);
    expect(sanitizeBuyCount(10)).toBe(10);
    // A safe-integer magnitude passes sanitize; the OVERFLOW guard in
    // buyPurchaseTotals is what refuses it, with the money toast.
    expect(sanitizeBuyCount(1e15)).toBe(1e15);
    expect(sanitizeBuyCount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses every hostile shape per-dimension: zero, negative, fractional, NaN, Infinity, unsafe', () => {
    expect(sanitizeBuyCount(0)).toBeNull();
    expect(sanitizeBuyCount(-1)).toBeNull();
    expect(sanitizeBuyCount(-1e9)).toBeNull();
    expect(sanitizeBuyCount(2.5)).toBeNull();
    expect(sanitizeBuyCount(Number.NaN)).toBeNull();
    expect(sanitizeBuyCount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(sanitizeBuyCount(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(sanitizeBuyCount(2 ** 53)).toBeNull();
  });
});

describe('vendorCountForced (Q23 force-1 rows)', () => {
  it('forces mounts, the riding service, soulbound rows, and honor-priced rows', () => {
    expect(vendorCountForced(item({ kind: 'mount' }))).toBe(true);
    expect(vendorCountForced(item({ teachesRiding: true }))).toBe(true);
    expect(vendorCountForced(item({ soulbound: true }))).toBe(true);
    expect(vendorCountForced(item({ priceHonor: 7 }))).toBe(true);
  });

  it('leaves plain copper rows countable, mirroring the buy path price read exactly', () => {
    expect(vendorCountForced(item({ buyValue: 40 }))).toBe(false);
    // items.ts buyItem floors priceHonor and treats a floored-to-zero or
    // non-finite value as unpriced; the predicate must agree or the UI would
    // force a row the sim happily multiplies.
    expect(vendorCountForced(item({ priceHonor: 0.5 }))).toBe(false);
    expect(vendorCountForced(item({ priceHonor: Number.NaN }))).toBe(false);
    expect(vendorCountForced(item({ priceHonor: 0 }))).toBe(false);
  });
});

describe('buyPurchaseTotals (atomic count totals, overflow-guarded)', () => {
  it('multiplies copper per unit and honor per purchase (the asymmetry, explicit)', () => {
    // potion: vendorStackSize 1, so units equal count.
    expect(buyPurchaseTotals(item({}), 40, 0, 3)).toEqual({ units: 3, copper: 120, honor: 0 });
    // food: vendorStackSize 5, so 4 purchases grant 20 units and copper is
    // per-unit times UNITS while honor stays per-purchase times COUNT.
    expect(buyPurchaseTotals(item({ kind: 'food' }), 25, 0, 4)).toEqual({
      units: 20,
      copper: 500,
      honor: 0,
    });
    expect(buyPurchaseTotals(item({ kind: 'food' }), 10, 7, 2)).toEqual({
      units: 10,
      copper: 100,
      honor: 14,
    });
  });

  it('count 1 reproduces the single-purchase totals exactly', () => {
    expect(buyPurchaseTotals(item({ kind: 'food' }), 25, 0, 1)).toEqual({
      units: 5,
      copper: 125,
      honor: 0,
    });
    expect(buyPurchaseTotals(item({}), 800, 800, 1)).toEqual({
      units: 1,
      copper: 800,
      honor: 800,
    });
  });

  it('returns null when any total leaves safe-integer range, and not one step earlier', () => {
    // Copper overflow with a perfectly legal count: 1e6 x 1e10 = 1e16 is past
    // 2^53 - 1 while the neighbouring 9e9 count stays inside it, so the pair
    // brackets the guard rather than testing a point far from the boundary.
    expect(buyPurchaseTotals(item({}), 1_000_000, 0, 1e10)).toBeNull();
    expect(buyPurchaseTotals(item({}), 1_000_000, 0, 9e9)).toEqual({
      units: 9e9,
      copper: 9e15,
      honor: 0,
    });
    // Units overflow on a free vendor (unit price 0): the guard must catch the
    // grant quantity itself, not just money.
    expect(buyPurchaseTotals(item({ kind: 'food' }), 0, 0, 2e15)).toBeNull();
    // Honor overflow.
    expect(buyPurchaseTotals(item({}), 0, 1_000_000, 1e10)).toBeNull();
  });
});

describe('maxBuyCount (the custom prompt cap, Q19: countFit in row units)', () => {
  const empty: InvSlot[] = [];

  it('caps at bag fit in row units for a stacking single-unit row', () => {
    // minor_healing_potion: default stack 20, row unit 1. 16 free slots hold
    // 320 units, so 320 purchases fit.
    expect(maxBuyCount(empty, 16, ITEMS.minor_healing_potion)).toBe(320);
  });

  it('divides unit fit by the food row unit of 5', () => {
    // baked_bread: stack 20, row unit 5: 320 units is 64 purchases.
    expect(maxBuyCount(empty, 16, ITEMS.baked_bread)).toBe(64);
  });

  it('counts existing-stack top-up room like the sim capacity model', () => {
    // One bread stack at 18/20 in a 16-slot bag: 2 top-up units plus 15 fresh
    // slots of 20 is 302 units, floored to 60 row units.
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 18 }];
    expect(maxBuyCount(inv, 16, ITEMS.baked_bread)).toBe(60);
  });

  it('reports 0 for full bags (the prompt floors to 1 and lets the server refuse)', () => {
    const inv: InvSlot[] = Array.from({ length: 16 }, () => ({ itemId: 'worn_sword', count: 1 }));
    expect(maxBuyCount(inv, 16, ITEMS.baked_bread)).toBe(0);
  });
});
