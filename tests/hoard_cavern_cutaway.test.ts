import * as THREE from 'three';
import { expect, it } from 'vitest';
import { buildHoardCavernCutaway } from '../src/render/hoard_cavern_cutaway';

it('cuts only obstructing instances and restores their original pose without changing shared geometry', () => {
  const group = new THREE.Group();
  group.position.set(100, -3, 400);
  const geometry = new THREE.BoxGeometry(5, 20, 5);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2);
  mesh.name = 'HoardValleyBoundaryCliffs';
  const first = new THREE.Matrix4().makeTranslation(0, 5, -5);
  const second = new THREE.Matrix4().makeTranslation(15, 5, -5);
  mesh.setMatrixAt(0, first);
  mesh.setMatrixAt(1, second);
  group.add(mesh);
  const update = buildHoardCavernCutaway(group);
  const before = geometry.getAttribute('position').array.slice();
  const read = new THREE.Matrix4();
  const target = new THREE.Vector3(100, 0, 400);
  update(new THREE.Vector3(100, 8, 390), target);
  mesh.getMatrixAt(0, read);
  expect(read.determinant()).toBe(0);
  mesh.getMatrixAt(1, read);
  expect(read).toEqual(second);
  update(new THREE.Vector3(110, 8, 405), target);
  mesh.getMatrixAt(0, read);
  expect(read).toEqual(first);
  expect(geometry.getAttribute('position').array).toEqual(before);
});
