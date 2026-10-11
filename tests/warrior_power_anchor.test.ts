import * as THREE from 'three';
import { expect, it } from 'vitest';
import { sampleWarriorPowerBone } from '../src/render/warrior_power_anchor';

function rig() {
  const root = new THREE.Group(),
    wrap = new THREE.Group(),
    chest = new THREE.Bone();
  chest.name = 'chest';
  root.add(wrap);
  wrap.add(chest);
  for (const name of ['lowerarml', 'lowerarmr', 'lowerlegl', 'lowerlegr']) {
    const bone = new THREE.Bone();
    bone.name = name;
    chest.add(bone);
  }
  return { root, wrap, chest };
}

it('follows native joint motion and includes measured normalization and Avatar growth once', () => {
  const h = rig(),
    out = new THREE.Matrix4();
  h.root.position.set(8, 2, -3);
  h.root.scale.setScalar(1.15);
  h.wrap.scale.setScalar(1.63);
  const shin = h.chest.getObjectByName('lowerlegl')!;
  shin.position.set(0.17, 0.29, 0.008);
  shin.rotation.x = 0.7;
  expect(sampleWarriorPowerBone(h.root, 3, out)).toBe(true);
  const at = new THREE.Vector3(0, 0.1, -0.085).applyMatrix4(out);
  const expected = new THREE.Vector3(0, 0.1, -0.085)
    .applyEuler(shin.rotation)
    .add(shin.position)
    .multiplyScalar(1.63 * 1.15)
    .add(h.root.position);
  expect(at.distanceTo(expected)).toBeLessThan(1e-10);
  shin.rotation.x = -0.45;
  expect(sampleWarriorPowerBone(h.root, 3, out)).toBe(true);
  expect(new THREE.Vector3(0, 0.1, -0.085).applyMatrix4(out).distanceTo(at)).toBeGreaterThan(0.1);
});

it('articulates stone ridges with the forearms rather than a raised upper arm', () => {
  const h = rig(),
    out = new THREE.Matrix4();
  const forearm = h.chest.getObjectByName('lowerarml')!;
  const upper = new THREE.Bone();
  upper.name = 'upperarml';
  h.chest.add(upper);
  forearm.position.set(0.4, 0.8, 0.1);
  forearm.rotation.x = 0.7;
  expect(sampleWarriorPowerBone(h.root, 1, out)).toBe(true);
  expect(out.elements).toEqual(forearm.matrixWorld.elements);
  const previous = out.clone();
  forearm.rotation.z = -0.8;
  expect(sampleWarriorPowerBone(h.root, 1, out)).toBe(true);
  expect(out.elements).not.toEqual(previous.elements);
  expect(out.elements).not.toEqual(upper.matrixWorld.elements);
});

it('rejects hidden, detached and invalid bones without reusing a previous appearance', () => {
  const h = rig(),
    out = new THREE.Matrix4();
  expect(sampleWarriorPowerBone(h.root, 0, out)).toBe(true);
  h.wrap.visible = false;
  expect(sampleWarriorPowerBone(h.root, 0, out)).toBe(false);
  h.wrap.visible = true;
  h.chest.removeFromParent();
  expect(sampleWarriorPowerBone(h.root, 0, out)).toBe(false);
  const replacement = rig();
  replacement.chest.position.x = 4;
  expect(sampleWarriorPowerBone(replacement.root, 0, out)).toBe(true);
  expect(out.elements[12]).toBe(4);
  replacement.chest.scale.x = 0;
  expect(sampleWarriorPowerBone(replacement.root, 0, out)).toBe(false);
  expect(sampleWarriorPowerBone(replacement.root, 5, out)).toBe(false);
});
