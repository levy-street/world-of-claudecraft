import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SkeletonUpdateCache } from '../src/render/characters/skeleton_update_cache';
import { skeletonPaletteNeedsUpdate } from '../src/render/characters/skeleton_update_core';

function rig(): {
  model: THREE.Group;
  rootBone: THREE.Bone;
  childBone: THREE.Bone;
  skeleton: THREE.Skeleton;
} {
  const model = new THREE.Group();
  const rootBone = new THREE.Bone();
  const childBone = new THREE.Bone();
  rootBone.add(childBone);
  model.add(rootBone);
  const skeleton = new THREE.Skeleton([rootBone, childBone]);
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.add(rootBone);
  mesh.bind(skeleton);
  model.add(mesh);
  model.updateMatrixWorld(true);
  return { model, rootBone, childBone, skeleton };
}

describe('skeleton palette update decision', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  it('updates initially, after a pose revision, and after an exact matrix change', () => {
    expect(skeletonPaletteNeedsUpdate(0, -1, null, identity)).toBe(true);
    expect(skeletonPaletteNeedsUpdate(1, 0, identity, identity)).toBe(true);
    expect(skeletonPaletteNeedsUpdate(0, 0, identity, [...identity.slice(0, 12), 2, 0, 0, 1])).toBe(
      true,
    );
  });

  it('skips only when both pose revision and world matrix are exactly unchanged', () => {
    expect(skeletonPaletteNeedsUpdate(4, 4, identity, [...identity])).toBe(false);
    const negativeZero = [...identity];
    negativeZero[1] = -0;
    expect(skeletonPaletteNeedsUpdate(4, 4, identity, negativeZero)).toBe(true);
  });
});

describe('SkeletonUpdateCache', () => {
  it('elides duplicate updates but refreshes pose and ancestor-transform changes', () => {
    const { model, childBone, skeleton } = rig();
    const originalUpdate = vi.fn(skeleton.update.bind(skeleton));
    skeleton.update = originalUpdate;
    const cache = new SkeletonUpdateCache(model);

    skeleton.update();
    const initialPalette = [...skeleton.boneMatrices];
    skeleton.update();
    expect(originalUpdate).toHaveBeenCalledTimes(1);
    expect([...skeleton.boneMatrices]).toEqual(initialPalette);
    expect(cache.stats()).toEqual({
      requests: 2,
      updates: 1,
      skips: 1,
      paletteMatricesUpdated: 2,
    });

    childBone.position.x = 0.75;
    model.updateMatrixWorld(true);
    cache.markPoseChanged();
    skeleton.update();
    expect(originalUpdate).toHaveBeenCalledTimes(2);
    expect(cache.stats().updates).toBe(2);
    const posedPalette = [...skeleton.boneMatrices];
    expect(posedPalette).not.toEqual(initialPalette);

    model.position.z = 3;
    model.updateMatrixWorld(true);
    skeleton.update();
    expect(originalUpdate).toHaveBeenCalledTimes(3);
    expect([...skeleton.boneMatrices]).not.toEqual(posedPalette);
    expect(cache.stats()).toEqual({
      requests: 4,
      updates: 3,
      skips: 1,
      paletteMatricesUpdated: 6,
    });

    cache.dispose();
    expect(skeleton.update).toBe(originalUpdate);
  });
});
