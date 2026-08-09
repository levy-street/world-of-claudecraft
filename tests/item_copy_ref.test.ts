// The per-copy item addressing leaf (src/sim/item_copy_ref.ts).
//
// The behavior under test is "which copy of an item id does an action consume",
// which has been guessed three separate times in this tree (the phase 12 trade
// fix, the phase 18 discard/vendor widening, the #2398 buyback review). The
// assertions below are written around the two things those fixes kept getting
// wrong: an invalid selection must REFUSE rather than silently guess, and the
// id-only fallback must stay byte-identical to the historical walk.
//
// Pure leaf, so this drives it with plain arrays: no Sim, no SimContext.

import { describe, expect, it } from 'vitest';
import {
  consumeNewestInventoryUnit,
  consumeSelectedInventorySlot,
  itemCopyPin,
  selectedInventorySlot,
} from '../src/sim/item_copy_ref';
import type { InvSlot } from '../src/sim/types';

/** A plain (fungible) stack. */
const plain = (itemId: string, count = 1): InvSlot => ({ itemId, count });

/** An instanced copy: the enchanted / masterwork / signed case that makes two
 *  copies of one id non-interchangeable in the first place. */
const enchanted = (itemId: string, enchantId: string, count = 1): InvSlot => ({
  itemId,
  count,
  instance: { enchantId } as InvSlot['instance'],
});

describe('itemCopyPin', () => {
  it('separates two copies of the same id that differ only by payload', () => {
    // The whole premise: without this, "the girdle" names two different objects.
    expect(itemCopyPin(plain('girdle'))).not.toBe(itemCopyPin(enchanted('girdle', 'power')));
  });

  it('is stable across key order, so it survives a serialize round trip', () => {
    const a: InvSlot = { itemId: 'girdle', count: 1, instance: { a: 1, b: 2 } as never };
    const b: InvSlot = { itemId: 'girdle', count: 1, instance: { b: 2, a: 1 } as never };
    expect(itemCopyPin(a)).toBe(itemCopyPin(b));
  });

  it('ignores count and bag position, which are exactly what shift', () => {
    // A pin that moved when the stack size changed would false-refuse after any
    // partial consume, so this is a real property rather than an incidental one.
    expect(itemCopyPin(plain('girdle', 1))).toBe(itemCopyPin(plain('girdle', 5)));
  });

  it('distinguishes crafted provenance', () => {
    expect(itemCopyPin({ itemId: 'girdle', count: 1, craftedRecipeId: 'r1' })).not.toBe(
      itemCopyPin(plain('girdle')),
    );
  });

  it('fingerprints an explicit undefined like an ABSENT key', () => {
    // The property the move originally carried and this PR first dropped: JSON
    // drops both forms, so clearing a field by assignment must not flip the pin.
    // It matters more once pins persist in JSONB, where a round trip erases
    // undefined-valued keys (the loadout gear sets in the stacked PR).
    const cleared: InvSlot = {
      itemId: 'girdle',
      count: 1,
      instance: { enchantId: 'power', boundTo: undefined } as never,
    };
    const absent: InvSlot = {
      itemId: 'girdle',
      count: 1,
      instance: { enchantId: 'power' } as never,
    };
    expect(itemCopyPin(cleared)).toBe(itemCopyPin(absent));
  });

  it('survives a JSON round trip, which is what persistence does to a payload', () => {
    const slot: InvSlot = {
      itemId: 'girdle',
      count: 1,
      instance: { enchantId: 'power', rolled: { stats: { str: 3 } } } as never,
    };
    const roundTripped = JSON.parse(JSON.stringify(slot)) as InvSlot;
    expect(itemCopyPin(roundTripped)).toBe(itemCopyPin(slot));
  });

  it('pins nothing for no slot', () => {
    expect(itemCopyPin(undefined)).toBe('');
  });
});

describe('consumeSelectedInventorySlot: the tri-state', () => {
  it('takes exactly the named slot, not the newest match', () => {
    // The reported bug, inverted into an assertion. The enchanted copy sits at
    // index 0 and a plain copy was looted after it, so every legacy picker in
    // the tree would take index 1.
    const inv = [enchanted('girdle', 'power'), plain('girdle')];
    const unit = consumeSelectedInventorySlot(inv, 'girdle', 0);
    expect(unit).not.toBeNull();
    expect(unit?.instance).toEqual({ enchantId: 'power' });
    // and the plain copy is untouched
    expect(inv).toHaveLength(1);
    expect(inv[0].instance).toBeUndefined();
  });

  it('returns undefined (fall back) when no selection is given', () => {
    const inv = [plain('girdle')];
    expect(consumeSelectedInventorySlot(inv, 'girdle', undefined)).toBeUndefined();
    expect(inv, 'a no-selection call must not consume anything itself').toHaveLength(1);
  });

  it.each([
    ['out of range', 5],
    ['negative', -1],
    ['not an integer', 1.5],
  ])('returns null (refuse) for an index that is %s', (_label, index) => {
    const inv = [plain('girdle')];
    expect(consumeSelectedInventorySlot(inv, 'girdle', index as number)).toBeNull();
    expect(inv, 'a refused selection consumes nothing').toHaveLength(1);
  });

  it('refuses when the named slot holds a DIFFERENT item', () => {
    // The stale-frame case: the client named index 0, but the bag moved and
    // something else lives there now. Refusing is the point; guessing here is
    // how you destroy the wrong item.
    const inv = [plain('boots'), plain('girdle')];
    expect(consumeSelectedInventorySlot(inv, 'girdle', 0)).toBeNull();
    expect(inv).toHaveLength(2);
  });

  it('decrements a stack rather than removing it when more than one remains', () => {
    const inv = [plain('potion', 3)];
    const unit = consumeSelectedInventorySlot(inv, 'potion', 0);
    expect(unit).not.toBeNull();
    expect(inv[0].count).toBe(2);
  });

  it('clones the payload when the stack survives, so the consumed unit is not aliased', () => {
    // Aliasing here would let a later mutation of the bag stack reach through
    // into the already-consumed unit (the cloneItemInstancePayload contract).
    const inv = [enchanted('scroll', 'power', 2)];
    const unit = consumeSelectedInventorySlot(inv, 'scroll', 0);
    expect(unit?.instance).toEqual({ enchantId: 'power' });
    expect(unit?.instance).not.toBe(inv[0].instance);
  });
});

describe('consumeNewestInventoryUnit: the legacy fallback, unchanged', () => {
  it('takes the HIGHEST index match, which is the historical behavior', () => {
    // Pinned deliberately, not aspirationally. Callers no UI can fix reach this
    // (server/pbe_boost.ts auto-gears by bare id) and the parity goldens drive
    // equip / discard / sell / use through it, so "improving" it forks the world.
    const inv = [enchanted('girdle', 'power'), plain('girdle')];
    const unit = consumeNewestInventoryUnit(inv, 'girdle');
    expect(unit.instance, 'the newest copy is the plain one here').toBeUndefined();
    expect(inv).toHaveLength(1);
    expect(inv[0].instance).toEqual({ enchantId: 'power' });
  });

  it('returns an empty unit when nothing matches, rather than throwing', () => {
    const inv = [plain('boots')];
    expect(consumeNewestInventoryUnit(inv, 'girdle')).toEqual({
      instance: undefined,
      craftedRecipeId: undefined,
    });
    expect(inv).toHaveLength(1);
  });
});

describe('selectedInventorySlot: resolve without consuming', () => {
  it('returns the named slot and leaves the bag untouched', () => {
    // The mutating callers (the rift forge) improve the slot in place, so a
    // resolver that consumed would destroy the item it was asked to upgrade.
    const inv = [enchanted('girdle', 'power'), plain('girdle')];
    const slot = selectedInventorySlot(inv, 'girdle', 0);
    expect(slot?.instance).toEqual({ enchantId: 'power' });
    expect(inv, 'nothing consumed').toHaveLength(2);
    expect(inv[0].count).toBe(1);
  });

  it('returns the live slot object, so a caller mutating it edits the bag', () => {
    const inv = [enchanted('girdle', 'power')];
    const slot = selectedInventorySlot(inv, 'girdle', 0);
    expect(slot).toBe(inv[0]);
  });

  it.each([
    ['out of range', 9],
    ['negative', -1],
    ['not an integer', 0.5],
  ])('refuses an index that is %s', (_label, index) => {
    expect(selectedInventorySlot([plain('girdle')], 'girdle', index as number)).toBeNull();
  });

  it('refuses when the named slot holds a different item', () => {
    expect(selectedInventorySlot([plain('boots')], 'girdle', 0)).toBeNull();
  });

  it('returns undefined for no selection, so the caller falls back', () => {
    expect(selectedInventorySlot([plain('girdle')], 'girdle', undefined)).toBeUndefined();
  });
});
