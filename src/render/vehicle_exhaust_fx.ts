// The Three side of piped exhaust: turn the measured port offsets into world
// positions and hand them to the particle pool at the rate the engine phase
// asks for. `vehicle_exhaust_core` owns every decision; this owns the scene
// graph and nothing else.
//
// The ports are resolved through the CHASSIS matrix, not from the entity's
// position and yaw. That matters more than it sounds: the body now pitches,
// rolls and squats, so smoke placed by yaw alone would visibly detach from the
// pipes on every landing, which is exactly the moment a rider is looking at the
// back of the car.

import type * as THREE from 'three';
import {
  type ExhaustPhase,
  type ExhaustPort,
  exhaustFlameDue,
  exhaustFlameRearms,
  exhaustSmokeRate,
} from './vehicle_exhaust_core';
import type { Vfx } from './vfx';

/** Per-view exhaust state: just the flame's one-per-launch latch. */
export interface VehicleExhaustState {
  flameFired: boolean;
}

export function createVehicleExhaust(): VehicleExhaustState {
  return { flameFired: false };
}

// Reused across frames and entities: this runs inside the per-entity loop.
const portWorld: THREE.Vector3[] = [];
let tmpBack: THREE.Vector3 | null = null;
const weights: number[] = [];

export interface VehicleExhaustInput {
  chassis: THREE.Object3D;
  /** +1 when the model's front is toward +z, so the pipes vent toward -z. */
  frontSign: number;
  ports: readonly ExhaustPort[];
  phase: ExhaustPhase;
  /** Seconds since that phase began, on the audio clock. */
  elapsed: number;
  reversing: boolean;
  pivoting: boolean;
  vfx: Vfx;
  dt: number;
}

/**
 * One frame of exhaust.
 *
 * Call after the suspension pass, so the chassis matrix already carries this
 * frame's attitude.
 */
export function applyVehicleExhaust(state: VehicleExhaustState, input: VehicleExhaustInput): void {
  const { chassis, ports, vfx } = input;
  if (ports.length === 0) return;

  // Grow the scratch arrays once, then reuse. THREE is imported as a type only
  // here, so the vectors are cloned off one the caller's chassis already owns.
  while (portWorld.length < ports.length) portWorld.push(chassis.position.clone());
  if (!tmpBack) tmpBack = chassis.position.clone();

  chassis.updateWorldMatrix(true, false);
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    portWorld[i].set(p.x, p.y, p.z);
    chassis.localToWorld(portWorld[i]);
    weights[i] = p.weight;
  }
  weights.length = ports.length;
  const back = tmpBack;
  // Out of the pipes is the car's rear, in world space, tilt and all.
  back.set(0, 0, -input.frontSign).transformDirection(chassis.matrixWorld).normalize();

  const live = portWorld.slice(0, ports.length);
  vfx.mountPipeExhaust(
    live,
    weights,
    back,
    exhaustSmokeRate(input.phase, input.reversing, input.pivoting),
    input.dt,
  );

  // The launch flame, pinned to the transient inside the windup take.
  if (exhaustFlameRearms(input.phase)) state.flameFired = false;
  if (exhaustFlameDue(input.phase, input.elapsed, state.flameFired)) {
    state.flameFired = true;
    vfx.mountPipeFlame(live, back);
  }
}
