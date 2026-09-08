import * as THREE from 'three';
import { expect, it } from 'vitest';
import { warriorAvatarBracerShape } from '../src/render/ability_vfx/warrior_avatar_bracer';
import { type WarriorPowerPiece, warriorPowerPiece } from '../src/render/warrior_power_core';

it('keeps a substantial elbow ridge with a true open wrist and grip side', () => {
  const geometry = warriorAvatarBracerShape(),
    positions = geometry.getAttribute('position');
  const edges = new Map<string, number>(),
    key = (v: THREE.Vector3) =>
      v
        .toArray()
        .map((n) => n.toFixed(6))
        .join(',');
  let volume = 0,
    radius = 0;
  for (let i = 0; i < positions.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(positions, i + j),
    );
    expect(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()).toBeGreaterThan(1e-14);
    volume += a.dot(b.clone().cross(c)) / 6;
    for (const p of [a, b, c]) {
      radius = Math.max(radius, Math.hypot(p.x, p.z));
      expect(p.y).toBeLessThan(0.1); // Native wrist is another .26 along this bone.
      expect(p.y).toBeGreaterThan(-0.02);
      expect(p.x).toBeGreaterThan(0.08);
      expect(p.z).toBeLessThan(-0.015);
    }
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const edge = `${key(from)}>${key(to)}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  expect(radius).toBeGreaterThan(0.4);
  expect(volume).toBeGreaterThan(0.001);
  for (const [edge, count] of edges) {
    const [from, to] = edge.split('>');
    expect(edges.get(`${to}>${from}`)).toBe(count);
  }
  geometry.dispose();
});

it('mirrors the right forearm through a positive rotation without reversing its visible faces', () => {
  const geometry = warriorAvatarBracerShape(),
    position = geometry.getAttribute('position');
  const p = warriorPowerPiece({} as WarriorPowerPiece, 0, 0, 2, 1, true, true);
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, p.roll)),
    new THREE.Vector3(p.sx, p.sy, p.sz),
  );
  expect(matrix.determinant()).toBeGreaterThan(0);
  const transformed: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++)
    transformed.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix));
  for (let i = 0; i < position.count; i++) {
    const expected = new THREE.Vector3().fromBufferAttribute(position, i);
    expected.x = -expected.x;
    expect(transformed.some((v) => v.distanceTo(expected) < 1e-6)).toBe(true);
  }
  geometry.dispose();
});
