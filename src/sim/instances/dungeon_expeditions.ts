// Open expeditions bind to an existing claim's exit entity, never reusable slot
// coordinates. Admission inspects the normal door rules without allocating a run.
import { FINDER_ACTIVITIES, type FinderActivity } from '../content/dungeon_finder';
import { DUNGEON_X_THRESHOLD } from '../data';
import { IGNIVAR_RAID_ROOM_IDS, isIgnivarRaidRoom } from '../ignivar_raid_ids';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { claimedInstanceAt, enterDungeon, instanceClaimHolds } from './dungeons';

export function expeditionActivity(claim: InstanceSlot): FinderActivity | null {
  return (
    FINDER_ACTIVITIES.find(
      (activity) =>
        (activity.dungeonId === claim.dungeonId ||
          activity.lockoutDungeonIds?.includes(claim.dungeonId)) &&
        activity.difficulty === claim.difficulty,
    ) ?? null
  );
}

export function expeditionFamilyClaims(ctx: SimContext, claim: InstanceSlot): InstanceSlot[] {
  if (!isIgnivarRaidRoom(claim.dungeonId)) return [claim];
  return ctx.instances.filter(
    (candidate) =>
      candidate.partyKey === claim.partyKey &&
      candidate.partyKey !== null &&
      candidate.difficulty === claim.difficulty &&
      (IGNIVAR_RAID_ROOM_IDS as readonly string[]).includes(candidate.dungeonId),
  );
}

export function expeditionProgress(ctx: SimContext, claim: InstanceSlot, activity: FinderActivity) {
  const family = expeditionFamilyClaims(ctx, claim);
  return {
    bossesDefeated: activity.encounters.filter((encounter) =>
      family.some((room) => room.defeatedEncounterIds?.has(encounter.mobId)),
    ).length,
    bossesTotal: activity.encounters.length,
  };
}

export function expeditionFinished(
  ctx: SimContext,
  claim: InstanceSlot,
  activity: FinderActivity,
): boolean {
  const family = expeditionFamilyClaims(ctx, claim);
  return activity.encounters.some(
    (encounter) =>
      encounter.final && family.some((room) => room.defeatedEncounterIds?.has(encounter.mobId)),
  );
}

export function recordExpeditionEncounterDeath(claim: InstanceSlot | null, mob: Entity): void {
  if (
    !claim ||
    !expeditionActivity(claim)?.encounters.some((entry) => entry.mobId === mob.templateId)
  )
    return;
  claim.defeatedEncounterIds ??= new Set();
  claim.defeatedEncounterIds.add(mob.templateId);
}

export function expeditionClaimByExit(ctx: SimContext, exitId: number): InstanceSlot | null {
  return ctx.instances.find((claim) => claim.exitId === exitId && claim.partyKey !== null) ?? null;
}

export function currentExpeditionClaim(ctx: SimContext, pid: number): InstanceSlot | null {
  const player = ctx.entities.get(pid);
  if (!player) return null;
  const claim = claimedInstanceAt(ctx, player.pos);
  return claim?.partyKey === ctx.instanceKeyFor(pid) ? claim : null;
}

export function expeditionPlayerAvailable(ctx: SimContext, pid: number): boolean {
  const resolved = ctx.resolve(pid);
  if (
    !resolved ||
    resolved.meta.leaving ||
    resolved.e.dead ||
    resolved.e.ghost ||
    resolved.e.castingAbility ||
    resolved.e.channeling ||
    resolved.meta.vehicle ||
    ctx.duels.has(pid) ||
    ctx.arenaMatches.has(pid) ||
    ctx.bgMatches.has(pid) ||
    ctx.cardDuels.has(pid) ||
    ctx.tradeFor(pid)
  )
    return false;
  return true;
}

// Includes both combat flags and hate tables: an incoming command can land
// between damage and the tick's derived inCombat pass.
export function expeditionInCombat(
  ctx: SimContext,
  claim: InstanceSlot,
  memberPids: readonly number[],
): boolean {
  for (const mobId of claim.mobIds) {
    const mob = ctx.entities.get(mobId);
    if (mob && !mob.dead && (mob.inCombat || mob.threat.size > 0)) return true;
  }
  const partyMember = memberPids.some((pid) => {
    const player = ctx.entities.get(pid);
    return player && instanceClaimHolds(claim, player.pos) && player.inCombat;
  });
  return partyMember;
}

export function expeditionAdmission(
  ctx: SimContext,
  claim: InstanceSlot,
  pid: number,
  leaderPid = pid,
): boolean {
  const activity = expeditionActivity(claim);
  const player = ctx.entities.get(pid);
  if (
    !activity ||
    !player ||
    claim.exitId === null ||
    !ctx.entities.has(claim.exitId) ||
    !expeditionPlayerAvailable(ctx, pid) ||
    expeditionFinished(ctx, claim, activity) ||
    player.level < activity.minLevel ||
    player.level > activity.maxLevel
  )
    return false;
  // The shared door preflight also checks attunement, difficulty lockouts,
  // reset ownership, raid composition and chained-room seals/checkpoints.
  return enterDungeon(ctx, claim.dungeonId, pid, false, {
    finderClaim: claim,
    finderParty: ctx.partyOf(leaderPid) ?? undefined,
    preflightOnly: true,
  });
}

export function canTravelToExpedition(ctx: SimContext, claim: InstanceSlot, pid: number): boolean {
  const player = ctx.entities.get(pid);
  if (
    !player ||
    claim.partyKey !== ctx.instanceKeyFor(pid) ||
    instanceClaimHolds(claim, player.pos) ||
    player.inCombat ||
    player.pos.x > DUNGEON_X_THRESHOLD ||
    expeditionInCombat(ctx, claim, ctx.partyOf(pid)?.members ?? [pid])
  )
    return false;
  return expeditionAdmission(ctx, claim, pid);
}

export function travelToExpedition(ctx: SimContext, claim: InstanceSlot, pid: number): boolean {
  if (!canTravelToExpedition(ctx, claim, pid)) return false;
  return enterDungeon(ctx, claim.dungeonId, pid, false, { finderClaim: claim });
}
