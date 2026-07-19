import { MOBS } from '../sim/data';
import type { Entity } from '../sim/types';

/** Resolve the exact corpse content the local player can open in the loot popup.
 *  `harvestStateReliable` is true on every production path since the Phase 4
 *  open-gate flip (no caller passes it: offline is sim-local truth, online
 *  mirrors harvestClaimedBy via the hcb wire key). The parameter is a
 *  deliberately retained seam for a transport that cannot mirror harvest
 *  claims; its false arm stays pinned in tests/corpse_loot_availability.test.ts
 *  and tests/interactions.test.ts (positional third argument), so do not
 *  remove it as dead plumbing without sweeping those pins. */
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
