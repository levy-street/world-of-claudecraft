// Pure, host-agnostic core for dragging an item from the bags onto a paperdoll
// slot (the character window's equip sockets) and for the drag-out-to-destroy
// gesture that replaced right-click-destroys.
//
// It answers the two questions the drag needs, DOM-free, so both the desktop
// HTML5 drag and the touch pointer drag share one rule set and the hover feedback
// can never disagree with what the sim will actually do: the sim's own equip path
// (src/sim/items.ts equipItem) re-validates every drop through the SAME leaves
// (slotAcceptsItem / canEquipItem / meetsLevelRequirement), so this core is
// feedback, never authority.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { canEquipItem, slotAcceptsItem } from '../sim/equipment_rules';
import { meetsLevelRequirement, requiredLevelFor } from '../sim/item_level_req';
import type { EquipSlot, ItemDef, PlayerClass } from '../sim/types';

/** What dropping a bag item on a paperdoll slot does. The blocked* variants are
 *  refusals the painter surfaces (a rejecting drop target + an error toast), and
 *  each names the ONE reason, checked in the sim's own order: wrong socket first
 *  (a helm on a ring finger), then class proficiency, then the level gate. */
export type PaperdollDropAction = 'equip' | 'blockedSlot' | 'blockedClass' | 'blockedLevel';

/** Decide what dropping `item` on the `slot` paperdoll socket does for a `cls`
 *  character of `level`. Mirrors src/sim/items.ts equipItem's guard order, so a
 *  drop this returns 'equip' for is one the sim accepts. */
export function paperdollDropAction(
  item: ItemDef,
  slot: EquipSlot,
  cls: PlayerClass,
  level: number,
): PaperdollDropAction {
  // Only real gear equips; a consumable or material declares no slot at all, and
  // a bag equips into its own bar socket, never the paperdoll.
  if (item.kind !== 'weapon' && item.kind !== 'armor' && item.kind !== 'held_offhand')
    return 'blockedSlot';
  if (!slotAcceptsItem(item, slot)) return 'blockedSlot';
  if (!canEquipItem(cls, item)) return 'blockedClass';
  if (!meetsLevelRequirement(level, item)) return 'blockedLevel';
  return 'equip';
}

/** The level a refused 'blockedLevel' drop names in its toast. Re-exported from
 *  the sim leaf so the painter never re-derives the gate. */
export function dropRequiredLevel(item: ItemDef): number {
  return requiredLevelFor(item);
}

/** Whether an item can be dragged onto the paperdoll at all: the tooltip's
 *  "drag onto your character to equip" hint and the drag payload gate on this,
 *  so a stack of cloth never advertises an equip it cannot do. Slot legality per
 *  socket is still paperdollDropAction's call. */
export function isPaperdollDraggable(item: ItemDef): boolean {
  return (
    (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'held_offhand') && !!item.slot
  );
}
