// The biome haze field: the world-space lookup that lets a DISTANT zone carry
// its own atmosphere. These pin the three things that decide whether the
// effect reads as intended rather than as an artifact:
//   1. colour sourcing: a texel deep inside a zone is that biome's fog colour,
//      so the preview matches the atmosphere the player meets on entry;
//   2. the border cross-fade: a zone edge is a smooth ramp of a few dozen
//      yards, never a line drawn across the vista;
//   3. the distance ramp: nothing at gameplay range, a gentle saturating
//      hint at vista range, and never a paint-over.

import { describe, expect, it } from 'vitest';
import {
  aerialHazeAmount,
  type BiomeHazePreset,
  buildBiomeHazeFieldData,
  HAZE_AERIAL_MAX,
  HAZE_AERIAL_ONSET,
  HAZE_DENSITY_CLEAR_FAR,
  HAZE_DENSITY_THICK_FAR,
  HAZE_FIELD_CELL,
  HAZE_STRENGTH_MIN,
  hazeFieldLayout,
  hazeStrengthForFogFar,
  sampleBiomeHazeField,
} from '../src/render/biome_haze_field_core';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES } from '../src/sim/data';
import type { BiomeId } from '../src/sim/types';
import { zoneBiomeAt } from '../src/sim/world';

// The real presets are private to the renderer (which is Three-bound), so the
// tests drive the field with a stand-in table that has the same SHAPE: an
// unmistakable colour per biome and a spread of fog `far` values.
const RED = 0xff0000;
const BLUE = 0x0000ff;

function presetTable(
  over: Partial<Record<BiomeId, BiomeHazePreset>> = {},
): Record<BiomeId, BiomeHazePreset> {
  const base = {} as Record<BiomeId, BiomeHazePreset>;
  for (const zone of ZONES) base[zone.biome] = { color: 0x808080, far: 400 };
  for (const extra of ['beach', 'desert', 'volcano', 'cave'] as BiomeId[]) {
    base[extra] ??= { color: 0x808080, far: 400 };
  }
  return { ...base, ...over } as Record<BiomeId, BiomeHazePreset>;
}

function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : ((c + 0.055) / 1.055) ** 2.4;
}

describe('haze field layout', () => {
  it('covers every zone rect plus the far mesh apron', () => {
    const l = hazeFieldLayout();
    expect(l.originX).toBeLessThan(WORLD_MIN_X);
    expect(l.originZ).toBeLessThan(WORLD_MIN_Z);
    expect(l.originX + l.sizeX).toBeGreaterThan(WORLD_MAX_X);
    expect(l.originZ + l.sizeZ).toBeGreaterThan(WORLD_MAX_Z);
    expect(l.cell).toBe(HAZE_FIELD_CELL);
  });

  it('stays a small texture: the field is a per-frame texture fetch, not an atlas', () => {
    const l = hazeFieldLayout();
    expect(l.cols * l.rows).toBeLessThan(40_000);
  });
});

describe('haze strength from the fog preset', () => {
  it('reads the murkiest realm at full strength and the clearest at the floor', () => {
    expect(hazeStrengthForFogFar(HAZE_DENSITY_THICK_FAR)).toBeCloseTo(1, 6);
    expect(hazeStrengthForFogFar(HAZE_DENSITY_CLEAR_FAR)).toBeCloseTo(HAZE_STRENGTH_MIN, 6);
  });

  it('clamps outside the preset spread rather than running past 1 or under the floor', () => {
    expect(hazeStrengthForFogFar(40)).toBeCloseTo(1, 6);
    expect(hazeStrengthForFogFar(1200)).toBeCloseTo(HAZE_STRENGTH_MIN, 6);
  });

  it('is monotone: thicker air always previews heavier', () => {
    expect(hazeStrengthForFogFar(265)).toBeGreaterThan(hazeStrengthForFogFar(430));
    expect(hazeStrengthForFogFar(430)).toBeGreaterThan(hazeStrengthForFogFar(630));
  });
});

describe('haze colour sourcing', () => {
  it('gives a point deep inside a zone that biome fog colour, not a neighbour blend', () => {
    // The Amberfall rect is x [-540,-180], z [1820,2380]: sample its middle.
    const field = buildBiomeHazeFieldData(presetTable({ amber: { color: RED, far: 430 } }));
    expect(zoneBiomeAt(-360, 2100)).toBe('amber');
    const s = sampleBiomeHazeField(field, -360, 2100);
    expect(s.r).toBeCloseTo(srgbToLinear(1), 3);
    expect(s.g).toBeCloseTo(0, 3);
    expect(s.b).toBeCloseTo(0, 3);
    expect(s.strength).toBeCloseTo(hazeStrengthForFogFar(430), 2);
  });

  it('gives every zone the colour of the biome standing there', () => {
    const field = buildBiomeHazeFieldData(
      presetTable({ haunt: { color: BLUE, far: 265 }, amber: { color: RED, far: 430 } }),
    );
    // The Wraithwood rect is x [180,540], z [1260,1820].
    expect(zoneBiomeAt(360, 1540)).toBe('haunt');
    const haunt = sampleBiomeHazeField(field, 360, 1540);
    expect(haunt.b).toBeGreaterThan(0.8);
    expect(haunt.r).toBeLessThan(0.05);
    const amber = sampleBiomeHazeField(field, -360, 2100);
    expect(amber.r).toBeGreaterThan(0.8);
    expect(amber.b).toBeLessThan(0.05);
  });

  it('carries the nearest zone air out into the apron past the world edge', () => {
    const field = buildBiomeHazeFieldData(presetTable({ amber: { color: RED, far: 430 } }));
    const outside = sampleBiomeHazeField(field, WORLD_MIN_X - 300, 2100);
    expect(outside.r).toBeGreaterThan(0.8);
    expect(outside.strength).toBeGreaterThan(0);
  });
});

describe('border cross-fade', () => {
  // The Amberfall (amber, z 1820..2380) sits directly north of the Nightbloom
  // (night, z 1260..1820) in the same x column, so z = 1820 at x = -360 is a
  // real zone border the player can walk across.
  const BORDER_Z = 1820;
  const BORDER_X = -360;
  const field = buildBiomeHazeFieldData(
    presetTable({ amber: { color: RED, far: 430 }, night: { color: BLUE, far: 460 } }),
  );

  it('is a genuine blend at the border, not one side or the other', () => {
    expect(zoneBiomeAt(BORDER_X, BORDER_Z - 40)).toBe('night');
    expect(zoneBiomeAt(BORDER_X, BORDER_Z + 40)).toBe('amber');
    const mid = sampleBiomeHazeField(field, BORDER_X, BORDER_Z);
    expect(mid.r).toBeGreaterThan(0.15);
    expect(mid.b).toBeGreaterThan(0.15);
  });

  it('spans a few dozen yards, so no border ever draws a line across the vista', () => {
    const redAt = (z: number): number => sampleBiomeHazeField(field, BORDER_X, z).r;
    const deepNight = redAt(BORDER_Z - 200);
    const deepAmber = redAt(BORDER_Z + 200);
    const span = deepAmber - deepNight;
    const lo = deepNight + span * 0.1;
    const hi = deepNight + span * 0.9;
    let first = Number.NaN;
    let last = Number.NaN;
    for (let z = BORDER_Z - 200; z <= BORDER_Z + 200; z += 2) {
      const v = redAt(z);
      if (Number.isNaN(first) && v >= lo) first = z;
      if (v <= hi) last = z;
    }
    const width = last - first;
    expect(width).toBeGreaterThan(40);
    expect(width).toBeLessThan(180);
  });

  it('never steps: consecutive samples across the border move by a small fraction', () => {
    let maxStep = 0;
    let prev = sampleBiomeHazeField(field, BORDER_X, BORDER_Z - 200).r;
    for (let z = BORDER_Z - 198; z <= BORDER_Z + 200; z += 2) {
      const v = sampleBiomeHazeField(field, BORDER_X, z).r;
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    expect(maxStep).toBeLessThan(0.06);
  });

  it('is deterministic: the same presets rebuild the identical field', () => {
    const again = buildBiomeHazeFieldData(
      presetTable({ amber: { color: RED, far: 430 }, night: { color: BLUE, far: 460 } }),
    );
    expect(again.rgba).toEqual(field.rgba);
  });
});

describe('aerial distance ramp', () => {
  it('leaves every gameplay distance untouched', () => {
    expect(aerialHazeAmount(0, 1)).toBe(0);
    expect(aerialHazeAmount(HAZE_AERIAL_ONSET, 1)).toBe(0);
    // Interest scope is about 120 yards; the onset sits well past it.
    expect(HAZE_AERIAL_ONSET).toBeGreaterThan(120);
  });

  it('has no onset ring: the first yards past the onset are near-zero', () => {
    expect(aerialHazeAmount(HAZE_AERIAL_ONSET + 10, 1)).toBeLessThan(0.001);
    expect(aerialHazeAmount(HAZE_AERIAL_ONSET + 30, 1)).toBeLessThan(0.01);
  });

  it('grows monotonically and saturates below the ceiling', () => {
    let prev = 0;
    for (let d = 150; d <= 2000; d += 25) {
      const a = aerialHazeAmount(d, 1);
      expect(a).toBeGreaterThanOrEqual(prev);
      expect(a).toBeLessThanOrEqual(HAZE_AERIAL_MAX);
      prev = a;
    }
    expect(aerialHazeAmount(1500, 1)).toBeCloseTo(HAZE_AERIAL_MAX, 3);
  });

  it('stays a hint of air, never a paint-over, across the whole preset spread', () => {
    const clearest = hazeStrengthForFogFar(HAZE_DENSITY_CLEAR_FAR);
    const murkiest = hazeStrengthForFogFar(HAZE_DENSITY_THICK_FAR);
    expect(aerialHazeAmount(4000, clearest)).toBeGreaterThan(0.2);
    expect(aerialHazeAmount(4000, clearest)).toBeLessThan(0.25);
    expect(aerialHazeAmount(4000, murkiest)).toBeGreaterThan(0.3);
    expect(aerialHazeAmount(4000, murkiest)).toBeLessThan(0.35);
  });

  it('reads clearly at the range a neighbouring zone actually sits', () => {
    // A zone band is 360 to 560 yards deep, so a neighbour's middle is
    // typically 400 to 900 yards out: the effect must be visible there.
    expect(aerialHazeAmount(400, 0.83)).toBeGreaterThan(0.08);
    expect(aerialHazeAmount(700, 0.83)).toBeGreaterThan(0.2);
  });
});
