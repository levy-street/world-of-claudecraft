import * as THREE from 'three';
import { expect, it } from 'vitest';
import { buildForgeAnvilTarget } from '../src/render/forge_anvil_target';
import { attachEntityViewBody } from '../src/render/quest_entity_presentation';
import { buildGroundQuestObject } from '../src/render/quest_objects';

it('picks the existing anvil through the entity body seam without drawing another mesh', () => {
  const body = buildGroundQuestObject('forge_tools', 2146800023);
  const parent = new THREE.Group();
  parent.position.set(374, 6, 2020);
  const target = attachEntityViewBody(parent, body.group, 2146800023, null, false);
  parent.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(374, 15, 2020), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(target, true);
  expect(hits).toHaveLength(1);
  expect(hits[0].object.userData.entityId).toBe(2146800023);
  expect(hits[0].point.y).toBeCloseTo(8.25);
  expect(body.group.children).toHaveLength(0);
  ray.far = 2;
  expect(ray.intersectObject(target, true)).toHaveLength(0);
  ray.far = Infinity;
  ray.near = 10;
  expect(ray.intersectObject(target, true)).toHaveLength(0);
  ray.near = 0;
  ray.ray.origin.x += 3;
  expect(ray.intersectObject(target, true)).toHaveLength(0);
});

it('keeps the built-in anvil corners clickable after pooled bodies receive cosmetic yaw', () => {
  const { group } = buildForgeAnvilTarget();
  const ray = new THREE.Raycaster(new THREE.Vector3(0.6, 4, 0.96), new THREE.Vector3(0, -1, 0));
  for (let index = 0; index < 7; index++) {
    group.rotation.y = index * 0.45;
    group.updateMatrixWorld(true);
    expect(ray.intersectObject(group, true)).toHaveLength(1);
  }
});
