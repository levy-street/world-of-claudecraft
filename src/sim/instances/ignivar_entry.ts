// Ignivar raid entry rules: the cleared-room checkpoint redirect and the
// combat entry lockout the door path applies to entrants from OUTSIDE the
// raid. Modeled on the Rift door rules (rift/runs.ts): group progress lives
// in which rooms the group's partyKey already claims, and "in combat" means
// any living mob of any of the group's rooms is engaged (the
// riftInstanceInCombat rule, applied to the whole four-room family). One
// DELIBERATE divergence: the rift bars only dead entrants (its anti-zerg
// corpse rule); this lockout bars EVERY outside entrant, living included,
// by maintainer decision. Pure helpers over live SimContext views;
// instances/dungeons.ts owns the mutations and emits the player-facing
// denial.

import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_RAID_ROOM_IDS,
  isIgnivarRaidRoom,
} from '../ignivar_raid_ids';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';

// Seconds between repeated entry-denied toasts for one player: the walk-in
// door trigger fires at 20 Hz, so an unthrottled denial would spam per tick
// (the riftDeniedAt precedent, rift/runs.ts).
export const IGNIVAR_ENTRY_DENIED_NOTICE_SECONDS = 4;

/** All of this group's live Ignivar raid-room claims (the four-room family). */
export function ignivarRaidClaimsForKey(ctx: SimContext, partyKey: string | null): InstanceSlot[] {
  if (partyKey === null) return [];
  return ctx.instances.filter(
    (candidate) => candidate.partyKey === partyKey && isIgnivarRaidRoom(candidate.dungeonId),
  );
}

/** The deepest room of the chain the group holds a claim for; null when none. */
export function furthestIgnivarRaidRoom(claims: readonly InstanceSlot[]): string | null {
  let furthest: string | null = null;
  let furthestIndex = -1;
  for (const claim of claims) {
    const index = (IGNIVAR_RAID_ROOM_IDS as readonly string[]).indexOf(claim.dungeonId);
    if (index > furthestIndex) {
      furthestIndex = index;
      furthest = claim.dungeonId;
    }
  }
  return furthest;
}

/**
 * The room an outside entrant actually zones into: entering through the
 * raid's front (the keep door requests the forge-lift; a direct approach
 * request is honored the same way) re-points at the deepest room the group
 * already claims ONCE that checkpoint sits past the Halls, so a returning
 * member (a ghost corpse-running back included) rejoins the raid where it
 * is instead of back at the start. A group no deeper than the Halls keeps
 * the requested entry and boards the lift again (the ride is per-claim).
 * Any other requested room passes through.
 */
export function resolveIgnivarEntryRoom(
  requestedDungeonId: string,
  claims: readonly InstanceSlot[],
): string {
  if (
    requestedDungeonId !== IGNIVAR_FORGE_APPROACH_ID &&
    requestedDungeonId !== IGNIVAR_LIFT_ROOM_ID
  ) {
    return requestedDungeonId;
  }
  const furthest = furthestIgnivarRaidRoom(claims);
  if (furthest === null) return requestedDungeonId;
  const rooms = IGNIVAR_RAID_ROOM_IDS as readonly string[];
  const checkpointFloor = rooms.indexOf(IGNIVAR_FORGE_APPROACH_ID) + 1;
  return rooms.indexOf(furthest) >= checkpointFloor ? furthest : requestedDungeonId;
}

/**
 * True while any living mob of any of the group's raid rooms is engaged: the
 * window in which nobody outside may zone in, living or ghost (deliberately
 * broader than the rift's dead-only anti-zerg arm). Dead mobs are skipped:
 * a fresh corpse can still carry inCombat, and a kill must never seal the
 * door behind it.
 */
export function ignivarRaidInCombat(ctx: SimContext, claims: readonly InstanceSlot[]): boolean {
  for (const claim of claims) {
    for (const id of claim.mobIds) {
      const mob = ctx.entities.get(id);
      if (mob && !mob.dead && mob.inCombat) return true;
    }
  }
  return false;
}
