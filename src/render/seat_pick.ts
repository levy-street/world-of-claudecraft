// The pointer's seat pick (the ray test is seat_pick_core.ts): a screen point through the
// live camera against the active world's seats. Called on a click and on the hover
// cursor's own re-pick cadence, never per frame.

import * as THREE from 'three';
import { activeSeats } from '../sim/seat_registry';
import { pickSeatOnRay, type SeatRayHit } from './seat_pick_core';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** The seat under a screen point, or null. `width`/`height` are the canvas's CSS size.
 *  `maxT` bounds the reach (a seat behind a wall is still behind it: the caller only asks
 *  when no entity was hit, and the tavern's seats are only reachable from inside). */
export function pickSeatAt(
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  maxT = 60,
): SeatRayHit | null {
  const seats = activeSeats();
  if (seats.length === 0 || width <= 0 || height <= 0) return null;
  ndc.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const { origin, direction } = raycaster.ray;
  return pickSeatOnRay(
    seats,
    origin.x,
    origin.y,
    origin.z,
    direction.x,
    direction.y,
    direction.z,
    maxT,
  );
}
