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
// Interiors keep their own clamp (interior_camera.ts): this is only the floor.

import { isRiftPos } from '../sim/data';
import { generateRiftFloor, riftLiftAt } from '../sim/rift/rift_gen';
import { groundHeight } from '../sim/world';
import type { RiftFloorView } from '../world_api/dungeons';
import { gardenMazeCameraLift } from './garden_maze_core';

/** How far over the ground the camera's floor stands. */
export const CHASE_CAMERA_GROUND_CLEARANCE = 0.6;

/** The camera's floor at world (x, z): the ground a hand over, lifted over a raised Rift
 *  tier and the Great Maze's hedges. */
export function chaseCameraFloorY(
  x: number,
  z: number,
  seed: number,
  riftFloor: RiftFloorView | null,
): number {
  let y = groundHeight(x, z, seed) + CHASE_CAMERA_GROUND_CLEARANCE;
  if (riftFloor && isRiftPos(x)) {
    const r = riftFloor;
    const floor = generateRiftFloor(r.seed, r.baseLevel, r.floorIndex, r.upgrade);
    y += riftLiftAt(floor, x - r.origin.x, z - r.origin.z);
  }
  return y + gardenMazeCameraLift(x, z);
}
