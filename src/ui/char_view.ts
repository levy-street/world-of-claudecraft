// Pure, host-agnostic view model for the character window's PAPERDOLL.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference vendor_view.ts). Scope is deliberately narrow: the
// deterministic paperdoll data ONLY, i.e. which equipment slots flank the model
// in which column and what item (if any) fills each. Everything else the char
// window draws stays on the painter: the shared Three.js turntable preview (it
// emits no Three types into this core), the cosmetic skin picker, the stat panel
// (already its own stat_tooltip_view core), and the talent / progression blocks.
//
// DOM-free, Three-free, i18n-free, and free of any RNG or wall-clock call, so it
// stays deterministic and tests/char_view.test.ts can drive it directly with both
// a Sim-shaped and a ClientWorld-mirror-shaped equipment record.
// The skin-event preview randomness lives in the painter / the separate skin-event
// overlay, never here.

import type { EquipSlot, ItemDef } from '../sim/types';

/** One paperdoll cell: a slot and the item equipped there (null when empty). */
export interface PaperdollSlot {
  slot: EquipSlot;
  item: ItemDef | null;
}

/** The two equipment columns that flank the character model. */
export interface PaperdollView {
  left: PaperdollSlot[];
  right: PaperdollSlot[];
}

// Two columns flanking the model, like the classic character sheet: the left
// column holds head/neck/shoulder/chest plus the weapon; the right column holds
// the hands/waist/legs/feet quartet with the two ring slots at the bottom.
export const PAPERDOLL_LEFT_SLOTS: readonly EquipSlot[] = [
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'mainhand',
];
export const PAPERDOLL_RIGHT_SLOTS: readonly EquipSlot[] = [
  'gloves',
  'waist',
  'legs',
  'feet',
  'ring1',
  'ring2',
  'offhand',
];

/**
 * Build the paperdoll view from the player's equipment and the item table. A
 * slot resolves to its item only when the id is present AND the item still
 * exists in the table; otherwise the cell is empty.
 */
export function buildPaperdollView(
  equipment: Partial<Record<EquipSlot, string>>,
  items: Record<string, ItemDef>,
): PaperdollView {
  const column = (slots: readonly EquipSlot[]): PaperdollSlot[] =>
    slots.map((slot) => {
      const itemId = equipment[slot];
      const item = itemId ? (items[itemId] ?? null) : null;
      return { slot, item };
    });
  return { left: column(PAPERDOLL_LEFT_SLOTS), right: column(PAPERDOLL_RIGHT_SLOTS) };
}
