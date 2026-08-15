import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  isRigMatrixFrozen,
  syncRigMatrixFreeze,
  unfreezeRigMatrices,
} from '../src/render/rig_visibility_freeze';

// The r185 premise this module exists for, mirrored from static_matrix.test.ts:
// updateMatrixWorld recurses children unconditionally, so a hidden view group
// with matrixWorldAutoUpdate=false still pays a compose per default-flag
// descendant per frame. These tests drive REAL three graphs through the same
// scene walk the renderer runs and read composed matrix elements directly
// (getWorldPosition self-heals and would mask a frozen chain).

function buildRig(): { scene: THREE.Scene; group: THREE.Group; hand: THREE.Object3D } {
  const scene = new THREE.Scene();
  scene.updateMatrix();
  scene.matrixAutoUpdate = false;
  const group = new THREE.Group();
  const torso = new THREE.Object3D();
  const hand = new THREE.Object3D();
  torso.position.set(0, 1, 0);
  hand.position.set(0.5, 0.4, 0);
  torso.add(hand);
  group.add(torso);
  scene.add(group);
  return { scene, group, hand };
}

describe('syncRigMatrixFreeze', () => {
  it('stops descendant recomposition while hidden, r185 unconditional recursion included', () => {
    const { scene, group, hand } = buildRig();
    group.position.set(10, 0, 0);
    scene.updateMatrixWorld();
    expect(hand.matrixWorld.elements[12]).toBe(10.5);

    syncRigMatrixFreeze(group, false);
    expect(isRigMatrixFrozen(group)).toBe(true);
    // The entity loop keeps posing hidden rigs' transform properties.
    group.position.set(20, 0, 0);
    hand.position.set(0.9, 0.4, 0);
    scene.updateMatrixWorld();
    // Local AND world matrices stay frozen: no per-node compose work is left
    // for the walk to do (the pre-fix gate froze only the root's compose).
    expect(hand.matrix.elements[12]).toBe(0.5);
    expect(hand.matrixWorld.elements[12]).toBe(10.5);
    expect(group.matrixWorld.elements[12]).toBe(10);
  });

  it('reveal recomposes the current pose immediately, before any scene walk', () => {
    const { scene, group, hand } = buildRig();
    scene.updateMatrixWorld();
    syncRigMatrixFreeze(group, false);
    group.position.set(30, 0, 0);
    hand.position.set(1.5, 0.4, 0);
    scene.updateMatrixWorld();
    expect(hand.matrixWorld.elements[12]).toBe(0.5);

    syncRigMatrixFreeze(group, true);
    // No scene.updateMatrixWorld() between reveal and read: same-frame
    // consumers (nameplate anchors, vfx hand reads) see the live pose.
    expect(isRigMatrixFrozen(group)).toBe(false);
    expect(hand.matrixWorld.elements[12]).toBe(31.5);
    // The rig is fully live again afterwards.
    hand.position.set(2, 0.4, 0);
    scene.updateMatrixWorld();
    expect(hand.matrixWorld.elements[12]).toBe(32);
  });

  it('restores exactly the flags it flipped: a pre-frozen descendant stays frozen', () => {
    const { scene, group, hand } = buildRig();
    scene.updateMatrixWorld();
    // The static_matrix flame idiom: some other system already owns this
    // node's matrix and composed it by hand.
    hand.matrixAutoUpdate = false;
    syncRigMatrixFreeze(group, false);
    syncRigMatrixFreeze(group, true);
    expect(hand.matrixAutoUpdate).toBe(false);
    expect(group.matrixAutoUpdate).toBe(true);
    expect(group.matrixWorldAutoUpdate).toBe(true);
  });

  it('handles a view hidden at first sight: never composed, then revealed correct', () => {
    const scene = new THREE.Scene();
    scene.updateMatrix();
    scene.matrixAutoUpdate = false;
    const group = new THREE.Group();
    const child = new THREE.Object3D();
    child.position.set(0, 2, 0);
    group.add(child);
    scene.add(group);
    // Frozen before any updateMatrixWorld ever ran (the compilePending path).
    syncRigMatrixFreeze(group, false);
    group.position.set(5, 0, 0);
    scene.updateMatrixWorld();
    syncRigMatrixFreeze(group, true);
    expect(child.matrixWorld.elements[12]).toBe(5);
    expect(child.matrixWorld.elements[13]).toBe(2);
  });

  it('children added while frozen keep default flags and heal on reveal', () => {
    const { scene, group, hand } = buildRig();
    scene.updateMatrixWorld();
    syncRigMatrixFreeze(group, false);
    // A weapon-skin apply landing on a hidden rig.
    const weapon = new THREE.Object3D();
    weapon.position.set(0, 0, 3);
    hand.add(weapon);
    expect(weapon.matrixAutoUpdate).toBe(true);
    group.position.set(7, 0, 0);
    scene.updateMatrixWorld();
    syncRigMatrixFreeze(group, true);
    expect(weapon.matrixWorld.elements[12]).toBe(7.5);
    expect(weapon.matrixWorld.elements[14]).toBe(3);
  });

  it('is idempotent per state: repeated hidden calls never re-record or lose flags', () => {
    const { scene, group, hand } = buildRig();
    scene.updateMatrixWorld();
    syncRigMatrixFreeze(group, false);
    syncRigMatrixFreeze(group, false);
    syncRigMatrixFreeze(group, false);
    expect(hand.matrixAutoUpdate).toBe(false);
    syncRigMatrixFreeze(group, true);
    expect(hand.matrixAutoUpdate).toBe(true);
    expect(hand.matrixWorldAutoUpdate).toBe(true);
    // Repeated live calls are no-ops too.
    syncRigMatrixFreeze(group, true);
    expect(isRigMatrixFrozen(group)).toBe(false);
  });

  it('keeps an exempt (light-owner) hidden view live', () => {
    const { scene, group, hand } = buildRig();
    scene.updateMatrixWorld();
    group.visible = false;
    // The caller passes live=true for light owners regardless of visibility.
    syncRigMatrixFreeze(group, true);
    expect(isRigMatrixFrozen(group)).toBe(false);
    group.position.set(4, 0, 0);
    scene.updateMatrixWorld();
    expect(hand.matrixWorld.elements[12]).toBe(4.5);
  });
});

describe('unfreezeRigMatrices', () => {
  it('restores flags on teardown so a pooled visual self-heals under its next view', () => {
    const { scene, group, hand } = buildRig();
    scene.updateMatrixWorld();
    syncRigMatrixFreeze(group, false);
    // View removed while hidden: the visual subtree goes back to the pool.
    unfreezeRigMatrices(group);
    expect(isRigMatrixFrozen(group)).toBe(false);
    expect(hand.matrixAutoUpdate).toBe(true);
    // Reused under a fresh group: the ordinary scene walk composes it.
    const torso = group.children[0];
    const nextScene = new THREE.Scene();
    const nextGroup = new THREE.Group();
    nextGroup.position.set(50, 0, 0);
    nextGroup.add(torso);
    nextScene.add(nextGroup);
    nextScene.updateMatrixWorld();
    expect(hand.matrixWorld.elements[12]).toBe(50.5);
  });

  it('is a safe no-op on a group that was never frozen', () => {
    const { group } = buildRig();
    expect(() => unfreezeRigMatrices(group)).not.toThrow();
  });
});
