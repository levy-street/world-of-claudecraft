import { DT } from '../types';
import { COURIER_SPEED, type CourierState } from './types';

export const COURIER_GROUND_SPEED = 7;
export const COURIER_GROUND_DISTANCE = 3;
export const COURIER_FLIGHT_DISTANCE = 8;

/** Shared authoritative speed and visual lift profile for both ends of each leg. */
export function courierFlightBlend(travelDistance: number, remainingDistance: number): number {
  const distance = Math.min(travelDistance, remainingDistance);
  const t = Math.max(
    0,
    Math.min(
      1,
      (distance - COURIER_GROUND_DISTANCE) / (COURIER_FLIGHT_DISTANCE - COURIER_GROUND_DISTANCE),
    ),
  );
  return t * t * (3 - 2 * t);
}

export function courierTravelSpeed(travelDistance: number, remainingDistance: number): number {
  return (
    COURIER_GROUND_SPEED +
    (COURIER_SPEED - COURIER_GROUND_SPEED) * courierFlightBlend(travelDistance, remainingDistance)
  );
}

/** One straight XZ step. No obstacles, terrain queries or pathfinding redirect flight. */
export function travelCourier(state: CourierState, x: number, z: number, journey = true): boolean {
  const dx = x - state.x;
  const dz = z - state.z;
  const distance = Math.hypot(dx, dz);
  const speed = journey ? courierTravelSpeed(state.travelDistance, distance) : COURIER_GROUND_SPEED;
  const step = Math.min(distance, speed * DT);
  if (journey)
    state.travelDistance = Math.min(COURIER_FLIGHT_DISTANCE, state.travelDistance + step);
  if (distance <= step) {
    state.x = x;
    state.z = z;
    return true;
  }
  state.x += (dx / distance) * step;
  state.z += (dz / distance) * step;
  return false;
}
