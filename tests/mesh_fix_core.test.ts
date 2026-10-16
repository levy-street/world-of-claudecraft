import { describe, expect, it } from 'vitest';
import { addKnockout, eraseKnockouts, knockoutRegion } from '../src/editor/mesh_fix_core';
import { inTerrainKnockout } from '../src/render/terrain_chunk_build';

describe('Mesh Fix brush', () => {
  it('stamps a knockout once per spot and clamps the radius', () => {
    const a = addKnockout([], 10, 5, 20, 1.2, 100);
    expect(a.knockouts).toEqual([{ x: 10, z: 20, y: 5, r: 1.2 }]);
    const b = addKnockout(a.knockouts, 10.1, 5, 20.1, 1.2, 100);
    expect(b.knockouts).toBe(a.knockouts); // already covered: same array back
    const c = addKnockout(a.knockouts, 14, 5, 20, 99, 100);
    expect(c.knockouts).toHaveLength(2);
    expect(c.knockouts[1].r).toBe(8);
  });

  it('reports the cap instead of growing past it', () => {
    const full = addKnockout([], 0, 0, 0, 1, 1).knockouts;
    const more = addKnockout(full, 30, 0, 30, 1, 1);
    expect(more.capped).toBe(true);
    expect(more.knockouts).toBe(full);
  });

  it('restores under the brush and leaves the rest', () => {
    const list = [
      { x: 0, z: 0, y: 0, r: 1 },
      { x: 20, z: 0, y: 0, r: 1 },
    ];
    expect(eraseKnockouts(list, 0, 0, 2)).toEqual([list[1]]);
    expect(eraseKnockouts(list, 50, 50, 2)).toBe(list);
  });

  it('bounds the re-mesh to what changed', () => {
    const keep = { x: 100, z: 100, y: 0, r: 1 };
    const added = { x: 10, z: 20, y: 0, r: 2 };
    expect(knockoutRegion([keep], [keep, added])).toEqual({
      minX: 6,
      minZ: 16,
      maxX: 14,
      maxZ: 24,
    });
    expect(knockoutRegion([keep], [keep])).toBeNull();
  });
});

describe('mesher knockout test', () => {
  it('drops a quad inside the disc at the hit height, not the plateau far above it', () => {
    const ks = [{ x: 0, z: 0, y: 10, r: 1.5 }];
    expect(inTerrainKnockout(ks, 0.5, 10.4, 0.5)).toBe(true);
    expect(inTerrainKnockout(ks, 3, 10, 0)).toBe(false);
    expect(inTerrainKnockout(ks, 0, 40, 0)).toBe(false);
    expect(inTerrainKnockout(undefined, 0, 10, 0)).toBe(false);
  });
});
