// Line of sight for the trash kit's casts AT ONE PLAYER (the generic half of
// mob/cast_sight.ts, for real cast bars): a bolt, a mark, a sleep, a drowning
// column. Before this module only the brand asked for a line of sight; a Grave
// Bolt picked its victim through a wall and landed through it.
//
// The rule, applied by the driver (driver.ts) to every key listed here and to
// the keys a dungeon's extension lists (TrashKitExtension.sightKeys):
//   - the bar begins only at a player the caster can SEE: a hidden pick is
//     re-drawn among the players in sight, and when nobody in reach is in
//     sight the cast waits KIT_SIGHT_RETRY and looks again;
//   - a bar already running runs out whatever its victim does; if they are
//     out of sight when it ends the cast FAILS like a broken one (nothing
//     lands, the same cleanup an interrupt gets) and is handed back: it may
//     begin again KIT_SIGHT_RETRY later, once the caster sees someone.
// A player's own cast fails the same way (combat/casting_lifecycle.ts: refused
// at the start and at the finish, and a refused finish spends nothing).
//
// Not here, on purpose: area casts (a nova, a cone, a ring, a lane: the area
// is the telegraph), casts at an ally or a corpse, and the casts that carry
// their own authored sight rule (the brand, which keeps its cooldown when it
// fizzles; the Siren's lure, broken the moment she loses sight; the
// Sergeant's order, judged bolt by bolt).
//
// Cost: no query while a cast waits on its cooldown or on its own readiness;
// one when a bar would begin, one when it ends, and, only when the first pick
// was hidden, one more per further pick until a player in sight is found (the
// re-draw stops at the first, and at KIT_SIGHT_REDRAWS draws whatever the
// room holds: a raid room does not fan out). A cast with nobody in sight
// waits KIT_SIGHT_RETRY plus a slot of its caster's id, so a pack whose target
// hides does not all look again on one tick; a pack's FIRST casts are already
// spread by its pull order (mob/pack_cast_stagger.ts). Every query is tallied
// on the sim's per-tick counters (mobScanCounters.sightQueries), and a bar
// that would BEGIN once the tick's sight budget is spent waits a tick
// (cast_sight.ts SIGHT_QUERIES_PER_TICK); a bar that ENDS is always judged.
// Draws no rng; the hashed picks are unchanged whenever everyone is in sight.
//
// A fizzle is a bar that was begun: it keeps its place in the caster's cast
// count (TrashKitState.casts, the salt of the hashed picks), so the pick after
// a fizzle is drawn afresh and never the same hidden player for ever.

import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { sightBudgetSpent } from '../cast_sight';

/** The driver's own keys that are a cast at one player. */
export const KIT_SIGHT_KEYS: ReadonlySet<string> = new Set(['bolt', 'eye', 'column', 'lullaby']);

/** Seconds a sight-bound cast waits before it looks for a victim again. */
export const KIT_SIGHT_RETRY = 0.5;
/** Tick slots (by caster id) the retry is spread over, so a pack does not all
 *  look again together. */
export const KIT_SIGHT_RETRY_SLOTS = 10;

/** When a cast that found nobody in sight looks again: the retry plus its
 *  caster's slot, in seconds. */
export function kitSightRetry(mob: Entity): number {
  return KIT_SIGHT_RETRY + (mob.id % KIT_SIGHT_RETRY_SLOTS) * DT;
}

/** Is `target` a living player the caster cannot see? (An ally, a corpse or
 *  no target at all is never hidden: those casts are not sight-bound.) One
 *  line-of-sight query, tallied. */
export function kitVictimHidden(
  ctx: SimContext,
  mob: Entity,
  target: Entity | null | undefined,
): boolean {
  if (!target || target.kind !== 'player' || target.dead) return false;
  ctx.mobScanCounters.sightQueries++;
  return !ctx.hasLineOfSight(mob, target);
}

/** The most re-draws one attempt makes after a hidden first pick: a five-man
 *  party is looked through whole, a raid room is not. */
export const KIT_SIGHT_REDRAWS = 4;
/** pickSeenVictim's answer when the tick's sight budget is spent: try again
 *  next tick, with nothing changed. */
export const KIT_SIGHT_WAIT = 'wait';

/**
 * The victim a sight-bound cast may begin at, given its first pick: that pick
 * when the caster sees it, otherwise the cast's own pick drawn again (`redraw`)
 * from the players not yet found hidden, one sight query a draw, stopping at
 * the first in sight. Null when nobody it may pick is in sight (the caller
 * waits kitSightRetry), KIT_SIGHT_WAIT when the tick's sight budget is spent.
 *
 * Always returns: every round either answers or sets one more player aside,
 * the rounds are capped at KIT_SIGHT_REDRAWS, and a `redraw` that hands back
 * the player just set aside, or anyone outside the pool it was given, ends
 * the attempt (a pick that ignores its pool must never spin the tick).
 */
export function pickSeenVictim(
  ctx: SimContext,
  mob: Entity,
  first: Entity,
  players: readonly Entity[],
  redraw: (pool: readonly Entity[]) => Entity | null,
): Entity | null | typeof KIT_SIGHT_WAIT {
  let target = first;
  let pool = players;
  for (let draws = 0; ; draws++) {
    // An ally, a corpse: not a sight-bound victim, and no query.
    if (target.kind !== 'player' || target.dead) return target;
    if (sightBudgetSpent(ctx)) return KIT_SIGHT_WAIT;
    if (!kitVictimHidden(ctx, mob, target)) return target;
    if (draws >= KIT_SIGHT_REDRAWS) return null;
    const hidden = target;
    const rest = pool.filter((p) => p !== hidden);
    // The hidden pick was never in the pool it was drawn from: nothing was
    // set aside, so drawing again could only hand it back.
    if (rest.length === pool.length || rest.length === 0) return null;
    pool = rest;
    const again = redraw(pool);
    if (again === null || !pool.includes(again)) return null;
    target = again;
  }
}
