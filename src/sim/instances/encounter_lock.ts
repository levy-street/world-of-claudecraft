// The "encounter in progress" lock, the classic raid door rule: while a boss
// fight of a claim runs, a released spirit whose body lies in that claim may
// not walk back in. It is not set down inside and not revived at the door; it
// waits outside until the fight ends (the wipe's reset or the kill), when the
// ordinary return applies (instances/dungeon_checkpoints.ts), or until someone
// raises its body (a resurrection never passes through the door). Opted in per
// dungeon by content/encounter_lock.ts; every other dungeon, a living entrant
// and a spirit whose body lies elsewhere keep the plain door. Consumed by
// enterDungeon (instances/dungeons.ts).
//
// "In its fight" is the encounter coordinators' own test (encounters/
// smith_heart council.ts, breath.ts, quench.ts, heat.ts, final.ts `fighting`):
// alive, pulled, chasing or swinging, so a boss walking home after a wipe
// already lets the raid back in. Bosses are read off the claim's placed roster
// by spawn ordinal (the gates' own read), never by name, so a neighbour's body
// or a summoned copy never holds the door. No rng, no clock but sim time.
//
// Deliberate limits: a dev bypass (/dev heart enter) is held like anyone else
// (/dev revive first); and the lock binds the SPIRIT only, so a player who
// takes the Spirit Healer's revive outside walks in alive like any living
// entrant (the product rule: living entrants are unchanged).

import { ENCOUNTER_LOCK_BOSSES } from '../content/encounter_lock';
import { DUNGEONS } from '../data';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** The English refusal (re-localized by src/ui/sim_i18n.ts, EXACT matcher). */
export const ENCOUNTER_IN_PROGRESS_TEXT =
  'An encounter is in progress. You cannot enter until it ends.';

/** One refusal per spirit per this many seconds: the walk-in trigger fires at
 *  20 Hz while a spirit stands in the portal. */
export const ENCOUNTER_LOCK_NOTICE_SECONDS = 4;

/** In its fight: alive, pulled, chasing or swinging (not walking home). */
function fighting(mob: Entity): boolean {
  return (
    !mob.dead && mob.hp > 0 && mob.inCombat && (mob.aiState === 'chase' || mob.aiState === 'attack')
  );
}

/** Is a listed boss fight of this claim running right now? False for a
 *  dungeon without the opt-in. */
export function encounterInProgress(ctx: SimContext, inst: InstanceSlot): boolean {
  if (!Object.hasOwn(ENCOUNTER_LOCK_BOSSES, inst.dungeonId)) return false;
  const bosses = ENCOUNTER_LOCK_BOSSES[inst.dungeonId];
  const spawns = DUNGEONS[inst.dungeonId]?.spawns ?? [];
  for (let i = 0; i < spawns.length; i++) {
    if (!bosses.includes(spawns[i].mobId)) continue;
    const mob = ctx.entities.get(inst.mobIds[i]);
    if (mob && fighting(mob)) return true;
  }
  return false;
}

/**
 * Does the lock hold `player` (entity of `pid`) outside `inst` right now? True
 * only for a released spirit whose body lies in this very claim while one of
 * its boss fights runs; it is then told why, at most once per notice window (a
 * preflight never speaks and never spends the window).
 */
export function encounterLockHoldsSpirit(
  ctx: SimContext,
  inst: InstanceSlot,
  player: Entity,
  pid: number,
  preflightOnly: boolean,
): boolean {
  if (!player.ghost || inst.exitId === null || player.corpseInstanceId !== inst.exitId)
    return false;
  if (!encounterInProgress(ctx, inst)) return false;
  if (
    !preflightOnly &&
    ctx.time >= (player.encounterLockNoticeAt ?? -Infinity) + ENCOUNTER_LOCK_NOTICE_SECONDS
  ) {
    player.encounterLockNoticeAt = ctx.time;
    ctx.error(pid, 'An encounter is in progress. You cannot enter until it ends.');
  }
  return true;
}
