import { DT } from '../types';
import type { CourierState } from './types';

export const COURIER_LEG_SECONDS = 10;
export const COURIER_LEG_TICKS = COURIER_LEG_SECONDS / DT;
export const COURIER_RAMP_SECONDS = 2;
export const COURIER_GROUND_SECONDS = 0.6;
export const COURIER_GROUND_SPEED = 7;
// Retained for older wire poses and saves during a rolling deployment.
export const COURIER_GROUND_DISTANCE = 3;
export const COURIER_FLIGHT_DISTANCE = 8;

function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** Compatibility for a server that still publishes distance-based poses. */
export function courierFlightBlend(travelDistance: number, remainingDistance: number): number {
  return smoothstep(
    (Math.min(travelDistance, remainingDistance) - COURIER_GROUND_DISTANCE) /
      (COURIER_FLIGHT_DISTANCE - COURIER_GROUND_DISTANCE),
  );
}

/** Ground run, takeoff, cruise, landing and ground run use authoritative leg time. */
export function courierTimedFlightBlend(ticks: number): number {
  const seconds = Math.max(0, Math.min(COURIER_LEG_SECONDS, ticks * DT));
  const edge = Math.min(seconds, COURIER_LEG_SECONDS - seconds);
  return smoothstep(
    (edge - COURIER_GROUND_SECONDS) / (COURIER_RAMP_SECONDS - COURIER_GROUND_SECONDS),
  );
}

/** Integral of smoothstep acceleration, constant cruise and symmetric braking.
 * Its total area is eight seconds, so each leg arrives at tick 200 at any distance. */
export function courierLegProgress(ticks: number): number {
  const seconds = Math.max(0, Math.min(COURIER_LEG_SECONDS, ticks * DT));
  if (seconds > COURIER_LEG_SECONDS / 2)
    return 1 - courierLegProgress((COURIER_LEG_SECONDS - seconds) / DT);
  const ramp = COURIER_RAMP_SECONDS;
  const u = seconds / ramp;
  const area = seconds < ramp ? ramp * (u * u * u - 0.5 * u * u * u * u) : seconds - ramp / 2;
  return area / (COURIER_LEG_SECONDS - ramp);
}

export function startCourierLeg(state: CourierState): void {
  state.travelTicks = 0;
  state.legStartX = state.x;
  state.legStartZ = state.z;
  state.travelDistance = 0;
}

/** Fixed-start interpolation keeps a stationary destination's path straight.
 * The returning endpoint follows the current owner without extending the deadline. */
export function travelCourier(state: CourierState, x: number, z: number, journey = true): boolean {
  if (journey) {
    if (
      state.travelTicks === undefined ||
      state.legStartX === undefined ||
      state.legStartZ === undefined
    )
      startCourierLeg(state);
    state.travelTicks = Math.min(COURIER_LEG_TICKS, state.travelTicks! + 1);
    const progress = courierLegProgress(state.travelTicks);
    state.x = state.legStartX! + (x - state.legStartX!) * progress;
    state.z = state.legStartZ! + (z - state.legStartZ!) * progress;
    state.travelDistance = Math.min(
      COURIER_FLIGHT_DISTANCE,
      Math.hypot(state.x - state.legStartX!, state.z - state.legStartZ!),
    );
    if (state.travelTicks === COURIER_LEG_TICKS) {
      state.x = x;
      state.z = z;
      return true;
    }
    return false;
  }
  const dx = x - state.x;
  const dz = z - state.z;
  const distance = Math.hypot(dx, dz);
  const step = Math.min(distance, COURIER_GROUND_SPEED * DT);
  if (distance <= step) {
    state.x = x;
    state.z = z;
    return true;
  }
  state.x += (dx / distance) * step;
  state.z += (dz / distance) * step;
  return false;
}
