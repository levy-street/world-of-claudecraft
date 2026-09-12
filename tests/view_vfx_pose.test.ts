import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createVfxAnchor, type VfxAnchorPose } from '../src/render/vfx_anchor';
import { createViewVfxPoseFill, type VfxPoseView } from '../src/render/view_vfx_pose';
import { liftPoseByLocalOffset } from '../src/render/view_vfx_pose_core';

// The renderer's anchor pose fill (src/render/view_vfx_pose.ts): the pooled
// ability VFX (absorb shells, orbit halos) resolve the displayed body from it,
// so it must include the rider's saddle lift or a mounted player's shield
// wraps the horse instead of the rider.

function view(lift: number, yaw = 0): VfxPoseView {
  const group = new THREE.Group();
  group.position.set(10, 4, -6);
  group.rotation.y = yaw;
  const riderAnchor = new THREE.Group();
  riderAnchor.position.set(0, lift, 0);
  group.add(riderAnchor);
  return { group, height: 1.8, riderAnchor };
}

function fresh(): VfxAnchorPose {
  return { x: 0, y: 0, z: 0, height: 0 };
}

describe('createViewVfxPoseFill', () => {
  it('reads the view group pose when the rider anchor sits at the origin', () => {
    const fill = createViewVfxPoseFill(new Map([[7, view(0, 0.5)]]), new Map([[7, { scale: 1 }]]));
    const pose = fresh();
    expect(fill(7, pose)).toBe(true);
    expect([pose.x, pose.y, pose.z, pose.height]).toEqual([10, 4, -6, 1.8]);
    expect(pose.yaw).toBeCloseTo(0.5);
    expect(pose.scale).toBe(1);
  });

  it('lifts the pose by the saddle so a shell wraps the rider, scaled by the entity', () => {
    const fill = createViewVfxPoseFill(new Map([[7, view(1.2)]]), new Map([[7, { scale: 2 }]]));
    const anchor = createVfxAnchor(fill);
    const chest = anchor(7, 0.5);
    // group y 4, lift 1.2 * scale 2, plus half the scaled height (1.8 * 2 / 2)
    expect(chest?.y).toBeCloseTo(4 + 2.4 + 1.8, 10);
    expect(chest?.x).toBeCloseTo(10, 10);
  });

  it('reports a missing view as no reading and defaults the scale', () => {
    const fill = createViewVfxPoseFill(new Map([[7, view(1)]]), new Map());
    const pose = fresh();
    expect(fill(8, pose)).toBe(false);
    expect(fill(7, pose)).toBe(true);
    expect(pose.y).toBeCloseTo(5, 10);
  });
});

describe('liftPoseByLocalOffset', () => {
  it('rotates a forward seat offset into the displayed yaw', () => {
    const pose: VfxAnchorPose = { x: 0, y: 0, z: 0, height: 1, yaw: Math.PI / 2, scale: 1 };
    liftPoseByLocalOffset(pose, new THREE.Vector3(0, 1, 2));
    // THREE's Y rotation by +90 degrees maps local +z onto world +x.
    expect(pose.x).toBeCloseTo(2, 10);
    expect(pose.z).toBeCloseTo(0, 10);
    expect(pose.y).toBeCloseTo(1, 10);
  });

  it('matches what the scene graph would place at that local offset', () => {
    const group = new THREE.Group();
    group.position.set(3, 1, -2);
    group.rotation.y = 0.8;
    group.scale.setScalar(1.5);
    const child = new THREE.Object3D();
    child.position.set(0.2, 1.1, 0.4);
    group.add(child);
    group.updateMatrixWorld(true);
    const expected = child.getWorldPosition(new THREE.Vector3());
    const pose: VfxAnchorPose = { x: 3, y: 1, z: -2, height: 1, yaw: 0.8, scale: 1.5 };
    liftPoseByLocalOffset(pose, child.position);
    expect(pose.x).toBeCloseTo(expected.x, 10);
    expect(pose.y).toBeCloseTo(expected.y, 10);
    expect(pose.z).toBeCloseTo(expected.z, 10);
  });
});
