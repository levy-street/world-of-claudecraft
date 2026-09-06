// Pure corpse-state predicates: what a dead mob still offers ONE viewer, split
// into the two halves intentional gathering keeps apart. Ordinary loot is what
// the generic press and the popup's Take Loot collect; the harvest half is the
// explicit action. Every indicator (the overhead satchel or blade, the minimap
// loot square or pelt triangle) and both availability adapters
// (corpse_interaction.ts for the sim's command gate, the client's
// corpse_loot_availability.ts for the popup) answer through these, so the
// sparkle can never say "loot" on a body whose only remaining half is a
// harvest, and a rights-less stranger's kill never advertises a pool this
// viewer cannot take.
//
// Pure leaf (the threat.ts / loot_ffa.ts shape): entity plus primitives in,
// booleans out. No SimContext, no rng, no clock, and no per-call allocation, so
// a per-plate render pass and the 10 Hz minimap can call it freely. Party
// rosters are explicit about WHOSE they are: `hasSharedLootRights` wants the
// TAPPER's party, which only the sim can look up. A client knows only the
// VIEWER's party; membership is symmetric, so the viewer roster stands in for
// the tapper's exactly when the tapper is on it (tapperPartyFromViewerParty),
// and is never handed over otherwise, or a stranger party would grant rights
// its members do not have.

import { MOBS } from './data';
import { hasSharedLootRights, lootHasGoneFfa } from './loot/loot_ffa';
import { isHarvestableCorpse } from './professions/gathering';
import { corpseHasDecayed } from './respawn_policy';
import type { CorpseLoot, Entity } from './types';

/** What the corpse indicator shows this viewer: ordinary loot they may take,
 *  else an open harvest, else nothing. Ordinary loot always wins the glyph. */
export type CorpseIndicator = 'loot' | 'harvest' | 'none';

/** The viewer's own party roster re-read as the tapper's: the same roster when
 *  the tapper is on it, null otherwise. Returns the SAME array (no copy). */
export function tapperPartyFromViewerParty(
  tappedById: number | null,
  viewerPartyIds: readonly number[] | null,
): readonly number[] | null {
  if (tappedById === null || !viewerPartyIds) return null;
  return viewerPartyIds.includes(tappedById) ? viewerPartyIds : null;
}

/** May this viewer take the corpse's SHARED (tap-owned) pool: copper and plain
 *  slots. `tapperPartyIds` is the TAPPER's roster (or the viewer's, via
 *  tapperPartyFromViewerParty). A missing FFA timer (an online mirror that has
 *  not sent it) reads as still owner-locked, never as lapsed. `honorFfa` false
 *  is the walk-by pass, which never takes a stranger's aged-out corpse. */
export function corpseSharedLootRightsFor(
  viewerId: number,
  tappedById: number | null,
  tapperPartyIds: readonly number[] | null,
  lootFfaTimer: number | undefined,
  honorFfa: boolean,
): boolean {
  return hasSharedLootRights(
    viewerId,
    tappedById,
    tapperPartyIds,
    honorFfa && lootHasGoneFfa(lootFfaTimer ?? Number.POSITIVE_INFINITY),
  );
}

/** Does the loot table hold anything THIS viewer could take right now: copper
 *  or a plain slot with shared rights, a personal slot naming them, or an
 *  open-to-all slot; an emptied slot (count 0) never counts. Mirrors the three
 *  arms of the sim's lootCorpse loop (interaction.ts). */
export function corpseHasOrdinaryLootFor(
  loot: CorpseLoot | null,
  viewerId: number,
  sharedRights: boolean,
): boolean {
  if (!loot) return false;
  if (sharedRights && loot.copper > 0) return true;
  for (const slot of loot.items) {
    if (slot.count <= 0) continue;
    if (slot.personalFor) {
      if (slot.personalFor.includes(viewerId)) return true;
    } else if (slot.openToAll || sharedRights) {
      return true;
    }
  }
  return false;
}

/** Is the corpse's single harvest claim still open: a template with a mapped
 *  component family (isHarvestableCorpse, the sim's own predicate) and no
 *  claim yet. A claim means CONSUMED for everyone, the claimer included.
 *  `harvestStateReliable` false is the legacy seam for a transport that cannot
 *  mirror claims: it reads as closed rather than guessing. */
export function corpseHarvestClaimOpen(
  templateId: string,
  harvestClaimedBy: number | null,
  harvestStateReliable = true,
): boolean {
  return (
    harvestStateReliable &&
    harvestClaimedBy === null &&
    isHarvestableCorpse(MOBS[templateId]?.componentTags)
  );
}

/** The indicator one viewer sees over a body. Only a dead, lootable, wild
 *  (unowned) mob inside its corpse window can show anything; ordinary loot for
 *  this viewer wins, else an open harvest, else nothing, even while `lootable`
 *  stays true for the harvest grace window. `viewerPartyIds` is the VIEWER's
 *  roster (self included, empty or null when solo). Honors the FFA lapse, as
 *  the generic press does. */
export function corpseIndicatorFor(
  mob: Entity,
  viewerId: number,
  viewerPartyIds: readonly number[] | null,
  harvestStateReliable = true,
): CorpseIndicator {
  if (
    mob.kind !== 'mob' ||
    !mob.dead ||
    !mob.lootable ||
    mob.ownerId != null ||
    corpseHasDecayed(mob.dead, mob.corpseTimer)
  ) {
    return 'none';
  }
  const tappedById = mob.tappedById ?? null;
  const shared = corpseSharedLootRightsFor(
    viewerId,
    tappedById,
    tapperPartyFromViewerParty(tappedById, viewerPartyIds),
    mob.lootFfaTimer,
    true,
  );
  if (corpseHasOrdinaryLootFor(mob.loot, viewerId, shared)) return 'loot';
  if (corpseHarvestClaimOpen(mob.templateId, mob.harvestClaimedBy, harvestStateReliable)) {
    return 'harvest';
  }
  return 'none';
}
