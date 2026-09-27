// Kill-time participation: where a group member "stood" for a kill, and whether
// that spot earns them a share of the kill (XP, quest credit, and the loot
// recipient snapshot that every roll, the round-robin cursor, and the raid
// rooms' corpse-run door exception read back).
//
// A released ghost stands at an overworld graveyard, but their body is still
// where they fell: the corpse is their participation position when it is bound
// to the claim the mob belongs to (any corpse when the kill is not instanced).
//
// Inside a claimed instance the whole claim footprint counts as in range, not
// the overworld 80 yd circle: the daily and weekly raid lockouts already stamp
// every member the claim holds, so a back-line corpse more than 80 yd from
// where the boss finally fell used to take the lockout without the loot rights,
// and a released raider was then refused at the door of their own cleared
// claim. Overworld kills keep the classic PARTY_XP_RANGE rule unchanged.
//
// The two predicates are a pure leaf (the loot_ffa.ts shape): entity and
// primitives in, values out, no rng, no clock. replacementTapperForLeave is the
// thin SimContext consumer the leave teardown calls.

import type { SimContext } from '../sim_context';
import { dist2d, type Entity, PARTY_XP_RANGE, type Vec3 } from '../types';

/** The position a member's kill share is judged from: a released ghost's corpse
 *  when it is bound to `claimExitId` (or to nothing, for an overworld kill),
 *  else where they stand. Null when the member has no usable position. */
export function killParticipationPos(
  e: Entity | undefined,
  claimExitId: number | null,
): Vec3 | null {
  if (!e) return null;
  if (e.ghost && e.corpsePos && (claimExitId === null || e.corpseInstanceId === claimExitId)) {
    return e.corpsePos;
  }
  return e.pos;
}

/** Does `pos` share the kill at `mobPos`? Inside the mob's claimed instance
 *  (`insideClaim`) the whole footprint qualifies; otherwise the classic party
 *  XP circle applies. */
export function isKillParticipant(pos: Vec3, mobPos: Vec3, insideClaim: boolean): boolean {
  return insideClaim || dist2d(pos, mobPos) <= PARTY_XP_RANGE;
}

/** Who inherits a mob's tap when its tapper leaves: the first remaining party
 *  member in the corpse's death-time recipient snapshot when one exists, else
 *  the first member still sharing the kill by position. Null clears the tap,
 *  mirroring immediate removal. */
export function replacementTapperForLeave(
  ctx: SimContext,
  mob: Entity,
  leavingPid: number,
  partyPids: readonly number[],
): number | null {
  const instance = ctx.instances.find(
    (slot) => slot.partyKey !== null && slot.mobIds.includes(mob.id),
  );
  for (const candidatePid of partyPids) {
    if (candidatePid === leavingPid) continue;
    const candidate = ctx.players.get(candidatePid);
    const entity = ctx.entities.get(candidatePid);
    if (!candidate || candidate.leaving || !entity) continue;
    // A corpse already owns an authoritative death-time recipient snapshot.
    // Re-anchor only to someone in that snapshot, irrespective of where they
    // moved after the kill.
    if (mob.lootRecipientIds && mob.lootRecipientIds.length > 0) {
      if (mob.lootRecipientIds.includes(candidatePid)) return candidatePid;
      continue;
    }
    const participationPos = killParticipationPos(entity, instance?.exitId ?? null);
    if (
      participationPos &&
      isKillParticipant(
        participationPos,
        mob.pos,
        instance !== undefined && ctx.instanceClaimIdAt(participationPos) === instance.exitId,
      )
    )
      return candidatePid;
  }
  return null;
}
