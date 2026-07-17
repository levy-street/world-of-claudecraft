import { MOBS } from '../sim/data';
import type { Entity } from '../sim/types';

/** Resolve the exact corpse content the local player can open in the loot popup. */
export function corpseLootAvailability(mob: Entity, playerId: number, harvestStateReliable = true) {
  const componentTags = MOBS[mob.templateId]?.componentTags;
  const harvestable =
    harvestStateReliable && !!componentTags?.length && mob.harvestClaimedBy === null;
  const visibleItems = mob.loot
    ? mob.loot.items.filter((slot) => !slot.personalFor || slot.personalFor.includes(playerId))
    : [];
  const hasLoot = !!mob.loot && (mob.loot.copper > 0 || visibleItems.length > 0);
  return {
    componentTags,
    harvestable,
    visibleItems,
    hasLoot,
    canOpen: hasLoot || harvestable,
  };
}
