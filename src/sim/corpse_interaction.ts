import {
  bodyPoolSharedWithParty,
  corpseHarvestClaimOpen,
  corpseHasOrdinaryLootFor,
  corpseSharedLootRightsFor,
} from './corpse_loot_state';
import { corpseHasDecayed } from './respawn_policy';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export interface CorpseInteractionAvailability {
  harvestable: boolean;
  hasLootRights: boolean;
  hasLoot: boolean;
  canInteract: boolean;
}

export function corpseCanInteract(mob: Entity): boolean {
  return (
    mob.kind === 'mob' &&
    mob.ownerId == null &&
    mob.dead &&
    !corpseHasDecayed(mob.dead, mob.corpseTimer)
  );
}

// The sim-side availability: the rules live in corpse_loot_state.ts (shared
// with the client indicators and popup), this adapter supplies what only the
// sim knows, the TAPPER's real party through ctx.partyOf.
export function corpseInteractionAvailability(
  ctx: SimContext,
  mob: Entity,
  entityId: number,
  honorFfa: boolean,
): CorpseInteractionAvailability {
  // A World PvP body holding spoils (pvp/world_pvp_spoils.ts) opens like a corpse
  // for its loot; corpseCanInteract itself stays the mob-only harvest gate.
  const playerBody =
    mob.kind === 'player' && mob.dead && !corpseHasDecayed(mob.dead, mob.corpseTimer);
  if (!corpseCanInteract(mob) && !playerBody) {
    return { harvestable: false, hasLootRights: false, hasLoot: false, canInteract: false };
  }

  const harvestable = corpseHarvestClaimOpen(mob.templateId, mob.harvestClaimedBy);
  const tapperParty =
    mob.tappedById !== null && bodyPoolSharedWithParty(mob) ? ctx.partyOf(mob.tappedById) : null;
  const shared = corpseSharedLootRightsFor(
    entityId,
    mob.tappedById,
    tapperParty?.members ?? null,
    mob.lootFfaTimer,
    honorFfa,
  );
  const personal = mob.loot?.items.some((s) => s.personalFor?.includes(entityId)) ?? false;
  const open = mob.loot?.items.some((s) => s.openToAll && s.count > 0) ?? false;
  const hasLootRights = mob.lootable && (shared || personal || open);
  const hasLoot = mob.lootable && corpseHasOrdinaryLootFor(mob.loot, entityId, shared);
  return { harvestable, hasLootRights, hasLoot, canInteract: harvestable || hasLootRights };
}
