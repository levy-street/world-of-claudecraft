import * as THREE from 'three';
import { expect, it } from 'vitest';
import { warriorAvatarChestShape } from '../src/render/ability_vfx/warrior_avatar_shape';

it('leaves the V-neck open and exposes the sternum above the native breastplate', () => {
  const geometry = warriorAvatarChestShape(),
    material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.015, 0.8), new THREE.Vector3(0, 0, -1));
  expect(ray.intersectObject(mesh)).toHaveLength(0);
  ray.ray.origin.set(0, -0.15, 0.8);
  const hit = ray.intersectObject(mesh)[0];
  expect(hit).toBeDefined();
  // The actual Knight_Body front at this sample is .364 native in Idle.
  expect(hit.point.z).toBeGreaterThan(0.38);
  ray.ray.origin.set(0.3, -0.15, 0.8);
  expect(ray.intersectObject(mesh)[0].point.z).toBeLessThan(0.27);
  geometry.dispose();
  material.dispose();
});

it('closes every bevel and curved chest face with outward winding', () => {
  const geometry = warriorAvatarChestShape(),
    position = geometry.getAttribute('position');
  const edges = new Map<string, number>();
  const key = (v: THREE.Vector3) =>
    v
      .toArray()
      .map((n) => n.toFixed(6))
      .join(',');
  let volume = 0;
  for (let i = 0; i < position.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(position, i + j),
    );
    expect(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()).toBeGreaterThan(1e-12);
    volume += a.dot(b.clone().cross(c)) / 6;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const edge = `${key(from)}>${key(to)}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) {
    const [from, to] = edge.split('>');
    expect(edges.get(`${to}>${from}`)).toBe(count);
  }
  expect(volume).toBeGreaterThan(0.01);
  geometry.dispose();
});
