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
import { finishBloodhook } from './hunter_fieldcraft';

/** A charge runs at this multiple of normal run speed. */
export const CHARGE_SPEED_MULT = 3;
/** The route has arrived once the runner is this close: inside melee range. */
export const CHARGE_ARRIVE_RANGE = MELEE_RANGE - 1;

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
}
