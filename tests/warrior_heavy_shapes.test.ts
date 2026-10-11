import { expect, it } from 'vitest';
import { ACTIVE_WARRIOR_CRESTS } from '../src/render/ability_vfx/active_kit_prewarm';
import {
  buildWarriorHeavyShape,
  WARRIOR_HEAVY_POINTS,
} from '../src/render/ability_vfx/warrior_heavy_shapes';

it.each(['steel_chop', 'steel_counter', 'steel_execution'] as const)(
  '%s is prepared, finite, substantial and aligned with its contact ribbon',
  (kind) => {
    expect(ACTIVE_WARRIOR_CRESTS).toContain(kind);
    const geometry = buildWarriorHeavyShape(kind);
    const positions = geometry.getAttribute('position');
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeGreaterThan(4.3);
    expect(box.max.y - box.min.y).toBeGreaterThan(1.2);
    expect(box.max.z - box.min.z).toBeGreaterThan(0.75);
    for (const name of ['position', 'normal', 'uv'])
      for (const value of geometry.getAttribute(name).array)
        expect(Number.isFinite(value)).toBe(true);
    expect(geometry.getIndex()!.count / 3).toBeLessThanOrEqual(1000);
    const point = { x: 0, y: 0, z: 0 };
    for (let i = 0; i <= 36; i += 3) {
      WARRIOR_HEAVY_POINTS[kind](i / 36, 0, point);
      expect(positions.getX(i)).toBeCloseTo(point.x, 5);
      expect(positions.getY(i)).toBeCloseTo(point.y, 5);
      expect(Math.abs(positions.getZ(i) - point.z)).toBeLessThanOrEqual(0.012001);
    }
    geometry.dispose();
  },
);

it('leaves two real air breaks in the execution cleaver, with no face bridging either gap', () => {
  const geometry = buildWarriorHeavyShape('steel_execution');
  const positions = geometry.getAttribute('position');
  const indices = geometry.getIndex()!;
  for (const split of [16, 26]) {
    const mid = ((split + 0.5) / 36 - 0.5) * 4.4;
    for (let i = 0; i < indices.count; i += 3) {
      const x = [0, 1, 2].map((j) => positions.getX(indices.getX(i + j)));
      expect(Math.min(...x) < mid && Math.max(...x) > mid).toBe(false);
    }
  }
  geometry.dispose();
});
