// The "encounter in progress" lock, the classic raid door rule: while a boss
// fight of a claim runs, nobody from OUTSIDE may enter that claim, living or
// released spirit. The rule is the Ignivar door's (instances/ignivar_entry.ts
// ignivarRaidInCombat: every outside entrant, living included, is held while
// the raid fights; a body already inside is untouched), scoped to boss fights
// and to the dungeons content/encounter_lock.ts opts in, with the same
// throttle. A spirit is not set down inside and not revived at the door; it
// waits outside until the fight ends (the wipe's reset or the kill), when the
// ordinary return applies (instances/dungeon_checkpoints.ts), or until someone
// raises its body (a resurrection never passes through the door). Holding the
// living too closes the Spirit Healer's way round it. Every other dungeon
// keeps the plain door. Consumed by enterDungeon (instances/dungeons.ts),
// after the lockout refusals (a lockout is the more lasting reason, so its
// line wins).
//
// "In its fight" is the encounter coordinators' own test (encounters/
// smith_heart council.ts, breath.ts, quench.ts, heat.ts, final.ts `fighting`):
// alive, pulled, chasing or swinging, so a boss walking home after a wipe
// already lets the raid back in. Bosses are read off the claim's placed roster
// by spawn ordinal (the gates' own read), never by name, so a neighbour's body
// or a summoned copy never holds the door. No rng, no clock but sim time.
//
// A dev bypass (/dev heart enter) is held like anyone else.

import { ENCOUNTER_LOCK_BOSSES } from '../content/encounter_lock';
import { DUNGEONS } from '../data';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { IGNIVAR_ENTRY_DENIED_NOTICE_SECONDS } from './ignivar_entry';

/** The English refusal (re-localized by src/ui/sim_i18n.ts, EXACT matcher). */
export const ENCOUNTER_IN_PROGRESS_TEXT =
  'An encounter is in progress. You cannot enter until it ends.';

/** One refusal per entrant per this many seconds (the Ignivar door's window):
 *  the walk-in trigger fires at 20 Hz while someone stands in the portal. */
export const ENCOUNTER_LOCK_NOTICE_SECONDS = IGNIVAR_ENTRY_DENIED_NOTICE_SECONDS;

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
 * Does the lock bar `entrant` (entity of `pid`) from entering `inst` right now?
 * True for anyone standing outside the claim (`insideClaim` false), living or
 * spirit, while one of its boss fights runs; they are then told why, at most
 * once per notice window (a preflight never speaks and never spends the window).
 */
export function encounterLockBarsEntry(
  ctx: SimContext,
  inst: InstanceSlot,
  entrant: Entity,
  pid: number,
  insideClaim: boolean,
  preflightOnly: boolean,
): boolean {
  if (insideClaim || !encounterInProgress(ctx, inst)) return false;
  if (
    !preflightOnly &&
    ctx.time >= (entrant.encounterLockNoticeAt ?? -Infinity) + ENCOUNTER_LOCK_NOTICE_SECONDS
  ) {
    entrant.encounterLockNoticeAt = ctx.time;
    ctx.error(pid, 'An encounter is in progress. You cannot enter until it ends.');
  }
  return true;
}

/** A new life or a new death starts the notice window afresh, so the next
 *  refusal always speaks (spirit.ts: revive and release). */
export function clearEncounterLockNotice(entrant: Entity): void {
  entrant.encounterLockNoticeAt = undefined;
}
