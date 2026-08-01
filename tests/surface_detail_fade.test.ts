// The surface-detail distance-fade bands (src/render/worn_stone.ts): the
// perf grading must never reorder (a parallax walk surviving past the point
// where the whole layer has faded would sample a projection nothing else
// uses), and the derived ends are pinned so a tuning change is a conscious
// edit here, not an accident.
import { describe, expect, it } from 'vitest';
import { surfaceDetailFadeBands } from '../src/render/worn_stone';

// The shipped family (parallaxDepth, tileScale) pairs (worn_stone.ts
// FAMILIES), restated here so a family tuning change surfaces as a diff in
// BOTH files.
const FAMILY_PARAMS: Record<string, [number, number]> = {
  stone: [0.06, 1 / 2.6],
  rock: [0.06, 1 / 3.4],
  wood: [0.045, 1 / 1.8],
  plaster: [0.02, 1 / 2.2],
  bark: [0.07, 1 / 1.6],
  fabric: [0.015, 1 / 1.2],
  metal: [0.045, 1 / 1.4],
};

describe('surfaceDetailFadeBands', () => {
  it('keeps every family band ordered: parStart < parEnd <= detEnd, detStart < detEnd', () => {
    for (const [family, [depth, tile]] of Object.entries(FAMILY_PARAMS)) {
      const b = surfaceDetailFadeBands(depth, tile);
      expect(b.parStart, family).toBeGreaterThan(0);
      expect(b.parStart, family).toBeLessThan(b.parEnd);
      expect(b.parEnd, family).toBeLessThanOrEqual(b.detEnd);
      expect(b.detStart, family).toBeLessThan(b.detEnd);
    }
  });

  it('pins the shipped stone bands (the town street cost driver)', () => {
    const b = surfaceDetailFadeBands(...FAMILY_PARAMS.stone);
    expect(b.parEnd).toBeCloseTo(42.6, 1);
    expect(b.parStart).toBeCloseTo(23.4, 1);
    expect(b.detEnd).toBeCloseTo(63.3, 1);
    expect(b.detStart).toBeCloseTo(38.0, 1);
  });

  it('pins the shipped rock bands (cliffs and boulders)', () => {
    const b = surfaceDetailFadeBands(...FAMILY_PARAMS.rock);
    expect(b.parEnd).toBeCloseTo(55.7, 1);
    expect(b.detEnd).toBeCloseTo(82.8, 1);
  });

  it('floors the shallow families at the melee-range minimum', () => {
    // fabric one-sd depth is 0.018 world units: sub-pixel almost immediately,
    // but the walk still holds through interaction range.
    const b = surfaceDetailFadeBands(...FAMILY_PARAMS.fabric);
    expect(b.parEnd).toBe(16);
  });

  it('scales with the effective tile override: the coarse great-tree bark keeps detail farther out', () => {
    const base = surfaceDetailFadeBands(0.07, 1 / 1.6);
    const giant = surfaceDetailFadeBands(0.07, 1 / 4.5); // GREAT_TREE_BARK_DETAIL tiling
    expect(giant.detEnd / base.detEnd).toBeCloseTo(4.5 / 1.6, 5);
    expect(giant.parEnd).toBeGreaterThan(base.parEnd);
  });

  it('caps the parallax end at the detail end for deep coarse configurations', () => {
    const b = surfaceDetailFadeBands(0.2, 1);
    expect(b.parEnd).toBe(b.detEnd);
  });
});
