// The pure cores behind Old Thatchgrin's phase-3 visuals: the rain of pumpkins
// (fallWindow, fallPoint, fallOrigin), the Swelling Gourd's growth and throb
// (swellScale, swellThrob, swellGlow), and the broom rider's two-bone hand reach
// (ride_grip_ik.ts reachArm / applyRideGrip).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyRideGrip, reachArm } from '../src/render/characters/ride_grip_ik';
import {
  FALL_HEIGHT,
  FALL_SEC,
  FALL_SLANT,
  fallOrigin,
  fallPoint,
  fallWindow,
  SWELL_RISE_SEC,
  swellGlow,
  swellScale,
  swellThrob,
} from '../src/render/scarecrow_fx_core';

describe('the rain of pumpkins', () => {
  it('shows each pumpkin for its last FALL_SEC, never before its ring', () => {
    expect(fallWindow(10, 2)).toEqual({ start: 12 - FALL_SEC, end: 12 });
    // a landing sooner than the fall: it appears with the ring
    const quick = fallWindow(10, 0.3);
    expect(quick.start).toBe(10);
    expect(quick.end).toBeCloseTo(10.3, 6);
    // a degenerate landing still gets a visible sliver
    expect(fallWindow(10, 0).end).toBeCloseTo(10.05, 6);
  });

  it('drops along a straight slant that ends on the ring, accelerating', () => {
    const from = { x: 0, y: 26, z: 0 };
    const to = { x: 7, y: 0, z: 0 };
    expect(fallPoint(from, to, 0)).toEqual(from);
    expect(fallPoint(from, to, 1)).toEqual(to);
    // clamped outside 0..1
    expect(fallPoint(from, to, -1)).toEqual(from);
    expect(fallPoint(from, to, 2)).toEqual(to);
    // slower first half than second (accelerating)
    const half = fallPoint(from, to, 0.5);
    expect(half.x).toBeLessThan(3.5);
    expect(half.y).toBeGreaterThan(13);
  });

  it('starts every fall overhead, slanted, the same on every client', () => {
    const o = fallOrigin(12, 3, -40);
    expect(o.y).toBe(3 + FALL_HEIGHT);
    expect(Math.hypot(o.x - 12, o.z + 40)).toBeCloseTo(FALL_SLANT, 6);
    expect(fallOrigin(12, 3, -40)).toEqual(o);
    expect(fallOrigin(13, 3, -40)).not.toEqual(o);
  });
});

describe('the Swelling Gourd', () => {
  it('heaves up from small, then swells as it ripens', () => {
    expect(swellScale(0, 0, 0)).toBeCloseTo(0.2, 6);
    const risen = swellScale(0, SWELL_RISE_SEC, 0);
    expect(risen).toBeCloseTo(1, 6);
    // steady growth, no throb, through the first three quarters
    expect(swellScale(0.5, 5, 0.123)).toBeGreaterThan(risen);
    expect(swellScale(0.7, 5, 0.123)).toBeGreaterThan(swellScale(0.5, 5, 0.123));
  });

  it('throbs only in the last quarter, faster and harder as the fuse runs out', () => {
    for (const t of [0, 0.1, 0.37, 1.9]) {
      expect(swellThrob(0.5, t)).toBe(0);
      expect(swellThrob(0.75, t)).toBe(0);
    }
    // its amplitude follows how late the fuse is
    const peak = (p: number) => {
      let m = 0;
      for (let i = 0; i < 400; i++) m = Math.max(m, Math.abs(swellThrob(p, i / 400)));
      return m;
    };
    expect(peak(0.85)).toBeLessThan(peak(0.99));
    expect(peak(0.99)).toBeLessThanOrEqual(1);
  });

  it('glows from a low ember to a blaze, always 0..1', () => {
    expect(swellGlow(0, 0)).toBeCloseTo(0.3, 6);
    expect(swellGlow(1, 0)).toBeCloseTo(0.9, 6);
    for (let i = 0; i <= 20; i++) {
      const g = swellGlow(i / 20, i * 0.071);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});

/** A two-bone arm: shoulder at the origin, an upper arm and a forearm of 1 each,
 *  pointing straight down +Y-negative, under a root. */
function arm(root: THREE.Object3D, x: number): [THREE.Bone, THREE.Bone, THREE.Bone] {
  const upper = new THREE.Bone();
  upper.position.set(x, 2, 0);
  const fore = new THREE.Bone();
  fore.position.set(0, -1, 0);
  const hand = new THREE.Bone();
  hand.position.set(0, -1, 0);
  root.add(upper);
  upper.add(fore);
  fore.add(hand);
  return [upper, fore, hand];
}

describe('hands on the handle (ride_grip_ik)', () => {
  it('puts the hand on a reachable grip, the limb lengths unchanged', () => {
    const root = new THREE.Object3D();
    const [u, f, h] = arm(root, 0);
    root.updateMatrixWorld(true);
    const target = new THREE.Vector3(0.6, 1.2, 1.1);
    reachArm(u, f, h, target, new THREE.Quaternion(), 1, 1);
    root.updateMatrixWorld(true);
    const at = h.getWorldPosition(new THREE.Vector3());
    expect(at.distanceTo(target)).toBeLessThan(1e-3);
    const s = u.getWorldPosition(new THREE.Vector3());
    const e = f.getWorldPosition(new THREE.Vector3());
    expect(s.distanceTo(e)).toBeCloseTo(1, 5);
    expect(e.distanceTo(at)).toBeCloseTo(1, 5);
  });

  it('reaches as far as it can toward a grip out of reach, never stretching', () => {
    const root = new THREE.Object3D();
    const [u, f, h] = arm(root, 0);
    root.updateMatrixWorld(true);
    reachArm(u, f, h, new THREE.Vector3(0, 2, 5), new THREE.Quaternion(), 1, 1);
    root.updateMatrixWorld(true);
    const at = h.getWorldPosition(new THREE.Vector3());
    expect(at.z).toBeGreaterThan(1.9);
    expect(at.distanceTo(new THREE.Vector3(0, 2, 0))).toBeLessThanOrEqual(2);
  });

  it('a zero blend moves nothing, and a frozen rig is left alone', () => {
    const root = new THREE.Object3D();
    const left = arm(root, 0.3);
    const right = arm(root, -0.3);
    root.updateMatrixWorld(true);
    const before = left[2].getWorldPosition(new THREE.Vector3());
    const grip = { forward: 1, up: 1.2, stagger: 0.2 };
    applyRideGrip(root, [...left, ...right], grip, 0);
    root.updateMatrixWorld(true);
    expect(left[2].getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-9);
    root.matrixWorldAutoUpdate = false;
    applyRideGrip(root, [...left, ...right], grip, 1);
    expect(left[0].quaternion.equals(new THREE.Quaternion())).toBe(true);
  });
});
