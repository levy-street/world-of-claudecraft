// Pure, host-agnostic view model for the character window's PAPERDOLL.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference vendor_view.ts). Scope is deliberately narrow: the
// deterministic paperdoll data ONLY, i.e. which equipment slot crowns the model,
// which slots flank it in each column, and what item (if any) fills each. Everything else the char
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

/** The top-center helmet plus two balanced equipment columns flanking the model. */
export interface PaperdollView {
  top: PaperdollSlot;
  left: PaperdollSlot[];
  right: PaperdollSlot[];
}

// The helmet owns the paperdoll's top-center crown. The remaining ten real
// slots form two balanced five-cell rails, with one ring at the bottom of each
// side. Bags are inventory containers and are deliberately absent here; the
// Bags panel is their single management surface. No off hand or trinket exists
// in the sim, so neither is invented for visual symmetry.
export const PAPERDOLL_TOP_SLOT: EquipSlot = 'helmet';
export const PAPERDOLL_LEFT_SLOTS: readonly EquipSlot[] = [
  'neck',
  'shoulder',
  'chest',
  'gloves',
  'ring1',
];
export const PAPERDOLL_RIGHT_SLOTS: readonly EquipSlot[] = [
  'mainhand',
  'waist',
  'legs',
  'feet',
  'ring2',
];

/**
 * Build the paperdoll view from the player's equipment and item table. A slot
 * resolves to its item only when the id is present AND the item still exists in
 * the table; otherwise the cell is empty.
 */
export function buildPaperdollView(
  equipment: Partial<Record<EquipSlot, string>>,
  items: Record<string, ItemDef>,
): PaperdollView {
  const resolve = (slot: EquipSlot): PaperdollSlot => {
    const itemId = equipment[slot];
    const item = itemId ? (items[itemId] ?? null) : null;
    return { slot, item };
  };
  const column = (slots: readonly EquipSlot[]): PaperdollSlot[] => slots.map(resolve);
  return {
    top: resolve(PAPERDOLL_TOP_SLOT),
    left: column(PAPERDOLL_LEFT_SLOTS),
    right: column(PAPERDOLL_RIGHT_SLOTS),
  };
}
