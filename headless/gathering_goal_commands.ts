// Dispatcher for the optional headless `{cmd:'gathering_goal', verb:...}`
// request family (Intentional Gathering PR4). Frozen contract:
// docs/protocols/gathering-goal.md
//
// Consumes a narrow Sim-shaped host: the exact same `gatheringGoal` getter and
// `trackGatheringRecipe`/`trackGatheringCommission`/`clearGatheringGoal`
// methods the other hosts dispatch through (`src/world_api/professions.ts`'s
// `IWorldProfessions`), never a recreated tracking/commission-authority gate.
// No `sim.tick()`, no direct `PlayerMeta` writes, no item/recipe/order grants.
//
// A track verb's Sim wrapper is not guaranteed to surface its refusal as a
// plain boolean return (the ctx-level actions in
// `src/sim/professions/gathering_goal_actions.ts` do, but the thin `Sim`
// delegate may not): a `false` return is trusted as a real refusal, but
// anything else is confirmed against the POST-command `gatheringGoal`
// identity, which is the one place tracking success is actually recorded. An
// unchanged retrack (the same recipe/count, or the same order) reads as
// success either way, since the identity comparison is against the current
// value, not a before/after diff.

import type { GatheringGoalView } from '../src/sim/professions/gathering_goal_types';
import type { Sim } from '../src/sim/sim';
import { type GatheringGoalRequest, parseGatheringGoalRequest } from './gathering_goal_protocol';

/** The Sim members gathering-goal commands need: the owner-only projection
 *  getter plus the three command bodies every other host already dispatches
 *  through. */
export type GatheringGoalSimHost = Pick<
  Sim,
  'gatheringGoal' | 'trackGatheringRecipe' | 'trackGatheringCommission' | 'clearGatheringGoal'
>;

export type GatheringGoalReply =
  | { readonly ok: true; readonly verb: 'inspect'; readonly goal: GatheringGoalView | null }
  | { readonly ok: true; readonly verb: 'track_recipe'; readonly goal: GatheringGoalView | null }
  | {
      readonly ok: true;
      readonly verb: 'track_commission';
      readonly goal: GatheringGoalView | null;
    }
  | { readonly ok: true; readonly verb: 'clear'; readonly goal: GatheringGoalView | null }
  | {
      readonly ok: false;
      readonly verb: 'track_recipe';
      readonly goal: GatheringGoalView | null;
      readonly reason: 'tracking_refused';
    }
  | {
      readonly ok: false;
      readonly verb: 'track_commission';
      readonly goal: GatheringGoalView | null;
      readonly reason: 'tracking_refused';
    }
  | { readonly ok: false; readonly reason: 'invalid_request' }
  | { readonly ok: false; readonly reason: 'reset_required' };

function goalMatchesRecipe(
  view: GatheringGoalView | null,
  recipeId: string,
  count: number,
): boolean {
  const goal = view?.goal;
  return !!goal && goal.kind === 'recipe' && goal.recipeId === recipeId && goal.count === count;
}

function goalMatchesCommission(view: GatheringGoalView | null, orderId: number): boolean {
  const goal = view?.goal;
  return !!goal && goal.kind === 'commission' && goal.orderId === orderId;
}

function inspect(sim: GatheringGoalSimHost): GatheringGoalReply {
  return { ok: true, verb: 'inspect', goal: sim.gatheringGoal };
}

function trackRecipe(
  sim: GatheringGoalSimHost,
  recipeId: string,
  count: number,
): GatheringGoalReply {
  const result = sim.trackGatheringRecipe(recipeId, count);
  const goal = sim.gatheringGoal;
  const succeeded = result === false ? false : goalMatchesRecipe(goal, recipeId, count);
  return succeeded
    ? { ok: true, verb: 'track_recipe', goal }
    : { ok: false, verb: 'track_recipe', goal, reason: 'tracking_refused' };
}

function trackCommission(sim: GatheringGoalSimHost, orderId: number): GatheringGoalReply {
  const result = sim.trackGatheringCommission(orderId);
  const goal = sim.gatheringGoal;
  const succeeded = result === false ? false : goalMatchesCommission(goal, orderId);
  return succeeded
    ? { ok: true, verb: 'track_commission', goal }
    : { ok: false, verb: 'track_commission', goal, reason: 'tracking_refused' };
}

function clear(sim: GatheringGoalSimHost): GatheringGoalReply {
  sim.clearGatheringGoal();
  return { ok: true, verb: 'clear', goal: sim.gatheringGoal };
}

function dispatch(sim: GatheringGoalSimHost, request: GatheringGoalRequest): GatheringGoalReply {
  switch (request.verb) {
    case 'inspect':
      return inspect(sim);
    case 'track_recipe':
      return trackRecipe(sim, request.recipeId, request.count);
    case 'track_commission':
      return trackCommission(sim, request.orderId);
    case 'clear':
      return clear(sim);
  }
}

/** Parse then dispatch one gathering-goal request. Parsing runs BEFORE the
 *  reset check, so a malformed request refuses `invalid_request` even
 *  pre-reset; only a well-formed request against a null (pre-reset) sim
 *  refuses `reset_required`. Never advances sim time or the episode step. */
export function executeGatheringGoalCommand(
  sim: GatheringGoalSimHost | null,
  raw: unknown,
): GatheringGoalReply {
  const parsed = parseGatheringGoalRequest(raw);
  if (!parsed.ok) return { ok: false, reason: 'invalid_request' };
  if (!sim) return { ok: false, reason: 'reset_required' };
  return dispatch(sim, parsed.request);
}
