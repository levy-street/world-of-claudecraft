import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SkeletonUpdateCache } from '../src/render/characters/skeleton_update_cache';
import { skeletonPaletteNeedsUpdate } from '../src/render/characters/skeleton_update_core';
import { applySkinnedCullBounds } from '../src/render/characters/skinned_cull_bounds';

// r185 types boneMatrices nullable; a bound rig always has a palette.
function palette(skeleton: THREE.Skeleton): number[] {
  const matrices = skeleton.boneMatrices;
  if (matrices === null) throw new Error('skeleton.boneMatrices not initialized');
  return [...matrices];
}

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
    const initialPalette = palette(skeleton);
    skeleton.update();
    expect(originalUpdate).toHaveBeenCalledTimes(1);
    expect(palette(skeleton)).toEqual(initialPalette);
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
    const posedPalette = palette(skeleton);
    expect(posedPalette).not.toEqual(initialPalette);

    model.position.z = 3;
    model.updateMatrixWorld(true);
    skeleton.update();
    expect(originalUpdate).toHaveBeenCalledTimes(3);
    expect(palette(skeleton)).not.toEqual(posedPalette);
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

describe('a rig culled from both passes costs no palette flatten', () => {
  // three calls Skeleton.update from WebGLObjects.update, and BOTH passes call
  // that inside their own `! frustumCulled || frustum.intersectsObject` guard
  // (pinned against three's source in tests/character_cull_core.test.ts). So
  // the padded sphere skinned_cull_bounds.ts installs is also what decides
  // whether a rig re-flattens its palette and re-arms its bone texture.
  const RIG_HEIGHT = 1.8;

  function culledRig() {
    const root = new THREE.Group();
    const rootBone = new THREE.Bone();
    const skeleton = new THREE.Skeleton([rootBone]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.add(rootBone);
    mesh.bind(skeleton);
    root.add(mesh);
    applySkinnedCullBounds(mesh, root, RIG_HEIGHT);
    return { root, mesh };
  }

  /** Replay of three's per-pass guard, using its own predicate. */
  function submit(frustum: THREE.Frustum, mesh: THREE.SkinnedMesh): void {
    if (!mesh.frustumCulled || frustum.intersectsObject(mesh)) mesh.skeleton.update();
  }

  function frustumOf(camera: THREE.Camera): THREE.Frustum {
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    return new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
  }

  const view = (() => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    camera.lookAt(0, 0, -1);
    camera.updateProjectionMatrix();
    return frustumOf(camera);
  })();
  // The sun's ortho box, aimed at the player standing at the origin.
  const light = (() => {
    const camera = new THREE.OrthographicCamera(-105, 105, 105, -105, 30, 480);
    camera.position.set(0, 400, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return frustumOf(camera);
  })();

  it('asks for no palette update when neither pass can see it', () => {
    const { root, mesh } = culledRig();
    const cache = new SkeletonUpdateCache(root);
    // Behind the camera AND outside the sun's ortho box.
    root.position.set(0, 0, 400);
    root.updateMatrixWorld(true);
    submit(view, mesh);
    submit(light, mesh);
    expect(cache.stats().requests).toBe(0);
    expect(cache.stats().paletteMatricesUpdated).toBe(0);
  });

  it('still asks once for a rig only the shadow pass can see', () => {
    const { root, mesh } = culledRig();
    const cache = new SkeletonUpdateCache(root);
    // Behind the camera, inside the sun's box: the shadow draw is the only one.
    root.position.set(0, 0, 40);
    root.updateMatrixWorld(true);
    submit(view, mesh);
    expect(cache.stats().requests).toBe(0);
    submit(light, mesh);
    expect(cache.stats().requests).toBe(1);
    expect(cache.stats().updates).toBe(1);
  });

  it('asks in the colour pass for a rig on screen', () => {
    const { root, mesh } = culledRig();
    const cache = new SkeletonUpdateCache(root);
    root.position.set(0, 0, -20);
    root.updateMatrixWorld(true);
    submit(view, mesh);
    expect(cache.stats().requests).toBe(1);
  });
});
