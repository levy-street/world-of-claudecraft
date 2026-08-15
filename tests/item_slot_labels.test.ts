// The equip-slot label table extracted out of hud.ts, and the SHARED-LABEL
// numbering derived from it (#2466).
//
// The load-bearing fact is a collision in the label table itself: ring1 and
// ring2 name ONE label ("Finger") on purpose, so any surface that lists both
// fingers at once cannot name them by slot alone. sharedSlotLabelIndex is what
// such a surface asks; these pins hold both halves, the collision premise and
// the numbering that answers it, because either one alone can pass while the
// pair is useless.

import { describe, expect, it } from 'vitest';
import { ALL_EQUIP_SLOTS, type EquipSlot, type ItemSlot } from '../src/sim/types';
import { PAPERDOLL_LEFT_SLOTS, PAPERDOLL_RIGHT_SLOTS } from '../src/ui/char_view';
import {
  ITEM_SLOT_LABEL_KEYS,
  itemSlotLabel,
  sharedSlotLabelIndex,
} from '../src/ui/item_slot_labels';

describe('item_slot_labels: the label table', () => {
  it('resolves every item and equipment slot to a non-empty label', () => {
    // Every ItemSlot, not only the equipment keys: item defs declare the 'ring'
    // KIND, and a tooltip naming a bagged ring reads that row.
    const slots = Object.keys(ITEM_SLOT_LABEL_KEYS) as ItemSlot[];
    expect(slots).toContain('ring');
    for (const slot of ALL_EQUIP_SLOTS) expect(slots).toContain(slot);
    for (const slot of slots) {
      expect(ITEM_SLOT_LABEL_KEYS[slot], `key for ${slot}`).toMatch(/^itemUi\.slots\./);
      expect(itemSlotLabel(slot).length, `label for ${slot}`).toBeGreaterThan(0);
    }
  });

  it('gives the three ring forms ONE label and the two hands their own', () => {
    // The collision this whole module exists for, asserted on the RESOLVED
    // labels rather than only on the keys: a reader of a picker row sees the
    // strings, and "same key" is only interesting because it forces "same
    // string" in every locale.
    expect(itemSlotLabel('ring1')).toBe(itemSlotLabel('ring2'));
    expect(itemSlotLabel('ring')).toBe(itemSlotLabel('ring1'));
    // The pair that does NOT collide, so the numbering below is proven to be
    // selective rather than blanket: a dual-wielded copy is already told apart
    // by its slot label alone.
    expect(itemSlotLabel('mainhand')).not.toBe(itemSlotLabel('offhand'));
  });
});

describe('item_slot_labels: sharedSlotLabelIndex', () => {
  it('numbers exactly the equipment keys that share a label, in paperdoll order', () => {
    // The concrete expected mapping, as literals: recomputing it from the same
    // table the function reads would only assert the function equals itself.
    const numbered = Object.fromEntries(
      ALL_EQUIP_SLOTS.map((slot) => [slot, sharedSlotLabelIndex(slot)]).filter(
        ([, index]) => index !== undefined,
      ),
    );
    expect(numbered).toEqual({ ring1: 1, ring2: 2 });
    // Stated the other way round too, so a change that numbers everything
    // (or nothing) cannot slip past the shape above.
    expect(sharedSlotLabelIndex('ring1')).toBe(1);
    expect(sharedSlotLabelIndex('ring2')).toBe(2);
    for (const slot of ['mainhand', 'offhand', 'chest', 'legs', 'neck'] as EquipSlot[]) {
      expect(sharedSlotLabelIndex(slot), `${slot} names its own slot`).toBeUndefined();
    }
  });

  it('numbers the fingers in the order the PAPERDOLL paints them', () => {
    // An ordinal is only readable if it points at something the player can see.
    // The character sheet paints ring1 above ring2 in its right column, so
    // "Finger 1" is the upper ring cell; the numbering comes from
    // ALL_EQUIP_SLOTS, a different list, so the two agreeing is a fact worth
    // holding rather than assuming. A paperdoll reorder that put ring2 first
    // would leave the tag pointing at the wrong cell with nothing else failing.
    const fingers = PAPERDOLL_RIGHT_SLOTS.filter(
      (slot) => sharedSlotLabelIndex(slot) !== undefined,
    );
    expect(fingers).toEqual(['ring1', 'ring2']);
    expect(fingers.map((slot) => sharedSlotLabelIndex(slot))).toEqual([1, 2]);
    // Neither column numbers anything else, so no other cell gains an ordinal
    // the paperdoll cannot account for.
    for (const slot of [...PAPERDOLL_LEFT_SLOTS, ...PAPERDOLL_RIGHT_SLOTS]) {
      if (slot === 'ring1' || slot === 'ring2') continue;
      expect(sharedSlotLabelIndex(slot), `${slot} is unnumbered`).toBeUndefined();
    }
  });

  it('counts fingers, never the item-side ring KIND, so ring2 stays the second', () => {
    // ITEM_SLOT_LABEL_KEYS carries three rows on the ring label and only two of
    // them are worn positions. Sweeping the table's own keys instead of
    // ALL_EQUIP_SLOTS would make 'ring' a member of the group and could push
    // ring2 to a third finger; the count is what catches that.
    const ringKey = ITEM_SLOT_LABEL_KEYS.ring;
    const tableRows = (Object.keys(ITEM_SLOT_LABEL_KEYS) as ItemSlot[]).filter(
      (slot) => ITEM_SLOT_LABEL_KEYS[slot] === ringKey,
    );
    expect(tableRows.sort()).toEqual(['ring', 'ring1', 'ring2']);
    const wornRows = ALL_EQUIP_SLOTS.filter((slot) => ITEM_SLOT_LABEL_KEYS[slot] === ringKey);
    expect(wornRows).toEqual(['ring1', 'ring2']);
    expect(Math.max(...wornRows.map((slot) => sharedSlotLabelIndex(slot) ?? 0))).toBe(2);
  });
});
