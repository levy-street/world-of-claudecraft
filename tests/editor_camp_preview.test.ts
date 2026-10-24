import { describe, expect, it } from 'vitest';
import { buildCampPreviewEntities } from '../src/editor/camp_preview';

describe('editor camp previews', () => {
  it('builds deterministic idle mobs with authored VFX', () => {
    const camps = [
      {
        mobId: 'forest_wolf',
        center: { x: 10, z: 20 },
        radius: 8,
        count: 3,
        authorVfx: { preset: 'nature' as const, intensity: 0.6 },
      },
    ];
    const first = buildCampPreviewEntities(camps, 20061, 100, () => 4);
    const second = buildCampPreviewEntities(camps, 20061, 100, () => 4);
    expect(first).toHaveLength(3);
    expect(first.map((mob) => mob.pos)).toEqual(second.map((mob) => mob.pos));
    expect(first.map((mob) => mob.id)).toEqual([100, 101, 102]);
    expect(first.every((mob) => mob.wanderTimer === Number.POSITIVE_INFINITY)).toBe(true);
    expect(first[0].authorVfx).toEqual({ preset: 'nature', intensity: 0.6 });
  });
});
