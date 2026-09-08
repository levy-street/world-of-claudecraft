import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorLeapLanding } from '../src/render/ability_vfx/warrior_leap';
import { warriorLeapShape } from '../src/render/ability_vfx/warrior_leap_shape';

it('ships closed bedrock inside the actual radius with an open landing pocket', () => {
  const g = warriorLeapShape(),
    p = g.getAttribute('position');
  const edges = new Map<string, number>();
  const key = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(5)).join(',');
  for (const attribute of ['position', 'normal', 'uv'])
    expect([...g.getAttribute(attribute).array].every(Number.isFinite)).toBe(true);
  expect(p.count / 3).toBeLessThan(600);
  for (let i = 0; i < p.count; i++) {
    expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThanOrEqual(6);
    expect(Math.hypot(p.getX(i), p.getZ(i))).toBeGreaterThan(1.35);
    expect(p.getY(i)).toBeGreaterThan(0);
  }
  for (let i = 0; i < p.count; i += 3)
    for (let j = 0; j < 3; j++) {
      const edge = [key(i + j), key(i + ((j + 1) % 3))].sort().join(':');
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  expect([...edges.values()].every((count) => count === 2)).toBe(true);
  g.dispose();
});

function host(solidReady = true) {
  const paths: THREE.Vector3[][] = [];
  const groundYAt = (x: number, z: number) => x * 0.08 + z * 0.03;
  const fx = {
    groundYAt,
    decalXZ: vi.fn(),
    crestAt: vi.fn(() => solidReady),
    bakedAt: vi.fn(),
    fragmentsAt: vi.fn(),
    pathRibbon: vi.fn((_color, _width, _life, draw) => {
      const points = Array.from({ length: 24 }, () => new THREE.Vector3());
      const count = draw(points);
      paths.push(points.slice(0, count));
    }),
  };
  return { fx, paths, subject: fx as unknown as SequencerHost };
}

it.each([0, 1, 2])(
  'tier %s requests the complete drawing and matching highlights when solids are cold or full',
  (tier) => {
    const cold = host(false),
      warm = host(true);
    expect(drawWarriorLeapLanding(cold.subject, 12, -5, 6, tier)).toBeGreaterThan(0);
    drawWarriorLeapLanding(warm.subject, 12, -5, 6, tier);
    expect(cold.paths).toHaveLength(8);
    expect(cold.fx.decalXZ).toHaveBeenCalledWith(12, -5, 6, 0xffffff, 'leap_fracture', 0.72);
    expect(cold.fx.decalXZ.mock.calls).toEqual(warm.fx.decalXZ.mock.calls);
    expect(cold.paths).toEqual(warm.paths);
    for (const points of cold.paths)
      for (const p of points) {
        expect(p.y).toBeCloseTo(cold.fx.groundYAt(p.x, p.z) + 0.045, 6);
        expect(Math.hypot(p.x - 12, p.z + 5)).toBeLessThanOrEqual(6);
      }
    expect(cold.fx.crestAt).toHaveBeenCalledTimes(1);
    // No delayed second eruption: the landing owns every dust/sprite release now.
    for (const call of cold.fx.bakedAt.mock.calls) expect(call[8]).toBe(0);
  },
);

it.each([
  [NaN, 0, 6],
  [0, Infinity, 6],
  [0, 0, NaN],
  [0, 0, 0],
  [0, 0, -1],
])('rejects invalid landing coordinates/radius %s %s %s', (x, z, radius) => {
  const f = host();
  expect(drawWarriorLeapLanding(f.subject, x, z, radius, 0)).toBe(0);
  expect(f.fx.crestAt).not.toHaveBeenCalled();
  expect(f.paths).toHaveLength(0);
});
