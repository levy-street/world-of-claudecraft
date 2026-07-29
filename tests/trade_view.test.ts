// Pure view-core tests for the Trade window (src/ui/trade_view.ts).
//
// Reproduces the reported bug: a fungible item split across multiple bag
// slots (bags.ts's DEFAULT_STACK caps a stack at 20, so 45 held units land
// in 3 slots: 20 + 20 + 5) must offer up to the TOTAL held, not just
// whichever single slot the old Array.find()-based lookup happened to hit.

import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { tradeOfferCeiling } from '../src/ui/trade_view';

describe('tradeOfferCeiling (trade offer stepper cap)', () => {
  it('sums an item split across multiple bag slots instead of capping at one slot', () => {
    const inventory: InvSlot[] = [
      { itemId: 'mat_linen_cloth', count: 20 },
      { itemId: 'mat_linen_cloth', count: 20 },
      { itemId: 'mat_linen_cloth', count: 5 },
    ];
    // The old addItemToTrade used `.find(...)?.count ?? 0`, which would have
    // returned 20 here (the first matching slot), not the true total of 45.
    expect(tradeOfferCeiling(inventory, 'mat_linen_cloth')).toBe(45);
  });

  it('is unaffected by other item ids in the same bag', () => {
    const inventory: InvSlot[] = [
      { itemId: 'mat_linen_cloth', count: 20 },
      { itemId: 'mat_wool_cloth', count: 12 },
      { itemId: 'mat_linen_cloth', count: 5 },
    ];
    expect(tradeOfferCeiling(inventory, 'mat_linen_cloth')).toBe(25);
    expect(tradeOfferCeiling(inventory, 'mat_wool_cloth')).toBe(12);
  });

  it('returns the single slot count unchanged when the item is not split', () => {
    const inventory: InvSlot[] = [{ itemId: 'mat_linen_cloth', count: 7 }];
    expect(tradeOfferCeiling(inventory, 'mat_linen_cloth')).toBe(7);
  });

  it('returns 0 when the item is not held at all', () => {
    const inventory: InvSlot[] = [{ itemId: 'mat_linen_cloth', count: 20 }];
    expect(tradeOfferCeiling(inventory, 'mat_wool_cloth')).toBe(0);
  });
});
