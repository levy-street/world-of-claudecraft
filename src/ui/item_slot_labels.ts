// The equip-slot label table and its resolver, plus the SHARED-LABEL groups
// derived from it.
//
// Extracted from the hud.ts coordinator, which held the only copy: the table is
// data, it needs none of the HUD's private mutable state, and a pure view core
// that has to know WHICH equipment keys share one player-facing label had no way
// to ask (#2466). Moved verbatim; hud.ts imports the resolver back.
//
// 'ring1' and 'ring2' deliberately resolve to ONE label ("Finger"): items
// declare the slot KIND 'ring' and the paperdoll cells are the concrete keys,
// classic behavior. That is correct for a tooltip naming one piece and wrong for
// any list that shows BOTH fingers at once, where two rows naming their copy by
// slot alone read byte-identical. sharedSlotLabelIndex gives such a key its
// 1-based position inside its label group so that list can tell them apart;
// a key whose label is its own gets undefined and nothing is numbered.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ALL_EQUIP_SLOTS, type EquipSlot, type ItemSlot } from '../sim/types';
import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';

export const ITEM_SLOT_LABEL_KEYS: Record<ItemSlot, TranslationKey> = {
  mainhand: 'itemUi.slots.mainhand',
  offhand: 'itemUi.slots.offhand',
  helmet: 'itemUi.slots.helmet',
  neck: 'itemUi.slots.neck',
  shoulder: 'itemUi.slots.shoulder',
  chest: 'itemUi.slots.chest',
  waist: 'itemUi.slots.waist',
  legs: 'itemUi.slots.legs',
  gloves: 'itemUi.slots.gloves',
  feet: 'itemUi.slots.feet',
  // The three ring forms share one player-facing label ("Finger"): items
  // declare 'ring', the paperdoll cells are the concrete ring1/ring2 keys.
  ring: 'itemUi.slots.ring',
  ring1: 'itemUi.slots.ring',
  ring2: 'itemUi.slots.ring',
};

/** The localized label for one item or equipment slot. */
export function itemSlotLabel(slot: ItemSlot): string {
  return t(ITEM_SLOT_LABEL_KEYS[slot]);
}

/** 1-based position of each EQUIPMENT key inside the group of equipment keys
 *  that share its label, for the groups that hold more than one key. Derived
 *  from ITEM_SLOT_LABEL_KEYS over ALL_EQUIP_SLOTS rather than written out again,
 *  so giving ring1/ring2 labels of their own retires the numbering by itself and
 *  a future shared pair (a second trinket, a second offhand) is covered the day
 *  it lands.
 *
 *  Keyed on the label KEY, never on the resolved string: two keys resolve
 *  identically in every locale exactly when they ARE the same key, so this stays
 *  a locale-independent fact about the table and the cores that read it need no
 *  translator. Swept over ALL_EQUIP_SLOTS, not over the table's own keys, so the
 *  item-side 'ring' kind (never a worn position) is not counted as a third
 *  finger.
 *
 *  ALL_EQUIP_SLOTS order is also what makes the number READABLE: the character
 *  sheet paints ring1 above ring2 (char_view PAPERDOLL_RIGHT_SLOTS), so "Finger 1"
 *  is the upper ring cell. The two lists agreeing is a fact, not a coincidence to
 *  rely on quietly, so tests/item_slot_labels.test.ts pins it: a paperdoll reorder
 *  would otherwise leave the tag pointing at the wrong cell. */
function sharedSlotLabelIndices(): Partial<Record<EquipSlot, number>> {
  const byKey = new Map<TranslationKey, EquipSlot[]>();
  for (const slot of ALL_EQUIP_SLOTS) {
    const key = ITEM_SLOT_LABEL_KEYS[slot];
    const group = byKey.get(key);
    if (group) group.push(slot);
    else byKey.set(key, [slot]);
  }
  const indices: Partial<Record<EquipSlot, number>> = {};
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const [index, slot] of group.entries()) indices[slot] = index + 1;
  }
  return indices;
}

const SHARED_SLOT_LABEL_INDICES = sharedSlotLabelIndices();

/** The 1-based position of `slot` inside its shared-label group, or undefined
 *  when its label names it alone (the ordinary case: nothing is numbered). */
export function sharedSlotLabelIndex(slot: EquipSlot): number | undefined {
  return SHARED_SLOT_LABEL_INDICES[slot];
}
