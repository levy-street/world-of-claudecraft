import { describe, expect, it } from 'vitest';
import { terrainBrushAlpha, terrainBrushWeight } from '../src/sim/terrain_brush';
import type { TerrainBrushAlphaId } from '../src/sim/types';

describe('terrain brush shape', () => {
  it('preserves the legacy smooth falloff when hardness is absent', () => {
    expect(terrainBrushWeight(0)).toBe(1);
    expect(terrainBrushWeight(0.5)).toBeCloseTo(0.5, 8);
    expect(terrainBrushWeight(1)).toBe(0);
  });

  it('keeps a solid inner core and eases only across the outer edge', () => {
    expect(terrainBrushWeight(0.6, 0.7)).toBe(1);
    expect(terrainBrushWeight(0.85, 0.7)).toBeCloseTo(0.5, 8);
    expect(terrainBrushWeight(0.99, 1)).toBe(1);
  });

  it('samples every sculpt alpha deterministically inside the valid range', () => {
    const ids: TerrainBrushAlphaId[] = ['noise', 'splatter', 'streaks', 'dots', 'chunks'];
    for (const id of ids) {
      const first = terrainBrushAlpha(id, 0.17, -0.31);
      expect(terrainBrushAlpha(id, 0.17, -0.31)).toBe(first);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(1);
    }
  });

  it('multiplies the radial brush by the selected alpha', () => {
    const alpha = terrainBrushAlpha('noise', 0.2, 0.1);
    expect(terrainBrushWeight(0.2, 0, { id: 'noise', u: 0.2, v: 0.1 })).toBeCloseTo(
      terrainBrushWeight(0.2) * alpha,
      10,
    );
  });
});
