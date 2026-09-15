// The Market Sweep planner (src/sim/market_sweep.ts): the pure, host-agnostic
// decision behind "buy N units of one item across many listings, cheapest first".
// Driven directly with plain listing objects, the market_collapse precedent, so the
// ordering, eligibility, and all-or-nothing rules are pinned without a live Market.
import { describe, expect, it } from 'vitest';
import {
  MARKET_SWEEP_MAX_UNITS,
  planMarketSweep,
  type SweepableListing,
  sanitizeSweepCount,
} from '../src/sim/market_sweep';

const ORE = 'copper_ore';
const FANG = 'wolf_fang';

function row(over: Partial<SweepableListing> & { id: number }): SweepableListing {
  return {
    sellerKey: 'seller-a',
    itemId: ORE,
    count: 1,
    price: 10,
    house: false,
    ...over,
  };
}

const notMine = () => false;

describe('planMarketSweep', () => {
  it('takes the cheapest PER-UNIT listings first, not the cheapest stacks', () => {
    const book = [
      row({ id: 1, count: 1, price: 9 }), // 9 each
      row({ id: 2, count: 5, price: 25 }), // 5 each
      row({ id: 3, count: 2, price: 12 }), // 6 each
    ];
    const plan = planMarketSweep(book, ORE, 6, notMine);
    expect(plan.listingIds).toEqual([2, 3]);
    expect(plan.units).toBe(7);
    expect(plan.total).toBe(37);
    expect(plan.short).toBe(false);
  });

  it('stops at the first listing that reaches the wanted count (whole stacks only)', () => {
    const book = [row({ id: 1, count: 3, price: 30 }), row({ id: 2, count: 3, price: 30 })];
    const plan = planMarketSweep(book, ORE, 3, notMine);
    expect(plan.listingIds).toEqual([1]);
    expect(plan.units).toBe(3);
    expect(plan.total).toBe(30);
  });

  it('breaks a per-unit tie toward the older listing id', () => {
    const book = [row({ id: 7, price: 10 }), row({ id: 3, price: 10 }), row({ id: 5, price: 10 })];
    expect(planMarketSweep(book, ORE, 2, notMine).listingIds).toEqual([3, 5]);
  });

  it('skips other items, house stock, the viewer own rows, and non-fungible copies', () => {
    const book = [
      row({ id: 1, itemId: FANG, price: 1 }),
      row({ id: 2, house: true, price: 1 }),
      row({ id: 3, sellerKey: 'me', price: 1 }),
      row({ id: 4, instance: { name: 'Signed' }, price: 1 }),
      row({
        id: 5,
        price: 1,
        materialSources: [{ source: { signer: 'Someone' }, units: 1 } as never],
      }),
      // A crafted-recipe stack does not merge into the plain stack, so it never
      // rides a sweep (module header: the one summed bag check must be exact);
      // an UNSIGNED material stack is plain and does.
      row({ id: 7, price: 1, craftedRecipeId: 'smelt_copper' }),
      row({ id: 8, price: 60, materialSources: [{ source: {}, units: 1 } as never] }),
      row({ id: 6, price: 50 }),
    ];
    const plan = planMarketSweep(book, ORE, 2, (l) => l.sellerKey === 'me');
    expect(plan.listingIds).toEqual([6, 8]);
    expect(plan.total).toBe(110);
  });

  it('reports a short book: every eligible listing, flagged, never an empty lie', () => {
    const book = [row({ id: 1, count: 2, price: 20 })];
    const plan = planMarketSweep(book, ORE, 5, notMine);
    expect(plan.listingIds).toEqual([1]);
    expect(plan.units).toBe(2);
    expect(plan.short).toBe(true);
  });

  it('returns an empty plan when nothing is eligible', () => {
    const plan = planMarketSweep([row({ id: 1, house: true })], ORE, 1, notMine);
    expect(plan).toMatchObject({ listingIds: [], units: 0, total: 0, short: true });
  });

  it('never mutates or reorders the caller book', () => {
    const book = [row({ id: 2, price: 5 }), row({ id: 1, price: 1 })];
    const before = book.map((l) => l.id);
    planMarketSweep(book, ORE, 2, notMine);
    expect(book.map((l) => l.id)).toEqual(before);
  });
});

describe('sanitizeSweepCount', () => {
  it('accepts a positive integer up to the sweep cap', () => {
    expect(sanitizeSweepCount(1)).toBe(1);
    expect(sanitizeSweepCount(MARKET_SWEEP_MAX_UNITS)).toBe(MARKET_SWEEP_MAX_UNITS);
  });
  it('refuses zero, negatives, fractions, non-finite, non-numbers, and past the cap', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined]) {
      expect(sanitizeSweepCount(bad), String(bad)).toBeNull();
    }
    expect(sanitizeSweepCount(MARKET_SWEEP_MAX_UNITS + 1)).toBeNull();
  });
});
