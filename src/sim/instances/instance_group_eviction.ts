// The classic group-instance eviction: a player inside a group's dungeon or raid
// claim who is no longer in that group (kicked, left, or the group disbanded)
// gets a warning and INSTANCE_EVICTION_GRACE_SECONDS to be re-invited, then is
// set down outside the dungeon's door.
//
// Before this, leaving the party never moved anyone, so a removed player could
// stay inside for as long as they liked. Their body, or their corpse, kept the
// claim occupied, which held the group's Reset All Instances and any queued
// difficulty change (difficulty_selection.ts) indefinitely.
//
// Only party-keyed claims evict. A solo claim's owner keeps theirs after forming
// a party (claims are not re-keyed when a group forms), so evicting there would
// throw a player out of their own run for inviting a friend. Exempt as well: a
// GM, and a raid returner standing where the door's own return rule admits them
// (raid_return.ts): a room of the run they cleared and are still locked to, or
// an earlier room on the way out of it. Such a player is never in the owning
// group by design. Anywhere else in the run, they are evicted like anyone.
//
// The warning repeats at INSTANCE_EVICTION_REMINDER_SECONDS left. A player who
// leaves the world (logout or disconnect) while they do not belong is set down
// outside at once (evictLeaverFromGroupInstance, run from preparePlayerLeave,
// before the leave save): the countdown lives on the entity and a relog makes a
// new one, so without this a relog would restart the grace every time.
//
// A dead player is handled too, since their corpse holds the claim the same way
// a body does: an unreleased body is released first, and a ghost's corpse that
// lies inside the claim is moved to the door drop point, where the ghost can
// still resurrect at it. The corpse rests on the door's standing surface
// (dungeonExitStandingPos), the same one a living player is set down on.
//
// The removal ignores the exit seals (the Nythraxis royal door, the Ignivar
// boss-fight seal) and the Ignivar floor-by-floor exit routing on purpose: a
// removed player is set straight down at the raid's outdoor door, in or out of
// combat, as the classic rule did. detachFromDungeon still scrubs them from
// every hate table and sheds the encounter auras, the same teardown a
// battleground queue pop uses, so a fight they leave resets like any zone-out.
//
// Runs in the instance 1 Hz phase (updateInstances), before the queued
// difficulty retry, so an eviction clears the way for that retry in the same
// second. `src/sim`-pure: no DOM, no wall clock, no rng.

import { DUNGEONS, dungeonAt } from '../data';
import type { InstanceSlot, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { releasePlayerSpirit } from '../spirit';
import type { Entity } from '../types';
import {
  detachFromDungeon,
  dungeonExitSpot,
  dungeonExitStandingPos,
  instanceClaimContains,
  setDownAtDungeonExit,
} from './dungeons';
import { isClearedReturnRoom, raidFamilyOf } from './raid_return';

/** How long a removed player has to be re-invited before they are moved out. */
export const INSTANCE_EVICTION_GRACE_SECONDS = 60;

/** Seconds left at which the warning is repeated. */
export const INSTANCE_EVICTION_REMINDER_SECONDS: readonly number[] = [30, 10];

/** The player-facing lines. English, re-localized by the client matchers
 *  (src/ui/sim_i18n.ts). */
export function instanceEvictionWarningText(seconds: number): string {
  return `You are not in this instance's group. You will be removed from the instance in ${seconds} seconds.`;
}
export const INSTANCE_EVICTED_TEXT =
  'You have been removed from the instance because you are not in its group.';

function claimAt(ctx: SimContext, pos: Entity['pos']): InstanceSlot | null {
  if (!dungeonAt(pos.x)) return null;
  return ctx.instances.find((i) => i.partyKey !== null && instanceClaimContains(i, pos)) ?? null;
}

/** The group claim this player holds with their body (alive or dead) or, as a
 *  ghost, with their corpse. The same two holds the reset occupancy gate reads. */
export function claimHeldBy(ctx: SimContext, p: Entity): InstanceSlot | null {
  const body = claimAt(ctx, p.pos);
  if (body) return body;
  if (p.ghost && p.corpsePos) {
    const corpse = claimAt(ctx, p.corpsePos);
    if (corpse && corpse.exitId === p.corpseInstanceId) return corpse;
  }
  return null;
}

/** May this player stay in this claim? */
export function belongsInClaim(
  ctx: SimContext,
  pid: number,
  p: Entity,
  inst: InstanceSlot,
): boolean {
  const key = inst.partyKey;
  if (key === null || !key.startsWith('party:')) return true;
  if (p.gm) return true;
  if (ctx.instanceKeyFor(pid) === key) return true;
  const family = raidFamilyOf(inst.dungeonId);
  if (!family) return false;
  // This room or any later one: rooms are listed entrance first, and a returner
  // walks back out through every room before the one they cleared.
  const from = family.indexOf(inst.dungeonId);
  return family.slice(from).some((roomId) => isClearedReturnRoom(ctx, pid, key, roomId));
}

/** The outdoor drop point for a claim: its dungeon's door. Every authored door
 *  is an overworld position (the raid rooms share their raid's outdoor door),
 *  pinned for every dungeon by tests/instance_group_eviction.test.ts. */
export function outdoorExitSpot(
  ctx: SimContext,
  inst: InstanceSlot,
): { x: number; z: number; facing: number } {
  return dungeonExitSpot(ctx, DUNGEONS[inst.dungeonId]);
}

function evict(ctx: SimContext, meta: PlayerMeta, p: Entity, inst: InstanceSlot): boolean {
  const spot = outdoorExitSpot(ctx, inst);
  if (p.dead && !p.ghost) {
    releasePlayerSpirit(ctx, meta.entityId);
    // A body the release declined (an arena or delve rule) stays put; retry next second.
    if (!p.ghost) return false;
  }
  if (instanceClaimContains(inst, p.pos)) {
    detachFromDungeon(ctx, p);
    setDownAtDungeonExit(ctx, p, spot);
  }
  if (
    p.ghost &&
    p.corpsePos &&
    p.corpseInstanceId === inst.exitId &&
    instanceClaimContains(inst, p.corpsePos)
  ) {
    p.corpsePos = dungeonExitStandingPos(ctx, spot);
    p.corpseInstanceId = null;
  }
  ctx.error(meta.entityId, INSTANCE_EVICTED_TEXT);
  return true;
}

function clearTimer(p: Entity): void {
  delete p.instanceEvictIn;
  delete p.instanceEvictClaimId;
}

export function updateInstanceGroupEviction(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    const inst = claimHeldBy(ctx, p);
    if (!inst || inst.exitId === null || belongsInClaim(ctx, meta.entityId, p, inst)) {
      if (p.instanceEvictIn !== undefined) clearTimer(p);
      continue;
    }
    if (p.instanceEvictIn === undefined || p.instanceEvictClaimId !== inst.exitId) {
      p.instanceEvictIn = INSTANCE_EVICTION_GRACE_SECONDS;
      p.instanceEvictClaimId = inst.exitId;
      ctx.error(meta.entityId, instanceEvictionWarningText(INSTANCE_EVICTION_GRACE_SECONDS));
      continue;
    }
    // Whole seconds counted by this 1 Hz pass, so the grace is exact rather
    // than at the mercy of accumulated floating-point sim time.
    if (p.instanceEvictIn > 1) {
      p.instanceEvictIn -= 1;
      if (INSTANCE_EVICTION_REMINDER_SECONDS.includes(p.instanceEvictIn)) {
        ctx.error(meta.entityId, instanceEvictionWarningText(p.instanceEvictIn));
      }
      continue;
    }
    if (evict(ctx, meta, p, inst)) clearTimer(p);
  }
}

/** A player leaving the world (Sim.preparePlayerLeave, before the leave save)
 *  inside a group claim they do not belong to is set down outside now, so the
 *  save records the door and a relog cannot restart the grace. A player who
 *  still belongs is untouched. Idempotent: once outside, it is a no-op. */
export function evictLeaverFromGroupInstance(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  const p = meta && ctx.entities.get(meta.entityId);
  if (!meta || !p) return;
  const inst = claimHeldBy(ctx, p);
  if (!inst || inst.exitId === null || belongsInClaim(ctx, meta.entityId, p, inst)) return;
  if (evict(ctx, meta, p, inst)) clearTimer(p);
}
