// Line of sight for an ordinary mob cast at a target (the owner's playtest of
// 2026-10-12: "we line-of-sighted casters and they never stopped casting").
// Before this module a petSpell caster in spell range stood still and landed
// every bolt through whatever stood between it and its target: no mob cast
// asked for a line of sight at its start, during its windup, or at its end.
//
// The rule, the one a player's own cast follows (combat/casting_lifecycle.ts
// refuses a cast with "Line of sight." at its start and again at its finish,
// and a refused finish costs the cast's time and nothing else):
//   - a mob needs a line of sight to its target to BEGIN a cast at it;
//   - a cast already begun runs out its windup whatever the target does; if
//     the target is out of sight when it ends, the cast FAILS: no projectile,
//     no damage, no resist roll, nothing drawn from the rng;
//   - a failed cast is not paid for: the caster may try again as soon as it
//     sees its target (after CAST_SIGHT_RETRY_SECONDS, never on the same tick);
//   - a caster that cannot see its target does not stand there: it closes on
//     it, round the wall by a planned route where routes are planned (inside
//     an instance, mob/chase_route.ts) and by the ordinary straight chase
//     everywhere else, and casts again from the first spot in range that has a
//     line of sight. One that can neither see nor reach falls to the existing
//     stall, evade and hold rules; it never stands silent for ever.
//
// WHO: a hostile-AI petSpell caster that leashes and is not a boss
// (casterObeysSight). A boss (mob/encounter_body.ts isBossTemplate: the boss
// flag alone misses the named mid-bosses), an encounter script that opted out
// of the leash (canLeash false: it has no stall or evade to fall back on, so a
// walled-off one would stand silent for ever) and a player's pet keep the old
// loop. Today no boss and no canLeash-false template carries a petSpell; the
// gate is here so one added later is not swept in by accident.
//
// Cost on the server's tick, bounded by design: a standing caster asks for a
// line of sight twice a cast (its start and its end); a caster on the move
// asks once every SIGHT_RECHECK_TICKS, on its own tick slot (by entity id, so
// a pack does not ask together), and only within SIGHT_SEEK_MARGIN of its
// spell range; nothing asks every tick. Every query is tallied on the sim's
// per-tick counters (mobScanCounters.sightQueries), and the tally is also a
// BUDGET, the way routeNodes is for route searches (the sim resets it at the
// top of its own tick and serves mobs in entity order, so it is the same on
// every host): once SIGHT_QUERIES_PER_TICK queries have been asked this tick a
// cast that would BEGIN waits a tick and a caster on the move keeps its last
// answer, so a pack whose timers line up cannot ask all together. A cast that
// ENDS is always judged (a windup that ran out is a hit or a miss now, never
// later), which is why the tally can pass the budget by the casts ending on
// that tick. The query itself (Sim.hasLineOfSight) samples the sight line
// every half yard against the slot's collider cells.
//
// Draws no rng.

import type { MobCombatProfile } from '../mob_combat';
import type { SimContext } from '../sim_context';
import { DT, dist2d, type Entity } from '../types';
import { chaseRouteFor } from './chase_route';
import { isBossTemplate } from './encounter_body';

/** Sim ticks between two sight checks of a caster on the move (a quarter second). */
export const SIGHT_RECHECK_TICKS = 5;
/** Yards past its spell range inside which a closing caster starts asking. */
export const SIGHT_SEEK_MARGIN = 8;
/** Seconds before a caster whose cast failed on sight may begin another: the
 *  caster loop's own fast-cast clamp on reaching range (combat_profile.ts). */
export const CAST_SIGHT_RETRY_SECONDS = 0.4;
/** Line-of-sight queries a tick after which no further mob cast may begin on
 *  one and no moving caster rechecks (the kit's bars share it,
 *  mob/trash_kit/kit_cast_sight.ts). */
export const SIGHT_QUERIES_PER_TICK = 24;

/** What the sight rule says about this tick of a standing caster. */
export type CastSightVerdict =
  /** Nothing to judge, or the line is clear: cast on. */
  | 'cast'
  /** About to begin a cast with no line of sight: go and find one. */
  | 'seek'
  /** About to begin a cast with the tick's sight budget spent: ask next tick. */
  | 'wait'
  /** A windup ran out with the target out of sight: the cast failed. */
  | 'failed';

/** Does this caster's petSpell obey the sight rule (see WHO above)? */
export function casterObeysSight(mob: Entity, profile: MobCombatProfile): boolean {
  return profile.canLeash && mob.ownerId === null && !isBossTemplate(mob.templateId);
}

/** Has this tick's budget of sight queries been asked already? */
export function sightBudgetSpent(ctx: SimContext): boolean {
  return ctx.mobScanCounters.sightQueries >= SIGHT_QUERIES_PER_TICK;
}

/** One line-of-sight query, tallied. */
function sees(ctx: SimContext, mob: Entity, target: Entity): boolean {
  ctx.mobScanCounters.sightQueries++;
  return ctx.hasLineOfSight(mob, target);
}

/** Write a fresh answer down. A blocked one makes the record that carries it
 *  (the chase arm and the stall detector's reach read it back); a clear one
 *  only corrects a record that already exists, so a caster that never lost
 *  sight carries none. */
function note(ctx: SimContext, mob: Entity, target: Entity, clear: boolean): void {
  const held = mob.chaseRoute?.targetId === target.id ? mob.chaseRoute : undefined;
  if (clear && held === undefined) return;
  const route = held ?? chaseRouteFor(ctx, mob, target);
  route.sightClear = clear;
}

/**
 * Is the caster's line of sight to its target blocked? For a mob on the move.
 * Asked only within `reach` (its spell range) plus SIGHT_SEEK_MARGIN (farther
 * out the caster is only closing the distance, sight decides nothing yet, and
 * the query's cost grows with its length), and only on the caster's own slot
 * of every SIGHT_RECHECK_TICKS ticks; between asks the last answer stands, and
 * a caster that has never been blocked reads clear. The cast's own start
 * check is what catches an answer gone stale in those few ticks.
 */
export function casterSightBlocked(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  reach: number,
): boolean {
  if (dist2d(mob.pos, target.pos) > reach + SIGHT_SEEK_MARGIN) {
    note(ctx, mob, target, true);
    return false;
  }
  if ((ctx.tickCount + mob.id) % SIGHT_RECHECK_TICKS === 0 && !sightBudgetSpent(ctx))
    note(ctx, mob, target, sees(ctx, mob, target));
  return lastSightBlocked(mob, target);
}

/** The last answer the mob holds about this target, without asking again
 *  (false for a mob that holds none: it has never been blocked). */
export function lastSightBlocked(mob: Entity, target: Entity): boolean {
  const route = mob.chaseRoute;
  return route !== undefined && route.targetId === target.id && !route.sightClear;
}

/**
 * Judge a standing petSpell caster's tick BEFORE its ranged attack runs
 * (Sim.updateRangedPetAttack, whose timing this mirrors: a committed windup
 * releases on its tick, and a new cast begins on the tick the swing timer
 * runs out). Asks for a line of sight on those two ticks only, and writes
 * every answer down, a clear one included: a caster whose target stepped back
 * into sight must not go on reading "blocked" while it stands casting.
 */
export function petSpellSightVerdict(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
): CastSightVerdict {
  if (mob.rangedWindupReleaseTick != null) {
    if (ctx.tickCount < mob.rangedWindupReleaseTick) return 'cast';
    const clear = sees(ctx, mob, target);
    note(ctx, mob, target, clear);
    if (clear) return 'cast';
    // The windup ran out on a target it cannot see: nothing leaves its hand,
    // and the cast it did not get is not charged to its cadence. These two
    // fields are everything the windup's start wrote (Sim.updateRangedPetAttack:
    // the release tick, and the swing timer set to the spell's cadence); a
    // petSpell has no cast bar, no castingAbility and no stored target to clear.
    mob.rangedWindupReleaseTick = null;
    mob.swingTimer = Math.min(mob.swingTimer, CAST_SIGHT_RETRY_SECONDS);
    return 'failed';
  }
  // The same test the attack makes after its own decrement (swingTimer -= DT,
  // then "> 0: not yet").
  if (mob.swingTimer - DT > 0) return 'cast';
  if (sightBudgetSpent(ctx)) return 'wait';
  const clear = sees(ctx, mob, target);
  note(ctx, mob, target, clear);
  return clear ? 'cast' : 'seek';
}
