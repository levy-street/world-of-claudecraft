// The rider's straddle (src/render/characters/ride_pose.ts + CharacterVisual.applyRidePose):
// bones are AIMED at pelvis-frame directions, so the pose is right on every rig's rest frame.
// The regression it pins: absolute rotations built off the KayKit leg rest twisted the WOC
// bodies' legs a half turn, hinging the knees forward and turning the feet backwards.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  aimBone,
  limbDirection,
  reinArmDirections,
  rideLegDirections,
} from '../src/render/characters/ride_pose';
import { MOUNT_VISUAL_SPECS } from '../src/render/mount_visuals';

const Y = new THREE.Vector3(0, 1, 0);

describe('limb directions', () => {
  it('hangs straight down at rest, pitches forward, and opens to its own side', () => {
    const d = new THREE.Vector3();
    expect(
      limbDirection(0, 0, 1, d)
        .toArray()
        .map((v) => +v.toFixed(9)),
    ).toEqual([0, -1, 0]);
    limbDirection(Math.PI / 2, 0, 1, d);
    expect(d.z).toBeCloseTo(1, 9); // +Z is forward
    limbDirection(0, 0.5, 1, d);
    expect(d.x).toBeGreaterThan(0); // the left leg opens toward +X
    limbDirection(0, 0.5, -1, d);
    expect(d.x).toBeLessThan(0);
  });
});

describe('aimBone', () => {
  it('turns a bone of any rest twist so its +Y lands on the target', () => {
    const target = new THREE.Vector3(0.3, -0.8, 0.5).normalize();
    for (const rest of [
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), // KayKit
      new THREE.Quaternion(-0.002, 0.028, -0.998, 0.06).normalize(), // WOC upperleg.l
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.1, 2.2)),
    ]) {
      const parent = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, -0.3));
      const q = aimBone(rest.clone(), parent, target);
      const dir = Y.clone().applyQuaternion(parent.clone().multiply(q));
      expect(dir.distanceTo(target)).toBeLessThan(1e-9);
    }
  });
});

/** A WOC-shaped leg: hips > upperleg > lowerleg > foot > toes, with the shipped rest
 *  rotations and bone lengths of woc_male.glb's left leg. */
function wocLeg() {
  const hips = new THREE.Object3D();
  const bone = (q: number[], len: number, parent: THREE.Object3D) => {
    const b = new THREE.Object3D();
    b.quaternion.set(q[0], q[1], q[2], q[3]).normalize();
    b.position.set(0, len, 0);
    parent.add(b);
    return b;
  };
  const thigh = bone([-0.002, 0.028, -0.998, 0.06], 0, hips);
  thigh.position.set(0.076, 0, 0);
  const shin = bone([-0.027, -0.001, 0.014, 1], 0.249, thigh);
  const foot = bone([0.498, -0.165, -0.005, 0.851], 0.265, shin);
  const toes = bone([0.257, 0.043, -0.122, 0.958], 0.112, foot);
  return { hips, thigh, shin, foot, toes };
}

describe('the destrier rider on a WOC body', () => {
  const spec = MOUNT_VISUAL_SPECS.lantern_hall_destrier.ride;
  if (!spec) throw new Error('the destrier has a straddle');

  it('points the feet FORWARD and keeps the knees outside the hips', () => {
    const leg = wocLeg();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    rideLegDirections(spec, 1, a, b, c);
    aimBone(leg.thigh.quaternion, new THREE.Quaternion(), a);
    aimBone(leg.shin.quaternion, leg.thigh.quaternion, b);
    aimBone(leg.foot.quaternion, leg.thigh.quaternion.clone().multiply(leg.shin.quaternion), c);
    leg.hips.updateMatrixWorld(true);
    const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const knee = at(leg.shin);
    const ankle = at(leg.foot);
    const toe = at(leg.toes);
    // the toe is ahead of the ankle: the foot points the way the horse faces
    expect(toe.z).toBeGreaterThan(ankle.z + 0.05);
    // and only slightly below it (toes a touch down, never hanging plumb)
    expect(ankle.y - toe.y).toBeLessThan(0.06);
    // the knee is out over the barrel and the shin falls down its flank, below the knee
    expect(knee.x).toBeGreaterThan(0.2);
    expect(ankle.y).toBeLessThan(knee.y);
    expect(ankle.x).toBeGreaterThan(0.2);
  });

  it('takes the reins: both forearms reach forward and in toward the pommel', () => {
    expect(spec.reins).toBe(true);
    for (const side of [1, -1]) {
      const up = new THREE.Vector3();
      const fore = new THREE.Vector3();
      reinArmDirections(side, up, fore);
      expect(up.y).toBeLessThan(0); // the upper arm hangs, the elbow at the side
      expect(fore.z).toBeGreaterThan(0.8); // the forearm reaches forward
      expect(Math.sign(fore.x)).toBe(-side); // and in, toward the other hand
    }
  });
});
