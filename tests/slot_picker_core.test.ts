// The paperdoll slot picker's pure core (slot_picker_core.ts): which bag copies
// a slot lists, in what order, with what delta, and how a pick re-finds its copy
// after the bags shift.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemDef } from '../src/sim/types';
import {
  buildSlotPickerCandidates,
  resolveSlotPickerIndex,
  slotPickerDeltaTone,
} from '../src/ui/slot_picker_core';

const lookup = (id: string) => ITEMS[id];
// Injected levels so the order is decided by this table, not by content tuning.
const LEVELS: Record<string, number> = {
  worn_sword: 5,
  rusty_dagger: 9,
  eastbrook_greatsword: 12,
};
const levelOf = (item: ItemDef) => LEVELS[item.id];

describe('buildSlotPickerCandidates', () => {
  const bags = (): InvSlot[] => [
    { itemId: 'baked_bread', count: 4 },
    { itemId: 'worn_sword', count: 1 },
    { itemId: 'eastbrook_greatsword', count: 1 },
    { itemId: 'rusty_dagger', count: 1 },
    { itemId: 'worn_sword', count: 1 },
  ];
  const weaponsOnly = (item: ItemDef) => item.kind === 'weapon';

  it('lists only what the injected drop verdict accepts, best item level first', () => {
    const out = buildSlotPickerCandidates({
      inventory: bags(),
      lookup,
      canEquip: weaponsOnly,
      levelOf,
    });
    expect(out.map((c) => `${c.item.id}@${c.bagIndex}`)).toEqual([
      'eastbrook_greatsword@2',
      'rusty_dagger@3',
      // Two identical plain copies are one choice, at the first index.
      'worn_sword@1',
    ]);
  });

  it('passes each copy its own bag index to the verdict', () => {
    const asked: number[] = [];
    buildSlotPickerCandidates({
      inventory: bags(),
      lookup,
      canEquip: (_item, index) => {
        asked.push(index);
        return false;
      },
      levelOf,
    });
    expect(asked).toEqual([0, 1, 2, 3, 4]);
  });

  it('reads the delta against the worn piece, and none when the slot is empty', () => {
    const worn = buildSlotPickerCandidates({
      inventory: bags(),
      lookup,
      canEquip: weaponsOnly,
      levelOf,
      worn: { item: ITEMS.rusty_dagger },
    });
    expect(worn.map((c) => c.delta)).toEqual([3, 0, -4]);
    const empty = buildSlotPickerCandidates({
      inventory: bags(),
      lookup,
      canEquip: weaponsOnly,
      levelOf,
    });
    expect(empty.every((c) => c.delta === undefined)).toBe(true);
  });

  it('skips unknown ids and empty stacks', () => {
    const out = buildSlotPickerCandidates({
      inventory: [
        { itemId: 'zz_unknown', count: 1 },
        { itemId: 'worn_sword', count: 0 },
      ],
      lookup,
      canEquip: () => true,
      levelOf,
    });
    expect(out).toEqual([]);
  });

  it('defaults to the real copy-aware item level', () => {
    const out = buildSlotPickerCandidates({
      inventory: [{ itemId: 'eastbrook_greatsword', count: 1 }],
      lookup,
      canEquip: () => true,
    });
    expect(out).toHaveLength(1);
    expect(typeof (out[0].itemLevel ?? 0)).toBe('number');
  });
});

describe('resolveSlotPickerIndex', () => {
  it('follows the same slot object after the bags shift', () => {
    const sword: InvSlot = { itemId: 'worn_sword', count: 1 };
    const bags: InvSlot[] = [{ itemId: 'baked_bread', count: 1 }, sword];
    expect(resolveSlotPickerIndex(bags, { slot: sword })).toBe(1);
    bags.shift();
    expect(resolveSlotPickerIndex(bags, { slot: sword })).toBe(0);
  });

  it('falls back to an identical copy when the mirror rebuilt the objects', () => {
    const picked: InvSlot = { itemId: 'worn_sword', count: 1, instance: { signer: 'Aurelia' } };
    const rebuilt: InvSlot[] = [
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'worn_sword', count: 1, instance: { signer: 'Aurelia' } },
    ];
    // The plain id-mate at 0 is NOT the picked copy.
    expect(resolveSlotPickerIndex(rebuilt, { slot: picked })).toBe(1);
  });

  it('answers null once the copy has left the bags', () => {
    const picked: InvSlot = { itemId: 'worn_sword', count: 1 };
    expect(resolveSlotPickerIndex([{ itemId: 'baked_bread', count: 1 }], { slot: picked })).toBe(
      null,
    );
  });
});

describe('slotPickerDeltaTone', () => {
  it('reads up, down and same', () => {
    expect(slotPickerDeltaTone(4)).toBe('up');
    expect(slotPickerDeltaTone(-1)).toBe('down');
    expect(slotPickerDeltaTone(0)).toBe('same');
    expect(slotPickerDeltaTone(undefined)).toBe('same');
  });
});
