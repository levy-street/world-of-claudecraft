// The chase camera's floor: the lowest the camera may stand over the world at (x, z). The
// renderer's updateCamera lifts its one pose to this (Math.max with the orbit's height), so
// the camera never sinks into what the player stands on. Three-, DOM- and i18n-free.
//
//  - the ground (groundHeight: the terrain and every walk lift folded into it), a hand over;
//  - on a raised Rift tier, the same lift the sim stands entities on (a flat ground clamp
//    alone would let the camera sink into the riser);
//  - over the Great Maze's modeled hedges, which are not terrain: the camera rides over
//    their leaves the way the old terrain walls lifted it (garden_maze_core.ts).
//
// An authored map reads its own ground under the boom (authored_map/chase_boom_core.ts) and
// adds the same lifts (chaseCameraFloorLift). Interiors keep their own clamp
// (interior_camera.ts): this is only the floor.

import { isRiftPos } from '../sim/data';
import { generateRiftFloor, riftLiftAt } from '../sim/rift/rift_gen';
import { groundHeight } from '../sim/world';
import type { RiftFloorView } from '../world_api/dungeons';
import { gardenMazeCameraLift } from './garden_maze_core';

/** How far over the ground the camera's floor stands. */
export const CHASE_CAMERA_GROUND_CLEARANCE = 0.6;

/** What lifts the camera's floor over the ground at world (x, z): a raised Rift tier and
 *  the Great Maze's hedges. */
export function chaseCameraFloorLift(
  x: number,
  z: number,
  riftFloor: RiftFloorView | null,
): number {
  let lift = 0;
  if (riftFloor && isRiftPos(x)) {
    const r = riftFloor;
    const floor = generateRiftFloor(r.seed, r.baseLevel, r.floorIndex, r.upgrade);
    lift += riftLiftAt(floor, x - r.origin.x, z - r.origin.z);
  }
  return lift + gardenMazeCameraLift(x, z);
}

/** The camera's floor at world (x, z) on the built-in world: the ground a hand over, lifted
 *  over a raised Rift tier and the Great Maze's hedges. */
export function chaseCameraFloorY(
  x: number,
  z: number,
  seed: number,
  riftFloor: RiftFloorView | null,
): number {
  return (
    groundHeight(x, z, seed) + CHASE_CAMERA_GROUND_CLEARANCE + chaseCameraFloorLift(x, z, riftFloor)
  );
}
