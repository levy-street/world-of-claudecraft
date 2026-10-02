// Wire rounding for the Shardpike trial's guidance view (src/sim/lance_guidance.ts).
//
// Its own leaf rather than a helper on game.ts: a pure function of one view object, with no
// GameServer state, no clock and no rng, so a Vitest imports it directly and the broadcast
// pass stays a thin consumer (the monolith ratchet, same rule as interest_policy.ts).

import { lanceGuidanceFor } from '../src/sim/lance_guidance';
import {
  LANCE_THRUST_RANGE,
  lanceRestRemainingFor,
  lanceTrialViewFor,
} from '../src/sim/lance_trial';
import type { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { round2 } from './tick_perf_log';

/**
 * The Shardpike trial's three self keys for one session: the wielder's own beam at 20Hz
 * (null between sessions, so the delta only ships while a brace is live), the rest
 * cooldown for the bar's swirl, and the guidance the loud prompt paints (null between
 * pikes; its distance rounded, see roundLanceGuidance).
 */
export function lanceSelfWire(ctx: SimContext, pid: number) {
  return {
    lance: lanceTrialViewFor(ctx, pid),
    lrest: round2(lanceRestRemainingFor(ctx, pid)),
    lguide: roundLanceGuidance(lanceGuidanceFor(ctx, pid, LANCE_THRUST_RANGE)),
  };
}

/** Dispatch one of the three no-argument lance verbs; the beam is steered by ordinary
 *  movement intent, so there is nothing to validate beyond the token itself. */
export function runLanceVerb(
  sim: Pick<Sim, 'lanceBrace' | 'lanceThrust' | 'lanceRelease'>,
  verb: 'lance_brace' | 'lance_thrust' | 'lance_release',
  pid: number,
): void {
  if (verb === 'lance_brace') sim.lanceBrace(pid);
  else if (verb === 'lance_thrust') sim.lanceThrust(pid);
  else sim.lanceRelease(pid);
}

/**
 * Round the guidance view's target distance to whole yards.
 *
 * The raw distance moves with the player's own footsteps, so it changes every tick by a few
 * thousandths. The `maybe` delta compares JSON, so an unrounded distance makes this "changed"
 * on literally every tick of every pike-carrying session, which is the exact shape of the
 * per-tick re-ship the delta registry exists to prevent. Whole yards: the prompt says "walk
 * closer", it does not need centimetres.
 */
export function roundLanceGuidance<T extends { targetDistance: number | null }>(
  view: T | null,
): T | null {
  if (!view) return null;
  const d = view.targetDistance;
  return d === null ? view : { ...view, targetDistance: Math.round(d) };
}
