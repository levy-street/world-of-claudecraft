import * as THREE from 'three';
import { expect, it } from 'vitest';
import { warriorPowerGeometry } from '../src/render/ability_vfx/warrior_power_geometry';

it('gives Avatar a closed stone volume with depth and outward mineral facets', () => {
  const geometry = warriorPowerGeometry(false),
    p = geometry.getAttribute('position');
  const edges = new Map<string, number>();
  const key = (v: THREE.Vector3) =>
    v
      .toArray()
      .map((n) => n.toFixed(5))
      .join(',');
  let volume = 0;
  for (let i = 0; i < p.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(p, i + j));
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    expect(normal.lengthSq()).toBeGreaterThan(1e-10);
    volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const directed = `${key(from)}>${key(to)}`;
      edges.set(directed, (edges.get(directed) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) {
    const [from, to] = edge.split('>');
    expect(edges.get(`${to}>${from}`)).toBe(count);
  }
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  expect(size.x).toBeGreaterThan(0.8);
  expect(size.z).toBeGreaterThan(0.8);
  expect(size.y).toBeGreaterThan(2);
  expect(volume).toBeGreaterThan(0.5);
  geometry.dispose();
});

it.each([true])(
  'keeps every exposed face outward and closes the sculpted form (blood=%s)',
  (blood) => {
    const geometry = warriorPowerGeometry(blood);
    const positions = geometry.getAttribute('position');
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    const ab = new THREE.Vector3(),
      ac = new THREE.Vector3();
    const edges = new Map<string, number>();
    const depth = blood ? 0.08 : 0.23;
    let faceCount = 0,
      seamCount = 0;
    const key = (p: THREE.Vector3) =>
      p
        .toArray()
        .map((v) => v.toFixed(5))
        .join(',');
    for (let i = 0; i < positions.count; i += 3) {
      a.fromBufferAttribute(positions, i);
      b.fromBufferAttribute(positions, i + 1);
      c.fromBufferAttribute(positions, i + 2);
      const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a));
      expect(normal.lengthSq()).toBeGreaterThan(1e-10);
      if (a.z > depth + 0.001) {
        expect(normal.z).toBeGreaterThan(0);
        seamCount++;
        continue;
      }
      if (a.z > 0 && b.z > 0 && c.z > 0) {
        expect(normal.z).toBeGreaterThan(0);
        faceCount++;
      }
      if (a.z < 0 && b.z < 0 && c.z < 0) {
        expect(normal.z).toBeLessThan(0);
        faceCount++;
      }
      for (const [from, to] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const directed = `${key(from)}>${key(to)}`;
        edges.set(directed, (edges.get(directed) ?? 0) + 1);
      }
    }
    expect(faceCount).toBeGreaterThan(40);
    expect(seamCount).toBe(blood ? 2 : 3);
    for (const [edge, count] of edges) {
      const [from, to] = edge.split('>');
      expect(edges.get(`${to}>${from}`)).toBe(count);
    }
    geometry.dispose();
  },
);

it('embeds the blood incisions over the actual front triangles', () => {
  const geometry = warriorPowerGeometry(true),
    position = geometry.getAttribute('position');
  const front: THREE.Triangle[] = [],
    seams: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i += 3) {
    const points = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(position, i + j));
    if (points.every((p) => p.z > 0.081)) seams.push(...points);
    else if (points.every((p) => Math.abs(p.z - 0.08) < 1e-6))
      front.push(new THREE.Triangle(...(points as [THREE.Vector3, THREE.Vector3, THREE.Vector3])));
  }
  expect(seams).toHaveLength(6);
  expect(front.length).toBeGreaterThan(4);
  for (const point of seams) {
    point.z = Math.fround(0.08);
    expect(front.some((triangle) => triangle.containsPoint(point))).toBe(true);
  }
  geometry.dispose();
});
