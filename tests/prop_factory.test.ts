import { describe, expect, it } from 'vitest';

import { createProp } from '../src/sim/entity';

describe('createProp (in-world Builder prop entity)', () => {
  it('builds an object entity keyed by prop:<key>', () => {
    const e = createProp(42, 'barrel', { x: 3, y: 0, z: -4 }, 1.5, 2);
    expect(e.kind).toBe('object');
    expect(e.templateId).toBe('prop:barrel');
    expect(e.id).toBe(42);
    expect(e.pos).toEqual({ x: 3, y: 0, z: -4 });
    expect(e.facing).toBe(1.5);
    expect(e.scale).toBe(2);
    expect(e.lootable).toBe(false);
    expect(e.hostile).toBe(false);
  });

  it('clamps a non-positive scale to 1', () => {
    expect(createProp(1, 'lamp', { x: 0, y: 0, z: 0 }, 0, 0).scale).toBe(1);
    expect(createProp(2, 'lamp', { x: 0, y: 0, z: 0 }, 0, -3).scale).toBe(1);
  });

  it('supports an external GLB key (ext:<name>)', () => {
    const e = createProp(7, 'ext:village_well', { x: 0, y: 0, z: 0 }, 0, 1);
    expect(e.templateId).toBe('prop:ext:village_well');
  });
});
