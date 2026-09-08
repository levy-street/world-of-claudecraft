import { expect, it } from 'vitest';
import { warriorFuryStateShape } from '../src/render/ability_vfx/warrior_fury_state_shapes';

it.each([0, 1, 2] as const)(
  'state %s has finite authored surfaces, normals and texture coordinates',
  (kind) => {
    const g = warriorFuryStateShape(kind),
      p = g.getAttribute('position');
    for (const key of ['position', 'normal', 'uv', 'color'])
      expect([...g.getAttribute(key).array].every(Number.isFinite)).toBe(true);
    expect(g.getAttribute('uv').count).toBe(p.count);
    expect(g.getAttribute('color').count).toBe(p.count);
    expect(p.count / 3).toBeLessThan(600);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    if (kind === 1) {
      expect(b.max.y).toBeLessThan(0.03);
      expect(b.min.y).toBeGreaterThan(-0.4);
      expect(b.max.z).toBeGreaterThan(0.46);
      expect(b.min.z).toBeLessThan(-0.37);
    } else expect(b.max.y - b.min.y).toBeGreaterThan(0.7);
    g.dispose();
  },
);
