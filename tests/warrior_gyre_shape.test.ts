import * as THREE from 'three';
import { expect, it } from 'vitest';
import { warriorGyreShape } from '../src/render/ability_vfx/warrior_gyre_shape';

it('keeps both cutting wakes inside the actual eight-yard reach and leaves the caster centre open', () => {
  const g = warriorGyreShape(),
    p = g.getAttribute('position'),
    index = g.getIndex()!;
  const samples = Array.from({ length: p.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(p, i),
  );
  expect(samples.every((v) => v.toArray().every(Number.isFinite))).toBe(true);
  expect(Math.max(...samples.map((v) => Math.hypot(v.x, v.z)))).toBeCloseTo(8, 5);
  expect(Math.min(...samples.map((v) => v.y))).toBeGreaterThan(0.5);
  let positive = 0,
    negative = 0;
  for (let i = 0; i < index.count; i += 3) {
    const v = [0, 1, 2].map((j) => samples[index.getX(i + j)]);
    const t = new THREE.Triangle(
      ...(v.map((p) => new THREE.Vector3(p.x, 0, p.z)) as [
        THREE.Vector3,
        THREE.Vector3,
        THREE.Vector3,
      ]),
    );
    if (t.getArea() > 1e-8)
      expect(
        t.closestPointToPoint(new THREE.Vector3(), new THREE.Vector3()).length(),
      ).toBeGreaterThan(1.3);
    if (v[0].x > 0) positive++;
    else negative++;
  }
  expect(positive).toBeGreaterThan(100);
  expect(negative).toBeGreaterThan(100);
  g.dispose();
});
