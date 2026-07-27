import { describe, expect, it, vi } from 'vitest';
import {
  canFitExactLootSlot,
  cloneExactLootSlot,
  type ExactItemGrantSink,
  grantExactLootSlot,
  returnExactLootSlotToCorpse,
} from '../src/sim/loot/exact_item_grant';
import type { ProceduralItemInstance } from '../src/sim/procedural_item';
import type { ItemInstancePayload, LootSlot } from '../src/sim/types';

function payload(uid: string, str: number): ItemInstancePayload {
  const procedural: ProceduralItemInstance = {
    version: 1,
    uid,
    baseId: 'worn_sword',
    itemLevel: 10,
    rarity: 'magic',
    affixes: [
      {
        affixId: 'mighty',
        family: 'primary.strength',
        position: 'prefix',
        tier: 2,
        revision: 1,
        budget: str,
        values: { str },
        ranges: { str: { min: 2, max: 4 } },
      },
    ],
    generatedName: {
      baseId: 'worn_sword',
      prefixId: 'procedural.name.mighty',
    },
    seed: str,
  };
  return { procedural };
}

function sink() {
  const addItem = vi.fn<ExactItemGrantSink['addItem']>();
  const addItemInstance = vi.fn<ExactItemGrantSink['addItemInstance']>();
  return { addItem, addItemInstance } satisfies ExactItemGrantSink;
}

describe('exact loot item grants', () => {
  it('routes plain and instanced awards through distinct authoritative hubs', () => {
    const target = sink();
    grantExactLootSlot(target, { itemId: 'wolf_fang', count: 3 }, 7);
    const instance = payload('pi1:test:1', 3);
    grantExactLootSlot(target, { itemId: 'worn_sword', count: 1, instance }, 8);
    expect(target.addItem).toHaveBeenCalledWith('wolf_fang', 3, 7);
    expect(target.addItemInstance).toHaveBeenCalledWith('worn_sword', instance, 8, 1);
  });

  it('preserves the exact UID and byte-equivalent payload at the grant boundary', () => {
    const target = sink();
    const instance = payload('pi1:test:42', 4);
    grantExactLootSlot(target, { itemId: 'worn_sword', count: 1, instance }, 9);
    const granted = target.addItemInstance.mock.calls[0][1] as ItemInstancePayload;
    expect(granted).toBe(instance);
    expect(granted.procedural?.uid).toBe('pi1:test:42');
    expect(JSON.stringify(granted)).toBe(JSON.stringify(instance));
  });

  it('models full-bag capacity with the exact instance, not only its base id', () => {
    const candidate = payload('pi1:test:candidate', 4);
    const other = payload('pi1:test:other', 2);
    const full = [{ itemId: 'worn_sword', count: 1, instance: other }];
    expect(
      canFitExactLootSlot(full, 1, {
        itemId: 'worn_sword',
        count: 1,
        instance: candidate,
      }),
    ).toBe(false);
    expect(
      canFitExactLootSlot([], 1, {
        itemId: 'worn_sword',
        count: 1,
        instance: candidate,
      }),
    ).toBe(true);
  });

  it('deep-clones pending and corpse slot payloads without changing identity', () => {
    const original: LootSlot = {
      itemId: 'worn_sword',
      count: 1,
      instance: payload('pi1:test:clone', 3),
      personalFor: [1, 2],
    };
    const cloned = cloneExactLootSlot(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.instance).not.toBe(original.instance);
    expect(cloned.instance?.procedural).not.toBe(original.instance?.procedural);
    expect(cloned.personalFor).not.toBe(original.personalFor);
    expect(cloned.instance?.procedural?.uid).toBe('pi1:test:clone');
  });

  it('returns a procedural roll as its own open corpse row', () => {
    const instance = payload('pi1:test:return', 3);
    const items: LootSlot[] = [];
    const returned = returnExactLootSlotToCorpse(items, {
      itemId: 'worn_sword',
      count: 1,
      instance,
    });
    expect(items).toHaveLength(1);
    expect(returned.openToAll).toBe(true);
    expect(returned.instance).toEqual(instance);
    expect(returned.instance).not.toBe(instance);
    expect(returned.instance?.procedural?.uid).toBe('pi1:test:return');
  });

  it('does not hide duplicate procedural returns inside a counted stack', () => {
    const instance = payload('pi1:test:duplicate', 3);
    const items: LootSlot[] = [];
    returnExactLootSlotToCorpse(items, {
      itemId: 'worn_sword',
      count: 1,
      instance,
    });
    returnExactLootSlotToCorpse(items, {
      itemId: 'worn_sword',
      count: 1,
      instance,
    });
    expect(items).toHaveLength(2);
    expect(items.map((slot) => slot.count)).toEqual([1, 1]);
  });

  it('retains legacy merge behavior for identical non-procedural returns', () => {
    const items: LootSlot[] = [];
    returnExactLootSlotToCorpse(items, { itemId: 'wolf_fang', count: 1 });
    returnExactLootSlotToCorpse(items, { itemId: 'wolf_fang', count: 2 });
    expect(items).toEqual([{ itemId: 'wolf_fang', count: 3, openToAll: true }]);
  });
});
