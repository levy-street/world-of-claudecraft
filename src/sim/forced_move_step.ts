// The step gate shared by the two forced player movers, warrior Charge
// (`Sim.updateChargeMovement`) and /follow (`Sim.updateFollowMovement`). Both
// carried the same inline block; it moved here whole when the Studio merge grew
// src/sim/sim.ts past its monolith ceiling. A MOVE, not a rewrite: the same
// height samples, the same conjunct order, and the one difference between the
// two callers (follow ignores a sub-1e-5 step when judging slope) is the
// `gateTinySteps` flag. Pure: reads terrain, draws no rng, mutates nothing.
//
// Deep water and cliffs end the forced move rather than dragging the player in;
// slopes use the ridden surface (ride_height.ts) plus the shore step-out,
// matching the movement kernel and the clamp findChargePath already plans
// with, so a wading-depth ford never ends a charge and a follower crosses the
// same fords and climbs the same low banks its leader just walked.
// forcedMoveGroundHeight: on an authored map the mover runs along whatever
// sheet the body is on (tube floor, carve floor or the surface), including
// through cave mouths and carved tunnels, and that sheet's own walls stop it.

import { forcedMoveGroundHeight } from './forced_move_ground';
import { PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from './pathfind';
import { rideSteepnessAt, shoreStepOut, stepWaterLevel } from './ride_height';
import type { Vec3 } from './types';
import { onUnderSheet, sheetMouthStepOk, sheetWallBlocksStep, waterLevelAt } from './world';

// Rise/run above which ground is unwalkable (cliffs, mountain walls, the world
// rim). Uphill steps are blocked both along the step direction AND by the true
// terrain steepness at the destination (terrainSteepness), so a diagonal
// switchback cannot beat the limit; airborne movement is gated the same way so
// jump-spam cannot climb a face; and a player standing on ground steeper than
// this slides downhill (STEEP_SLIDE_SPEED) and cannot jump until footing is
// walkable again.
const MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE;
const SWIM_DEPTH = PLAYER_SWIM_DEPTH; // ground this far under the water line = deep water

/**
 * True when a forced step from `pos` to (nx, nz) of length `step` must not be
 * taken: the destination is deep water, or an unclimbable rise, or a sheet wall.
 * `gateTinySteps` is /follow's arm: a rise only blocks when the step is longer
 * than 1e-5 yd.
 */
export function forcedStepBlocked(
  seed: number,
  pos: Vec3,
  nx: number,
  nz: number,
  step: number,
  gateTinySteps: boolean,
): boolean {
  const h1 = forcedMoveGroundHeight(nx, nz, seed, pos.y);
  if (h1 < waterLevelAt(nx, nz, seed) - SWIM_DEPTH) return true;
  const wls = stepWaterLevel(pos.x, pos.z, nx, nz, seed);
  const r0 = Math.max(forcedMoveGroundHeight(pos.x, pos.z, seed, pos.y), wls);
  const r1 = Math.max(h1, wls);
  return (
    (r1 > r0 &&
      (!gateTinySteps || step > 1e-5) &&
      ((r1 - r0) / step > MAX_CLIMB_SLOPE ||
        (h1 >= wls &&
          !onUnderSheet(nx, nz, seed, pos.y) &&
          rideSteepnessAt(nx, nz, seed) > MAX_CLIMB_SLOPE)) &&
      !shoreStepOut(pos.x, pos.z, nx, nz, seed, MAX_CLIMB_SLOPE) &&
      !sheetMouthStepOk(seed, pos.x, pos.z, pos.y, nx, nz, r0, r1)) ||
    sheetWallBlocksStep(seed, pos.x, pos.z, pos.y, nx, nz)
  );
}
