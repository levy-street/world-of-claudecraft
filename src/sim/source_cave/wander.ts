// Contributor idle wander: idle cave mobs amble a few steps around their own
// ring seat instead of standing frozen, BOTH before the reboot (friendly
// roster) and after it (hostile but unengaged), per user decision. The leash
// radius stays well under the ring spacing (SOURCE_CAVE_MOB_MIN_DIST, spec.ts)
// so the concentric-ring silhouette never dissolves even while hostile.
//
// Determinism: draws ctx.rng exactly like the generic idle wander (one range()
// per pause, two per new target). Cave mobs exist only inside a claimed
// instance, so these draws never occur in a world without a claimed cave slot.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';

// Pause length between ambles, copied from the generic idle wander's re-pause
// draw (mob/locomotion.ts rng.range(3, 10)).
const WANDER_PAUSE_MIN = 3;
const WANDER_PAUSE_MAX = 10;
// Amble leash around the mob's ring seat: far enough to read as alive, and at
// most half the SOURCE_CAVE_MOB_MIN_DIST (6) floor so two neighbors drifting
// toward each other can never overlap.
export const SOURCE_CAVE_WANDER_RADIUS_MIN = 1;
export const SOURCE_CAVE_WANDER_RADIUS_MAX = 3;
// The generic idle-wander amble speed factor (mob/locomotion.ts).
const WANDER_SPEED_MULT = 0.35;

/**
 * One idle tick of an unengaged cave mob (friendly or rebooted-hostile): amble
 * a short step around its own spawn seat, mirroring the generic idle-wander
 * state machine shape.
 */
export function updateSourceCaveIdleWander(ctx: SimContext, mob: Entity): void {
  mob.wanderTimer -= DT;
  if (mob.wanderTimer <= 0) {
    if (mob.wanderTarget) {
      mob.wanderTarget = null;
      mob.wanderTimer = ctx.rng.range(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
    } else {
      const ang = ctx.rng.range(0, Math.PI * 2);
      const r = ctx.rng.range(SOURCE_CAVE_WANDER_RADIUS_MIN, SOURCE_CAVE_WANDER_RADIUS_MAX);
      mob.wanderTarget = ctx.groundPos(
        mob.spawnPos.x + Math.sin(ang) * r,
        mob.spawnPos.z + Math.cos(ang) * r,
      );
      mob.wanderTimer = 30;
    }
  }
  if (mob.wanderTarget) {
    const arrived = ctx.moveToward(mob, mob.wanderTarget, mob.moveSpeed * WANDER_SPEED_MULT);
    if (arrived) {
      mob.wanderTarget = null;
      mob.wanderTimer = ctx.rng.range(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
    }
  }
}
