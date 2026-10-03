// The adventurers' corpse run, the shift's second round. A fallen adventurer
// lies silent, releases after CORPSE_RELEASE_TICKS (its body stays: Raise the
// Fallen can still take it), and after CORPSE_RETURN_TICKS it walks back in
// alive at the Crypt's entrance, with the instance re-entry pools
// (RES_HP_FRACTION), the way every player comes back from a dungeon death (the
// ghost's run outdoors is not simulated). Each adventurer gets ONE corpse run:
// a second death is final. The party gives up when the last one standing has
// nobody left who can come back. Fixed delays, no rng.

import { freshBotSteer } from '../bots/steer';
import { DUNGEONS } from '../data';
import { instanceOriginOf } from '../instances/dungeons';
import type { SimContext } from '../sim_context';
import { RES_HP_FRACTION, revivePlayerAt } from '../spirit';
import { TICK_RATE } from '../types';
import { adventurerMarkerAura, isGraveyardShiftAdventurer } from './hostility';
import { GRAVEYARD_SHIFT_ARRIVAL, GRAVEYARD_SHIFT_DUNGEON_ID } from './run_layout';
import type { GraveyardShiftBot, GraveyardShiftRun } from './run_state';

export const CORPSE_RELEASE_TICKS = 5 * TICK_RATE;
// From the death to the walk back in at the entrance.
export const CORPSE_RETURN_TICKS = 30 * TICK_RATE;
export const CORPSE_RUNS_PER_ADVENTURER = 1;

/** Fallen, with a corpse run still to come. */
export function awaitingReturn(ctx: SimContext, bot: GraveyardShiftBot): boolean {
  return ctx.entities.get(bot.pid)?.dead === true && bot.deaths <= CORPSE_RUNS_PER_ADVENTURER;
}

/** Fallen for good (its corpse run spent), or gone from the run's world. */
export function outForGood(ctx: SimContext, bot: GraveyardShiftBot): boolean {
  const e = ctx.entities.get(bot.pid);
  return !e || (e.dead && bot.deaths > CORPSE_RUNS_PER_ADVENTURER);
}

/** The released adventurers whose release lands this tick (the survivors' cue). */
export function releasingNow(ctx: SimContext, run: GraveyardShiftRun): boolean {
  return run.bots.some(
    (bot) =>
      awaitingReturn(ctx, bot) &&
      bot.diedTick !== null &&
      ctx.tickCount - bot.diedTick === CORPSE_RELEASE_TICKS,
  );
}

// Counts each death once, and walks a released adventurer back in once its
// delay is up. Called every run tick before the outcome check.
export function updateGraveyardShiftCorpseRuns(ctx: SimContext, run: GraveyardShiftRun): void {
  for (const bot of run.bots) {
    const e = ctx.entities.get(bot.pid);
    if (!e) continue;
    if (!e.dead) {
      bot.diedTick = null;
      continue;
    }
    if (bot.diedTick === null) {
      bot.diedTick = ctx.tickCount;
      bot.deaths++;
    }
    if (awaitingReturn(ctx, bot) && ctx.tickCount - bot.diedTick >= CORPSE_RETURN_TICKS) {
      returnAtEntrance(ctx, run, bot);
    }
  }
}

function returnAtEntrance(ctx: SimContext, run: GraveyardShiftRun, bot: GraveyardShiftBot): void {
  const origin = instanceOriginOf(run.slot);
  const entry = DUNGEONS[GRAVEYARD_SHIFT_DUNGEON_ID].entry;
  const x = origin.x + entry.x;
  const z = origin.z + entry.z;
  revivePlayerAt(ctx, bot.pid, ctx.groundPos(x, z), RES_HP_FRACTION);
  const e = ctx.entities.get(bot.pid);
  if (!e || e.dead) return;
  // A death strips auras: the hostility marker goes back on.
  if (!isGraveyardShiftAdventurer(e)) e.auras.push(adventurerMarkerAura(bot.pid));
  e.facing = Math.atan2(
    origin.x + GRAVEYARD_SHIFT_ARRIVAL.x - x,
    origin.z + GRAVEYARD_SHIFT_ARRIVAL.z - z,
  );
  e.prevFacing = e.facing;
  const brain = bot.brain;
  Object.assign(brain.steer, freshBotSteer());
  brain.goalId = null;
  brain.seenCast = null;
  brain.kickAt = null;
  brain.healTargetId = null;
  // The body walked away with its owner: a later corpse is a new one.
  run.raisedCorpseIds.delete(bot.pid);
  bot.diedTick = null;
  bot.returning = true;
}

/** The last adventurer standing with nobody left who can come back. */
export function partyGivesUp(ctx: SimContext, run: GraveyardShiftRun): boolean {
  let standing = 0;
  for (const bot of run.bots) {
    if (awaitingReturn(ctx, bot)) return false;
    if (!outForGood(ctx, bot)) standing++;
  }
  return standing === 1 && run.bots.length > 1;
}

/** Every adventurer fallen for good: nobody is left to come back. */
export function partyWiped(ctx: SimContext, run: GraveyardShiftRun): boolean {
  return run.bots.every((bot) => outForGood(ctx, bot));
}
