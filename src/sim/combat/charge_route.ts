// The charge route's shared numbers and its settle hook. The mover itself
// (sim.ts updateChargeMovement) owns the per-tick steering; what lives here
// is what a charge RIDER needs: the speed and arrive range the route runs at,
// and the one call the mover makes when a route ends so every rider that
// parks work on the route (Bloodhook's wound, Lunge's strike, a cooldown
// handed back when the route ends short) settles in one place. A new rider is
// one line in finishChargeArrival, never a second call in the mover.
import type { SimContext } from '../sim_context';
import { type Entity, MELEE_RANGE } from '../types';
import { finishLunge } from './druid_lunge';
import { finishBruinRush } from './druid_rush_window';
import { finishBloodhook } from './hunter_fieldcraft';
import { targetBodyRadius } from './player_attack_reach';

/** A charge runs at this multiple of normal run speed. */
export const CHARGE_SPEED_MULT = 3;
/** The route has arrived once the runner is this close: inside melee range. */
export const CHARGE_ARRIVE_RANGE = MELEE_RANGE - 1;

/** How near (pivot to pivot) the runner has arrived at `target`: inside melee
 *  range of its body's edge, so a towering body (the Guardian of the Heat
 *  behind its lip wall, 13.5 yd) is reached at its edge instead of the run
 *  grinding into the wall until its budget runs out (Jose's playtest of
 *  2026-11-24). Body-less targets keep CHARGE_ARRIVE_RANGE. */
export function chargeArriveRange(target: Entity): number {
  return CHARGE_ARRIVE_RANGE + targetBodyRadius(target);
}

/** The mover's settle call: `arrived` is true when the runner reached the
 *  target, false when the route ended short (the target died or ran out the
 *  3 sec budget, the runner was rooted, deep water or a cliff cut it off). */
export function finishChargeArrival(
  ctx: SimContext,
  runner: Entity,
  target: Entity | null,
  arrived: boolean,
): void {
  finishBloodhook(ctx, runner, target, arrived);
  finishLunge(ctx, runner, target, arrived);
  finishBruinRush(ctx, runner, target);
}
