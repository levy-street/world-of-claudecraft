// The buy-order planner half of src/sim/market_orders.ts, driven with plain
// objects: the immediate-fill walk over per-unit-sorted candidates, the count
// sanitizer, and the unlisted-material readout. What the live board DOES with a
// plan (coin, goods, collections, messages) is pinned in tests/market_orders.test.ts.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  MARKET_ORDER_MAX_UNITS,
  orderEscrow,
  planOrderFill,
  sanitizeOrderCount,
  unlistedMaterialIds,
} from '../src/sim/market_orders';
import { type SweepableListing, sweepCandidates } from '../src/sim/market_sweep';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_ids';

const ORE = 'copper_ore';

function row(
  id: number,
  count: number,
  price: number,
  extra: Partial<SweepableListing> = {},
): SweepableListing {
  return { id, sellerKey: `s${id}`, itemId: ORE, count, price, house: false, ...extra };
}

const notMine = () => false;

describe('planOrderFill', () => {
  it('takes whole rows cheapest per unit first while they fit under the bid and the count', () => {
    // Per unit: #1 = 2, #2 = 3, #3 = 4 (sorted by sweepCandidates), bid 3, want 4.
    const cands = sweepCandidates([row(3, 1, 4), row(1, 2, 4), row(2, 2, 6)], ORE);
    const plan = planOrderFill(cands, 4, 3, notMine);
    expect(plan.listingIds).toEqual([1, 2]);
    expect(plan.units).toBe(4);
    expect(plan.total).toBe(10);
  });

  it('stops at the first row priced above the bid per unit (the list is sorted)', () => {
    const cands = sweepCandidates([row(1, 1, 2), row(2, 1, 5), row(3, 1, 1)], ORE);
    const plan = planOrderFill(cands, 3, 2, notMine);
    expect(plan.listingIds).toEqual([3, 1]);
    expect(plan.units).toBe(2);
  });

  it('never overshoots the wanted count: a row bigger than the remainder is skipped, a later smaller one still fits', () => {
    // #1: 5 units at 1 each (too big for want 3), #2: 2 units at 2 each, #3: 1 at 3.
    const cands = sweepCandidates([row(1, 5, 5), row(2, 2, 4), row(3, 1, 3)], ORE);
    const plan = planOrderFill(cands, 3, 3, notMine);
    expect(plan.listingIds).toEqual([2, 3]);
    expect(plan.units).toBe(3);
    expect(plan.total).toBe(7);
  });

  it("skips the buyer's own rows without ending the walk", () => {
    const cands = sweepCandidates([row(1, 1, 1), row(2, 1, 1), row(3, 1, 1)], ORE);
    const plan = planOrderFill(cands, 2, 1, (l) => l.id === 1);
    expect(plan.listingIds).toEqual([2, 3]);
  });

  it('yields an empty plan when nothing is under the bid', () => {
    const cands = sweepCandidates([row(1, 1, 10)], ORE);
    expect(planOrderFill(cands, 1, 9, notMine)).toEqual({ listingIds: [], units: 0, total: 0 });
  });

  it('never mutates its input', () => {
    const cands = sweepCandidates([row(1, 1, 1), row(2, 1, 1)], ORE);
    const snapshot = JSON.stringify(cands);
    planOrderFill(cands, 2, 1, notMine);
    expect(JSON.stringify(cands)).toBe(snapshot);
  });
});

describe('sanitizeOrderCount', () => {
  it('admits positive integers within the cap and refuses everything else', () => {
    expect(sanitizeOrderCount(1)).toBe(1);
    expect(sanitizeOrderCount(MARKET_ORDER_MAX_UNITS)).toBe(MARKET_ORDER_MAX_UNITS);
    expect(sanitizeOrderCount(MARKET_ORDER_MAX_UNITS + 1)).toBeNull();
    expect(sanitizeOrderCount(0)).toBeNull();
    expect(sanitizeOrderCount(1.5)).toBeNull();
    expect(sanitizeOrderCount(Number.NaN)).toBeNull();
    expect(sanitizeOrderCount('3')).toBeNull();
  });
});

describe('orderEscrow', () => {
  it('is count times unit price', () => {
    expect(orderEscrow({ count: 7, unitPrice: 30 })).toBe(210);
  });
});

describe('unlistedMaterialIds', () => {
  it('lists every marketable material with no listing, sorted by catalog name', () => {
    const ids = unlistedMaterialIds([]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(MATERIAL_ITEM_IDS.has(id)).toBe(true);
      const def = ITEMS[id];
      expect(def).toBeDefined();
      expect(def.kind).not.toBe('quest');
      expect(def.noMarketList ?? false).toBe(false);
      expect(def.soulbound ?? false).toBe(false);
    }
    const names = ids.map((id) => ITEMS[id].name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('drops a material the moment any listing (house stock included) carries it', () => {
    const all = unlistedMaterialIds([]);
    expect(all).toContain(ORE);
    expect(unlistedMaterialIds([{ itemId: ORE }])).not.toContain(ORE);
  });

  it('honours a custom material set', () => {
    expect(unlistedMaterialIds([], new Set([ORE, 'no_such_item']))).toEqual([ORE]);
  });
});
