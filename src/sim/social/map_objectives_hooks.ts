// The authored-map objective rehearsal's hooks into the Sim coordinator
// (social/map_objectives_run.ts + social/map_objective_bots.ts own the rules).
// Three entry points, each a thin route so sim.ts keeps one line per hook:
//
// - the tick phase, run right after the Ravenrift battleground phase;
// - the shared flag key, which Ravenrift and the rehearsal both answer;
// - the player-death arm, which drops a carried rehearsal flag.
//
// Gating: the tick phase runs only while an authored map is the active world
// (authoredMapActive), so the built-in world's tick, its profiler phase list,
// its rng stream and its entity ids are untouched. The driver itself returns
// null unless that authored map also carries a playable objective record. The
// flag and death routes are inert off a live run: objectiveRun is null on the
// built-in world (it reads the presentation mode), and the death arm only
// reads an already-built run.
//
// Determinism: the phase itself draws ZERO rng (tick-math clocks,
// pure-function bot steering), so its tick slot cannot fork the shared draw
// order. The practice bots it spawns on an objective map are ordinary mobs, so
// THEIR combat and AI draw from the shared stream like any mob's: authored
// objective maps only, never the built-in world.
//
// Cost: the bot driver's teardown arm walks the whole roster when no run is
// live, which every authored map WITHOUT objectives would otherwise pay each
// tick. Bots only ever spawn under a live run,
// so the driver is skipped for a Sim that has never had one, and runs exactly
// once more after its run ends, to take the bots down.

import { authoredMapActive } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity, SimConfig } from '../types';
import { bgFlagAction, bgMatchFor, bgOnPlayerDeath } from './battleground';
import { updateObjectiveBots } from './map_objective_bots';
import {
  mapObjectiveFlagAction,
  mapObjectiveOnDeath,
  objectiveRun,
  updateMapObjectives,
} from './map_objectives_run';

/** Sims whose rehearsal has had a live run since its bots were last cleared. */
const botsMayExist = new WeakSet<SimContext>();

/** The rehearsal's tick phase: flags and rune pads, then the practice bots. */
export function updateMapObjectivesPhase(ctx: SimContext, lap: SimConfig['perfLap']): void {
  if (!authoredMapActive()) return;
  updateMapObjectives(ctx);
  const live = objectiveRun(ctx) !== null;
  if (live) botsMayExist.add(ctx);
  if (botsMayExist.has(ctx)) {
    updateObjectiveBots(ctx);
    if (!live) botsMayExist.delete(ctx);
  }
  lap?.('mapobjectives');
}

/**
 * One key, two homes. In Ravenrift the flag key is the battleground's flag
 * action; on an authored map carrying its own flags it is the rehearsal's. The
 * two can never both be live (the rehearsal only runs for an authored
 * presentation, which the battleground band is not), so the fall-through is
 * unambiguous and no new keybind or wire command was needed (the client sends
 * the same `bg_flag`).
 */
export function routeFlagAction(ctx: SimContext, pid?: number): void {
  const target = pid ?? ctx.primaryId;
  if (bgMatchFor(ctx, target)) {
    bgFlagAction(ctx, pid);
    return;
  }
  if (mapObjectiveFlagAction(ctx, target)) return;
  bgFlagAction(ctx, pid);
}

/** The battleground's player-death hook, shared with the rehearsal: a carrier
 *  who dies drops the flag on either, and the second call is a no-op wherever
 *  the first one applies. */
export function onObjectivePlayerDeath(ctx: SimContext, e: Entity, killer: Entity | null): void {
  bgOnPlayerDeath(ctx, e, killer);
  mapObjectiveOnDeath(ctx, e);
}
