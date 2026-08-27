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

import type { EquipSlot, ItemDef, ItemInstancePayload } from '../sim/types';
import { wornTooltipInstance } from './item_instance_tooltip';

/** One paperdoll cell: a slot, the item equipped there (null when empty), and
 *  the worn copy's per-copy payload (null when absent or when the caller has
 *  none, e.g. inspect). The payload rides the cell so the row's name and
 *  quality color can describe the COPY (a promoted legendary), the same
 *  instance-effective rule the tooltip reads. PROJECTED through
 *  wornTooltipInstance (signer/enchant/rolled/name, the eqi worn-identity
 *  trim), so the one worn-copy handle the view hands out carries only the
 *  cosmetic projection: a future reader of a non-cosmetic field (bindOnTrade,
 *  boundTo) cannot reintroduce the offline-vs-online host divergence the trim
 *  exists to prevent. */
export interface PaperdollSlot {
  slot: EquipSlot;
  item: ItemDef | null;
  instance: ItemInstancePayload | null;
}

/** The two equipment columns that flank the character model. */
export interface PaperdollView {
  left: PaperdollSlot[];
  right: PaperdollSlot[];
}

// Two balanced 6/6 columns flanking the model, like the classic character sheet:
// the left column holds head/neck/shoulder/chest plus both weapon hands (mainhand
// then offhand); the right column holds the hands/waist/legs/feet quartet with the
// two ring slots at the bottom. The 6/6 split (offhand under mainhand rather than
// at the tail of the right column) keeps the two bands even on either side of the
// fixed-width model stage; the inspect window inherits it via buildPaperdollView.
export const PAPERDOLL_LEFT_SLOTS: readonly EquipSlot[] = [
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'mainhand',
  'offhand',
];
export const PAPERDOLL_RIGHT_SLOTS: readonly EquipSlot[] = [
  'gloves',
  'waist',
  'legs',
  'feet',
  'ring1',
  'ring2',
];

/**
 * Build the paperdoll view from the player's equipment and the item table. A
 * slot resolves to its item only when the id is present AND the item still
 * exists in the table; otherwise the cell is empty. `instances` is the worn
 * per-copy payloads (IWorld equipmentInstances); a caller without them (the
 * inspect card) omits it and every cell reads def-only, byte for byte the old
 * behavior.
 */
export function buildPaperdollView(
  equipment: Partial<Record<EquipSlot, string>>,
  items: Record<string, ItemDef>,
  instances?: Partial<Record<EquipSlot, ItemInstancePayload>>,
): PaperdollView {
  const column = (slots: readonly EquipSlot[]): PaperdollSlot[] =>
    slots.map((slot) => {
      const itemId = equipment[slot];
      const item = itemId ? (items[itemId] ?? null) : null;
      // The worn-identity projection (see PaperdollSlot): the cell never
      // carries more of the payload than the eqi wire would show a peer.
      const instance = item ? wornTooltipInstance(instances?.[slot]) : undefined;
      return { slot, item, instance: instance ?? null };
    });
  return { left: column(PAPERDOLL_LEFT_SLOTS), right: column(PAPERDOLL_RIGHT_SLOTS) };
}
