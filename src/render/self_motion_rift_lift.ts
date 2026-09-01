// The raised-tier Y lift the server applies inside a rift, for the display-only
// self-motion predictor (self_motion.ts). Mirrors the exact strip/reapply pair
// Sim.updatePlayerMovement and updateRiftTriggers run around the movement kernel
// each tick (src/sim/rift/runs.ts riftPlayerLift, generateRiftFloor + riftLiftAt),
// using the same pure generator so the predicted pose stands on a platform or
// follows a ramp exactly where the server places the player.
//
// Pure and Node-testable: no Three, no DOM, like self_motion.ts itself.

import { isRiftPos, RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z } from '../sim/data';
import { generateRiftFloor, riftLiftAt } from '../sim/rift/rift_gen';
import type { RiftFloorPlan } from '../sim/rift/types';
import type { RiftFloorView } from '../world_api/dungeons';

/** Resolve the descriptor into the same cached RiftFloorPlan generateRiftFloor
 *  hands the server, ONCE per predictor step() call. A step touches the lift
 *  up to six times (strip/reapply the working actor, the anchor, the history
 *  sample); generateRiftFloor's own cache is a Map keyed by an allocated
 *  template-literal string plus (with an upgrade) a WeakMap hop, so resolving
 *  once and threading the plan through riftLiftFor avoids paying that key
 *  allocation repeatedly for what is always the same descriptor within one
 *  frame. Null outside a rift. */
export function resolvedRiftFloorPlan(riftFloor: RiftFloorView | null): RiftFloorPlan | null {
  if (!riftFloor) return null;
  return generateRiftFloor(
    riftFloor.seed,
    riftFloor.baseLevel,
    riftFloor.floorIndex,
    riftFloor.upgrade,
  );
}

/** 0 outside a rift (plan null) or off the mirrored floor's band, else the
 *  raised-tier lift at (x, z) local to `origin`. The containment check
 *  mirrors riftRegionAt (src/sim/colliders.ts) and the server's own
 *  riftPlayerLift (src/sim/rift/runs.ts, gated through riftInstanceAtPos):
 *  defensive, since the local player is never off the mirrored floor's
 *  region while a plan is resolved in practice (floor transitions are server
 *  teleports that always ship a paired riftState event first), but it keeps
 *  this mirror shape-equivalent to what it mirrors, not merely correct for
 *  the one position it happens to be called at today. */
export function riftLiftFor(
  plan: RiftFloorPlan | null,
  origin: { x: number; z: number },
  x: number,
  z: number,
): number {
  if (!plan || !isRiftPos(x)) return 0;
  const localX = x - origin.x;
  const localZ = z - origin.z;
  if (Math.abs(localX) > RIFT_REGION_HALF_X || Math.abs(localZ) > RIFT_REGION_HALF_Z) return 0;
  return riftLiftAt(plan, localX, localZ);
}
