import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeldConduction } from '../src/render/ability_vfx/held_conduction';
import type { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';

function draw(charges: number, time: number, detail: boolean) {
  const paths: THREE.Vector3[][] = [];
  const ribbons = {
    appendHeld(points: THREE.Vector3[], count: number) {
      paths.push(points.slice(0, count).map((p) => p.clone()));
    },
  } as unknown as AbilityVfxRibbons;
  new HeldConduction().draw(
    ribbons,
    'wardCharges',
    new THREE.Vector3(4, 1.3, -2),
    0,
    time,
    charges,
    0x428bcf,
    1,
    detail,
  );
  return paths;
}
describe('Thunder Ward electrical knots', () => {
  it.each([0, 1, 2, 3])(
    'keeps %i actual charges distinct at low detail and frozen time',
    (charges) => {
      const paths = draw(charges, 0, false);
      expect(paths).toHaveLength(charges * 2);
      const centers = paths.filter((_, i) => i % 2 === 0).map((p) => p[3]);
      for (let i = 0; i < centers.length; i++) {
        expect(centers[i].y).toBeLessThan(1.4);
        for (let j = i + 1; j < centers.length; j++)
          expect(centers[i].distanceTo(centers[j])).toBeGreaterThan(1.5);
      }
      for (const path of paths) {
        expect(path[0].distanceTo(path.at(-1)!)).toBeGreaterThan(0.2);
        expect(path.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
      }
      expect(draw(charges, 0, false)).toEqual(paths);
    },
  );
  it('moves whole charges smoothly while holding each irregular corona between re-strikes', () => {
    const start = draw(3, 0, true),
      later = draw(3, 1, true);
    expect(start).toHaveLength(9);
    expect(start[0][3].distanceTo(later[0][3])).toBeGreaterThan(0.5);
    expect(draw(0, 1, true)).toHaveLength(0);
  });
});
