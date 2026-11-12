// The character level an item's own use is gated behind, for the item tooltip's
// "Requires Level N" line. One answer per item, read from the gates the sim
// actually enforces, so the tooltip never quotes a level the server would not
// check (or hides one it would):
//
// - Wearable gear (weapon, armor, held off-hand): the equip gate in items.ts
//   equipItem, `requiredLevelFor` (item_level_req.ts). The held off-hand kind is
//   equip-gated exactly like weapons and armor.
// - Mount reins and the Riding Training service entry: riding itself is learned
//   at MOUNT_TRAIN_MIN_LEVEL (riding_level.ts; learnRiding enforces it), every mount needs
//   the riding skill to summon (mounts.ts summonMountItem), and the vendor
//   purchase gate for reins (items.ts buyItem) is the same level.
// - Everything else (consumables, materials, patterns, tools, bags) has no level
//   gate on use: patterns gate on profession skill, tools on wield skill. The
//   derived requiredLevelFor value of a rare material is a tier number the
//   salvage and enchant math reads, never a gate, so it is not quoted here.
//
// Pure leaf: no DOM/Three/render-ui-game-net imports, no rng/clock.

import { requiredLevelFor } from './item_level_req';
import { MOUNT_TRAIN_MIN_LEVEL } from './riding_level';
import type { ItemDef } from './types';

/** Whether `item` is wearable gear the equip path level-gates. Mirrors the kind
 *  filter at the top of items.ts equipItem. */
export function isLevelGatedEquipment(item: ItemDef): boolean {
  return (
    !!item.slot && (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'held_offhand')
  );
}

/** The level `item` requires before it can be worn or used, or 1 for no gate. */
export function itemUseRequiredLevel(item: ItemDef): number {
  if (isLevelGatedEquipment(item)) return requiredLevelFor(item);
  if (item.kind === 'mount' || item.teachesRiding) return MOUNT_TRAIN_MIN_LEVEL;
  return 1;
}
