// Intentional Gathering PR4 (docs/prd/intentional-gathering/goal-projection-
// contract.md): pure boundary validators for the three gathering-goal wire
// commands (server/CLAUDE.md, "New WS/loop-side behavior": pure decision
// logic behind a host-agnostic module, never inline in game.ts's dispatch
// switch, the corpse_harvest_commands.ts precedent). `pid` always comes from
// the caller's authenticated session, never the payload; a malformed frame
// refuses without ever reaching the sim, so no partial or forged goal can be
// written. Reuses the sim's own bound checks (gathering_goal_persist.ts)
// rather than a second copy of the count/order-id rules.
//
// Every validator is EXACT-KEYS over the real transport envelope: ClientWorld's
// rawCmd always sends `{t:'cmd', cmd, ...payload}`, and a command sent through
// the correlated request path (cmdWithOutcome/WorldInteractionRequests) also
// carries `rid` (a positive safe integer echoed back on `commandOutcome`).
// Both `t`/`cmd` (always present) and `rid` (present only when the sender
// used the correlated path) are tolerated; any OTHER key -- most pointedly a
// client-supplied `pid` or a `recipe` override riding a commission frame -- is
// rejected outright, since exact-key checking is the only way a forged
// passenger field can never silently reach the sim.

import {
  validGatheringGoalCount,
  validGatheringGoalOrderId,
} from '../src/sim/professions/gathering_goal_persist';

// Printable, bounded id shape only (the boundary's job), byte-identical to
// gathering_goal_persist.ts's private `recipeId` matcher; WHETHER the id names
// a real, known, learned recipe is a domain question the sim re-validates
// itself (gathering_goal_actions.ts trackGatheringRecipe), the same split
// corpse_harvest_commands.ts draws between shape and sim-side eligibility.
const RECIPE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function isRecipeIdShape(value: unknown): value is string {
  return typeof value === 'string' && RECIPE_ID_PATTERN.test(value);
}

// The real wire envelope every dispatched frame carries: `t`/`cmd` always,
// `rid` only when sent through the correlated request path. Any key beyond
// this set plus a command's own declared payload fields is a forged or
// malformed passenger and refuses the whole frame.
const TRANSPORT_ENVELOPE_KEYS: ReadonlySet<string> = new Set(['t', 'cmd', 'rid']);

function hasOnlyKnownKeys(msg: object, payloadKeys: readonly string[]): boolean {
  const allowed = new Set<string>([...TRANSPORT_ENVELOPE_KEYS, ...payloadKeys]);
  return Object.keys(msg).every((key) => allowed.has(key));
}

export interface TrackGatheringRecipePayload extends Readonly<Record<string, unknown>> {
  readonly recipe?: unknown;
  readonly count?: unknown;
}

export function validTrackGatheringRecipeCommand(
  msg: TrackGatheringRecipePayload,
): msg is { readonly recipe: string; readonly count: number } {
  if (!hasOnlyKnownKeys(msg, ['recipe', 'count'])) return false;
  return isRecipeIdShape(msg.recipe) && validGatheringGoalCount(msg.count);
}

export interface TrackGatheringCommissionPayload extends Readonly<Record<string, unknown>> {
  readonly order?: unknown;
}

export function validTrackGatheringCommissionCommand(
  msg: TrackGatheringCommissionPayload,
): msg is { readonly order: number } {
  if (!hasOnlyKnownKeys(msg, ['order'])) return false;
  return validGatheringGoalOrderId(msg.order);
}

export function validClearGatheringGoalCommand(msg: Readonly<Record<string, unknown>>): boolean {
  return hasOnlyKnownKeys(msg, []);
}

/** No-op (never mutates the goal) on a malformed frame, exactly like the sim's
 *  own refusal arms; there is no outcome ack on this command (the setHarvestPreference
 *  precedent), so the result surfaces solely through the ggoal self-delta or a
 *  refusal error line. Takes only the one method it needs (never the combined
 *  gathering-goal surface), so a test fake providing just this method typechecks. */
export function trackGatheringRecipeCommandOutcome(
  sim: { trackGatheringRecipe(recipeId: string, count: number, pid?: number): boolean },
  msg: Readonly<Record<string, unknown>>,
  pid: number,
): boolean {
  return (
    validTrackGatheringRecipeCommand(msg) && sim.trackGatheringRecipe(msg.recipe, msg.count, pid)
  );
}

export function trackGatheringCommissionCommandOutcome(
  sim: { trackGatheringCommission(orderId: number, pid?: number): boolean },
  msg: Readonly<Record<string, unknown>>,
  pid: number,
): boolean {
  return validTrackGatheringCommissionCommand(msg) && sim.trackGatheringCommission(msg.order, pid);
}

export function clearGatheringGoalCommandOutcome(
  sim: { clearGatheringGoal(pid?: number): void },
  msg: Readonly<Record<string, unknown>>,
  pid: number,
): boolean {
  if (!validClearGatheringGoalCommand(msg)) return false;
  sim.clearGatheringGoal(pid);
  return true;
}

interface GatheringGoalSim {
  trackGatheringRecipe(recipeId: string, count: number, pid?: number): boolean;
  trackGatheringCommission(orderId: number, pid?: number): boolean;
  clearGatheringGoal(pid?: number): void;
}

/** Folds the three gathering-goal command bodies behind one call so game.ts's
 *  switch keeps all three case labels (the command-schema suite scans them)
 *  but grows only one dispatch line, not three. `cmd` is the frame's own
 *  `msg.cmd` discriminant, already narrowed to one of these three labels by
 *  the caller's case block. */
export function dispatchGatheringGoalCommand(
  sim: GatheringGoalSim,
  cmd: 'track_gathering_recipe' | 'track_gathering_commission' | 'clear_gathering_goal',
  msg: Readonly<Record<string, unknown>>,
  pid: number,
): boolean {
  switch (cmd) {
    case 'track_gathering_recipe':
      return trackGatheringRecipeCommandOutcome(sim, msg, pid);
    case 'track_gathering_commission':
      return trackGatheringCommissionCommandOutcome(sim, msg, pid);
    case 'clear_gathering_goal':
      return clearGatheringGoalCommandOutcome(sim, msg, pid);
  }
}
