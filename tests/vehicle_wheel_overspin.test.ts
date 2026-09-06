// Wheels off the ground: an unloaded tire breaks traction and runs away from
// the speed the car was doing.
//
// The rate is taken from what the wheel was ACTUALLY turning at as it left the
// ground, not from a speed value, which is what makes reverse fall out for
// free: reverse is a slower gear, so the same multiple of a smaller number is a
// smaller lift, and backwards stays backwards.
//
// The pass adds the DIFFERENCE between the target and whatever the airborne
// clip is doing, rather than taking the channel over outright. That keeps the
// spin continuous through touchdown instead of snapping to whatever phase the
// ground clip happens to be at.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyVehicleSuspension,
  createVehicleSuspensionRig,
} from '../src/render/vehicle_suspension_fx';

const AXIS = new THREE.Vector3(1, 0, 0);
const DT = 1 / 60;
const flat = () => 0;

function build() {
  const group = new THREE.Object3D();
  const mountRoot = new THREE.Object3D();
  const riderRoot = new THREE.Object3D();
  group.add(mountRoot);
  const wheels: Record<string, THREE.Mesh> = {};
  for (const [name, x, z] of [
    ['FL', -0.5, 1],
    ['FR', 0.5, 1],
    ['RL', -0.5, -1],
    ['RR', 0.5, -1],
  ] as const) {
    const node = new THREE.Object3D();
    node.name = `Susp_${name}`;
    node.position.set(x, 0, z);
    mountRoot.add(node);
    // Rotate the GEOMETRY, not the node: the axle is read off the wheel's own
    // local mesh, which is also the frame the spin is applied in. The real
    // model bakes it the same way.
    const geom = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16).rotateZ(Math.PI / 2);
    const wheel = new THREE.Mesh(geom);
    wheel.name = `Wheel_${name}`;
    node.add(wheel);
    wheels[wheel.name] = wheel;
  }
  const rig = createVehicleSuspensionRig(mountRoot, group);
  if (!rig) throw new Error('rig');
  return { group, mountRoot, riderRoot, wheels, rig };
}

/** Signed rotation about the axle between two orientations. */
function aboutAxle(from: THREE.Quaternion, to: THREE.Quaternion): number {
  const rel = from.clone().invert().multiply(to);
  return 2 * Math.atan2(rel.x, rel.w);
}

/**
 * Drive at a given authored wheel rate, then leave the ground still driving.
 * Reports the rate the wheel ends up actually turning at while airborne.
 */
function takeOff(clipRate: number) {
  const v = build();
  const wheel = v.wheels.Wheel_RL;
  const step = new THREE.Quaternion().setFromAxisAngle(AXIS, clipRate * DT);
  // Stand in for the animation mixer, which owns this channel every frame.
  const runClip = () => wheel.quaternion.multiply(step);
  const frame = (grounded: boolean) =>
    applyVehicleSuspension(
      v.rig,
      v.group,
      v.mountRoot,
      v.riderRoot,
      1,
      0,
      grounded,
      true,
      0,
      grounded ? 0 : -8 / 60,
      flat,
      DT,
    );

  for (let i = 0; i < 60; i++) {
    runClip();
    frame(true);
  }
  const groundRate = v.rig.spinRate.rl;
  const before = wheel.quaternion.clone();
  const FRAMES = 30;
  for (let i = 0; i < FRAMES; i++) {
    runClip();
    frame(false);
  }
  return { airRate: aboutAxle(before, wheel.quaternion) / (FRAMES * DT), groundRate };
}

describe('airborne traction break', () => {
  it('reads the rate the wheel was really turning at on the ground', () => {
    expect(takeOff(6).groundRate).toBeCloseTo(6, 1);
  });

  it('spins the wheels half again as fast once they leave the ground', () => {
    expect(takeOff(6).airRate).toBeCloseTo(9, 1);
  });

  it('does the same in reverse, which being slower spins up less', () => {
    const forward = takeOff(6);
    const reverse = takeOff(-2.5);
    // Backwards stays backwards, at the same multiple.
    expect(reverse.airRate).toBeCloseTo(-3.75, 1);
    // And the LIFT is smaller, because the gear it lifts from is slower.
    expect(Math.abs(reverse.airRate - reverse.groundRate)).toBeLessThan(
      Math.abs(forward.airRate - forward.groundRate),
    );
  });

  it('leaves a parked wheel alone in the air', () => {
    // Jumping from a standstill: nothing was turning, so nothing spins up.
    expect(takeOff(0).airRate).toBeCloseTo(0, 6);
  });
});
