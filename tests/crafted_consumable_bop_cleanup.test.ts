import { describe, expect, it } from 'vitest';
import {
  normalizePartyTradeContainers,
  normalizePartyTradeSlots,
} from '../src/sim/loot/bop_trade_cleanup';
import type { InvSlot } from '../src/sim/types';

const POTION = 'minor_healing_potion';
const expired = (count: number, signer: string): InvSlot => ({
  itemId: POTION,
  count,
  instance: { partyTrade: { untilMs: 100, eligible: ['Ana', 'Bru'] } },
  materialSources: [{ source: { signer }, count }],
});

describe('crafted consumable provenance survives party trade retirement', () => {
  it('tops up with exact sources, splits at cap and leaves untouched partial rows alone', () => {
    const slots: InvSlot[] = [
      { itemId: POTION, count: 18, materialSources: [{ source: { signer: 'Ana' }, count: 18 }] },
      { ...expired(25, 'Bru'), slot: 7 },
      { itemId: 'baked_bread', count: 2 },
      { itemId: 'baked_bread', count: 3 },
    ];
    const before = structuredClone(slots);
    const result = normalizePartyTradeSlots(slots, 100);
    expect(result.map((slot) => slot.count)).toEqual([20, 20, 3, 2, 3]);
    expect(result[0].materialSources).toEqual([
      { source: { signer: 'Ana' }, count: 18 },
      { source: { signer: 'Bru' }, count: 2 },
    ]);
    expect(result[1]).toEqual({
      itemId: POTION,
      count: 20,
      slot: 7,
      materialSources: [{ source: { signer: 'Bru' }, count: 20 }],
    });
    expect(result[2].materialSources).toEqual([{ source: { signer: 'Bru' }, count: 3 }]);
    expect(result[3]).toBe(slots[2]);
    expect(result[4]).toBe(slots[3]);
    expect(slots).toEqual(before);
    expect(normalizePartyTradeSlots(result, 100)).toBe(result);
  });

  it('preserves separated, locked and recipe-distinct source rows during retirement', () => {
    const source = expired(2, 'Ana');
    const slots: InvSlot[] = [
      { ...source, materialSeparated: true },
      { ...source, instance: { ...source.instance, locked: true } },
      { ...source, craftedRecipeId: 'other_recipe' },
      { ...expired(1, 'Bru'), instance: { ...source.instance, boundTo: 22 } },
    ];
    const result = normalizePartyTradeSlots(slots, 100);
    expect(result).toHaveLength(4);
    expect(result.map((slot) => slot.materialSources)).toEqual(
      slots.map((slot) => slot.materialSources),
    );
    expect(result[0].materialSeparated).toBe(true);
    expect(result[1].instance).toEqual({ locked: true });
    expect(result[2].craftedRecipeId).toBe('other_recipe');
    expect(result[3].instance).toEqual({ boundTo: 22 });
  });

  it('keeps buyback recency, oversized counts, ledger and metadata without merging or splitting', () => {
    const row = { ...expired(27, 'Ana'), slot: 9, materialSeparated: true as const };
    const owner = {
      inventory: [],
      bank: { inventory: [] },
      vendorBuyback: [row, expired(1, 'Bru')],
    };
    normalizePartyTradeContainers(owner, 100);
    expect(owner.vendorBuyback).toEqual([
      {
        itemId: POTION,
        count: 27,
        slot: 9,
        materialSeparated: true,
        materialSources: row.materialSources,
      },
      { itemId: POTION, count: 1, materialSources: [{ source: { signer: 'Bru' }, count: 1 }] },
    ]);
    expect(row.instance?.partyTrade).toBeDefined();
  });

  it('refuses an inconsistent ledger before mutating any source or merge target', () => {
    const slots: InvSlot[] = [
      { itemId: POTION, count: 18, materialSources: [{ source: {}, count: 18 }] },
      expired(1, 'Ana'),
      { ...expired(2, 'Bru'), materialSources: [{ source: { signer: 'Bru' }, count: 1 }] },
    ];
    const before = structuredClone(slots);
    expect(() => normalizePartyTradeSlots(slots, 100)).toThrow('invalid source state');
    expect(slots).toEqual(before);
  });
});
