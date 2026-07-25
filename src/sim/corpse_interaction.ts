import { MOBS } from './data';
import { hasSharedLootRights as computeSharedLootRights, lootHasGoneFfa } from './loot/loot_ffa';
import { isHarvestableCorpse } from './professions/gathering';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export interface CorpseInteractionAvailability {
  harvestable: boolean;
  hasLootRights: boolean;
  canInteract: boolean;
}

export function corpseInteractionAvailability(
  ctx: SimContext,
  mob: Entity,
  entityId: number,
  honorFfa: boolean,
): CorpseInteractionAvailability {
  if (mob.kind !== 'mob' || !mob.dead || !mob.lootable) {
    return { harvestable: false, hasLootRights: false, canInteract: false };
  }

  const harvestable =
    isHarvestableCorpse(MOBS[mob.templateId]?.componentTags) && mob.harvestClaimedBy === null;
  const tapperParty = mob.tappedById !== null ? ctx.partyOf(mob.tappedById) : null;
  const shared = computeSharedLootRights(
    entityId,
    mob.tappedById,
    tapperParty?.members ?? null,
    honorFfa && lootHasGoneFfa(mob.lootFfaTimer),
  );
  const personal = mob.loot?.items.some((s) => s.personalFor?.includes(entityId)) ?? false;
  const open = mob.loot?.items.some((s) => s.openToAll && s.count > 0) ?? false;
  const hasLootRights = shared || personal || open;
  return { harvestable, hasLootRights, canInteract: harvestable || hasLootRights };
}
