// Pure view-core tests for the Trade window (src/ui/trade_view.ts).
//
// Reproduces the reported bug: a fungible item split across multiple bag
// slots (bags.ts's DEFAULT_STACK caps a stack at 20, so 45 held units land
// in 3 slots: 20 + 20 + 5) must offer up to the TOTAL held, not just
// whichever single slot the old Array.find()-based lookup happened to hit.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { tradeOfferCeiling, tradeRowTooltipTarget } from '../src/ui/trade_view';

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

// Issue #2693: hovering an item in the trade window showed no stats tooltip
// because updateTradeWindow (hud.ts) never wired the trade slots to the
// shared attachTooltip/itemTooltip infrastructure bag slots use.
// tradeRowTooltipTarget is the pure lookup hud.ts's wiring resolves through:
// same InvSlot shape as a bag row (both offer sides carry it, per
// src/world_api/trade.ts's TradeOffer), so it must expose the exact item def
// plus per-instance payload (enchant/masterwork/signature) the bag tooltip
// itself reads.
describe('tradeRowTooltipTarget (trade slot tooltip wiring, #2693)', () => {
  it('resolves the item def for a plain trade slot', () => {
    const items: InvSlot[] = [{ itemId: 'worn_sword', count: 1 }];
    const target = tradeRowTooltipTarget(items, 0);
    expect(target?.item).toBe(ITEMS.worn_sword);
    expect(target?.instance).toBeUndefined();
  });

  it('carries the per-instance payload (enchant/masterwork/signature) through, matching the bag tooltip', () => {
    const items: InvSlot[] = [
      {
        itemId: 'worn_sword',
        count: 1,
        instance: { signer: 'Anna', rolled: { masterwork: true, stats: { str: 2 } } },
      },
    ];
    const target = tradeRowTooltipTarget(items, 0);
    expect(target?.instance).toEqual({
      signer: 'Anna',
      rolled: { masterwork: true, stats: { str: 2 } },
    });
  });

  it('resolves each offer row positionally, so the second slot does not pick up the first slot instance', () => {
    const items: InvSlot[] = [
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'gnarled_staff', count: 1, instance: { signer: 'Bob' } },
    ];
    expect(tradeRowTooltipTarget(items, 0)?.item).toBe(ITEMS.worn_sword);
    expect(tradeRowTooltipTarget(items, 0)?.instance).toBeUndefined();
    expect(tradeRowTooltipTarget(items, 1)?.item).toBe(ITEMS.gnarled_staff);
    expect(tradeRowTooltipTarget(items, 1)?.instance).toEqual({ signer: 'Bob' });
  });

  it('returns null out of range (the trade-empty placeholder row) and for an unrecognized item id', () => {
    const items: InvSlot[] = [{ itemId: 'worn_sword', count: 1 }];
    expect(tradeRowTooltipTarget(items, 1)).toBeNull();
    expect(tradeRowTooltipTarget([{ itemId: 'not_a_real_item', count: 1 }], 0)).toBeNull();
  });
});
