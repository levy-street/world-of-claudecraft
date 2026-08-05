// Pure gear-upgrade picking (phase 14): which bagged items are strictly
// better than what is equipped, per slot. No IO, no clock; the item defs and
// the equipment mirror come in as arguments and the caller issues the equips.
//
// Rules: an empty slot takes anything equippable; an occupied slot swaps only
// on a strictly higher itemScore (src/sim/item_level.ts). Level and class
// gates use the same derivation the server equip path enforces
// (requiredLevelFor, def.requiredClass). Rings declare the slot KIND 'ring'
// and land in the weaker of ring1/ring2. Bags never appear here (they carry
// no slot and ride the bag-socket path), and neither do mount reins.

import { itemScore } from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import type { Entity, EquipSlot, InvSlot, ItemDef } from '../src/sim/types';

export interface GearUpgrade {
  itemId: string;
  slot: EquipSlot;
}

export function findUpgrades(
  inventory: readonly InvSlot[],
  equipment: Partial<Record<EquipSlot, string>>,
  itemDef: (itemId: string) => ItemDef | undefined,
  player: Entity,
): GearUpgrade[] {
  const scoreOf = (itemId: string | undefined): number => {
    if (itemId === undefined) return -1; // an empty slot takes anything
    const def = itemDef(itemId);
    return def ? itemScore(def) : -1;
  };
  // Assignments chosen this pass, so two new rings do not both aim at the
  // same slot and two upgrades for one slot keep only the better.
  const planned = new Map<EquipSlot, GearUpgrade & { score: number }>();
  const occupantScore = (slot: EquipSlot): number =>
    planned.get(slot)?.score ?? scoreOf(equipment[slot]);

  for (const inv of inventory) {
    const def = itemDef(inv.itemId);
    if (!def?.slot || def.kind === 'bag' || def.kind === 'mount') continue;
    // The player entity carries its class in templateId ("or class for player").
    if (def.requiredClass && !(def.requiredClass as readonly string[]).includes(player.templateId))
      continue;
    if (player.level < requiredLevelFor(def)) continue;
    const score = itemScore(def);

    if (def.slot === 'ring') {
      // Dual slot: land in the weaker of ring1/ring2.
      const weaker: EquipSlot =
        occupantScore('ring1') <= occupantScore('ring2') ? 'ring1' : 'ring2';
      if (score > occupantScore(weaker)) {
        planned.set(weaker, { itemId: inv.itemId, slot: weaker, score });
      }
      continue;
    }
    const slot = def.slot;
    if (score > occupantScore(slot)) {
      planned.set(slot, { itemId: inv.itemId, slot, score });
    }
  }
  return [...planned.values()].map(({ itemId, slot }) => ({ itemId, slot }));
}
