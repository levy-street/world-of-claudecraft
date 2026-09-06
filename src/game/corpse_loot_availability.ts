import {
  corpseHarvestClaimOpen,
  corpseHasOrdinaryLootFor,
  corpseSharedLootRightsFor,
  tapperPartyFromViewerParty,
} from '../sim/corpse_loot_state';
import { MOBS } from '../sim/data';
import { corpseHasDecayed } from '../sim/respawn_policy';
import type { Entity } from '../sim/types';

/** Resolve the exact corpse content the local player can open in the loot popup.
 *
 *  Note on the harvest arm's data source, because it is the one thing here that
 *  does NOT come off the wire: `isHarvestableCorpse` (behind
 *  corpseHarvestClaimOpen) answers from HARVEST_COMPONENT_ITEMS in the client's
 *  own bundle, reached through the entity's `tid`. So a client whose content
 *  predates a change disagrees with the server about which corpses are
 *  harvestable. Both directions are safe today: a client that over-offers gets
 *  the server's pre-claim refusal and burns nothing, and a client that
 *  under-offers merely hides a picker. The second direction is the one to
 *  watch if a family is ever wired server-side without a client deploy, since
 *  a hidden picker suppresses a harvest the server would honor. #2514 adds a
 *  third direction, milder than both: the same table now also decides which
 *  picker rows are marked "nothing yet" and what concentration bonus the sim
 *  pays, so a skewed client can mark a row dead that the server pays out, or
 *  show a bonus hint the server does not agree with. Nothing is burned and the
 *  sim stays authoritative; the player just sees a stale label.
 *
 *  Answers "may I OPEN this corpse", not "does it have contents": the rules are
 *  the shared corpse_loot_state.ts predicates that mirror the sim's
 *  authoritative corpseLootRights + lootCorpse loop (src/sim/interaction.ts),
 *  so a stranger's owner-locked kill no longer captures the interact press
 *  (and its denial toast) away from whatever sits under it. `canOpen` is the
 *  popup's question (either half); `hasLoot` is the generic press's (ordinary
 *  loot only), and the two stay independent on purpose.
 *  `harvestStateReliable` is true on every production path (no caller passes
 *  it: offline is sim-local truth, online
 *  mirrors harvestClaimedBy via the hcb wire key). The parameter is a
 *  deliberately retained seam for a transport that cannot mirror harvest
 *  claims; its false arm stays pinned in tests/corpse_loot_availability.test.ts
 *  and tests/interactions.test.ts (positional third argument), so do not
 *  remove it as dead plumbing without sweeping those pins.
 *  `partyMemberIds` is the LOCAL player's party roster (pids, self included;
 *  null when solo): party membership is symmetric, so it stands in for the
 *  tapper's party exactly when that grants anything (the tapper being in MY
 *  party). Offline entities carry the real tappedById / lootFfaTimer and the
 *  roster is the bot party; online both ride the wire (tap, ffa keys), so the
 *  same code serves both hosts unchanged. */
export function corpseLootAvailability(
  mob: Entity,
  playerId: number,
  harvestStateReliable = true,
  partyMemberIds: readonly number[] | null = null,
) {
  if (corpseHasDecayed(mob.dead, mob.corpseTimer)) {
    return {
      componentTags: MOBS[mob.templateId]?.componentTags,
      harvestable: false,
      visibleItems: [],
      visibleCopper: 0,
      hasLoot: false,
      canOpen: false,
    };
  }
  const componentTags = MOBS[mob.templateId]?.componentTags;
  const harvestable =
    mob.ownerId == null &&
    corpseHarvestClaimOpen(mob.templateId, mob.harvestClaimedBy, harvestStateReliable);
  const tappedById = mob.tappedById ?? null;
  const sharedRights = corpseSharedLootRightsFor(
    playerId,
    tappedById,
    tapperPartyFromViewerParty(tappedById, partyMemberIds),
    mob.lootFfaTimer,
    true,
  );
  // Exactly what THIS viewer could take, the three arms of the sim's lootCorpse
  // loop: personal slots naming me, open-to-all slots, and plain (tap-owned)
  // slots only with shared rights. The popup lists them; hasLoot is the same
  // rule answered by the shared predicate.
  const visibleItems = mob.loot
    ? mob.loot.items.filter((slot) =>
        slot.personalFor
          ? slot.count > 0 && slot.personalFor.includes(playerId)
          : slot.openToAll
            ? slot.count > 0
            : sharedRights && slot.count > 0,
      )
    : [];
  // Copper is part of the shared (tap-owned) pool: without shared rights the
  // popup must not advertise it.
  const visibleCopper = sharedRights && mob.loot ? mob.loot.copper : 0;
  const hasLoot = corpseHasOrdinaryLootFor(mob.loot, playerId, sharedRights);
  return {
    componentTags,
    harvestable,
    visibleItems,
    visibleCopper,
    hasLoot,
    canOpen: hasLoot || harvestable,
  };
}

/** The local party roster in the shape `corpseLootAvailability` consumes (pids,
 *  self included; null when solo). Structural parameter so both hosts' partyInfo
 *  (IWorldParty) satisfy it without a world_api import here. */
export function localPartyMemberIds(
  partyInfo: { members: readonly { pid: number }[] } | null | undefined,
): number[] | null {
  return partyInfo ? partyInfo.members.map((m) => m.pid) : null;
}

/** Supply the live viewer identity and party roster to the shared popup rule. */
export function corpseLootAvailabilityInWorld(
  world: {
    playerId: number;
    partyInfo: { members: readonly { pid: number }[] } | null;
  },
  mob: Entity,
) {
  return corpseLootAvailability(mob, world.playerId, true, localPartyMemberIds(world.partyInfo));
}
