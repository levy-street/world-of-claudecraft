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
  HAZE_AERIAL_REF,
  HAZE_DENSITY_CLEAR_FAR,
  HAZE_DENSITY_THICK_FAR,
  HAZE_FAR_CEIL,
  HAZE_FAR_ONSET,
  HAZE_FIELD_CELL,
  HAZE_RAIN_STRENGTH_FLOOR,
  HAZE_SNOW_STRENGTH_FLOOR,
  HAZE_STRENGTH_MIN,
  hazeFieldLayout,
  hazeLightLevel,
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
    // Interest scope is about 120 yards. The onset may sit just under it,
    // but the Gaussian shoulder must keep the radius itself under 1 percent:
    // nothing a player fights, loots or reads ever reads as fogged.
    expect(HAZE_AERIAL_ONSET).toBeGreaterThanOrEqual(100);
    expect(aerialHazeAmount(120, 1)).toBeLessThan(0.01);
  });

  it('has no onset ring: the first yards past the onset are near-zero', () => {
    expect(aerialHazeAmount(HAZE_AERIAL_ONSET + 10, 1)).toBeLessThan(0.004);
    expect(aerialHazeAmount(HAZE_AERIAL_ONSET + 30, 1)).toBeLessThan(0.03);
  });

  it('grows monotonically toward the far ceiling', () => {
    let prev = 0;
    for (let d = 150; d <= 4000; d += 25) {
      const a = aerialHazeAmount(d, 1);
      expect(a).toBeGreaterThanOrEqual(prev);
      expect(a).toBeLessThanOrEqual(HAZE_FAR_CEIL);
      prev = a;
    }
    expect(aerialHazeAmount(4000, 1)).toBeCloseTo(HAZE_FAR_CEIL, 3);
  });

  it('keeps the border band moderate and lets the far term start past it', () => {
    // The far term must not thicken the 150 to 400 yard border band the near
    // term was tuned for: it opens only after the near shoulder has saturated.
    expect(HAZE_AERIAL_MAX).toBeLessThanOrEqual(0.4);
    expect(HAZE_FAR_ONSET).toBeGreaterThanOrEqual(HAZE_AERIAL_ONSET + 2 * HAZE_AERIAL_REF);
    expect(aerialHazeAmount(400, 1)).toBeLessThanOrEqual(HAZE_AERIAL_MAX);
  });

  it('leaves the mid field its own light and shade, out to the detail horizon', () => {
    // THE regression this curve exists to prevent. A mix toward one constant
    // colour costs shading contrast in proportion, so anything inside the
    // detail horizon (far_terrain_core FOGLESS_DETAIL_FAR, 700) that is mostly
    // haze is a hillside with no light on it: an earlier ship of this ramp put
    // 27 percent on 300 yards and saturated by 400, and the vista read as flat
    // pastel cutouts that ignored the hour. A clear realm must stay mostly its
    // own colour across that whole band.
    const clear = hazeStrengthForFogFar(HAZE_DENSITY_CLEAR_FAR);
    expect(aerialHazeAmount(200, clear)).toBeLessThan(0.05);
    expect(aerialHazeAmount(300, clear)).toBeLessThan(0.14);
    expect(aerialHazeAmount(400, clear)).toBeLessThan(0.22);
    expect(aerialHazeAmount(700, clear)).toBeLessThan(0.3);
    // and even the murkiest realm keeps most of the ground it is standing on
    expect(aerialHazeAmount(700, hazeStrengthForFogFar(HAZE_DENSITY_THICK_FAR))).toBeLessThan(0.42);
  });

  it('converges at the world rim for EVERY realm, not only the murky ones', () => {
    // The far term is the camera's own air column, so it is not scaled by the
    // destination's murk (see aerialHazeAmount). Scaling it was what left a
    // clear realm's rim at about 0.56: a crisp pale silhouette at the world
    // edge, bright by day and glowing against a navy night sky.
    const clearest = hazeStrengthForFogFar(HAZE_DENSITY_CLEAR_FAR);
    const murkiest = hazeStrengthForFogFar(HAZE_DENSITY_THICK_FAR);
    expect(aerialHazeAmount(3000, clearest)).toBeGreaterThan(0.8);
    expect(aerialHazeAmount(3000, murkiest)).toBeGreaterThan(0.9);
    // still short of a white-out: the ground keeps a say even at the rim
    expect(HAZE_FAR_CEIL).toBeLessThanOrEqual(0.95);
    expect(aerialHazeAmount(4000, murkiest)).toBeLessThanOrEqual(HAZE_FAR_CEIL);
    // the ordering survives: thicker air still previews heavier at range
    expect(aerialHazeAmount(3000, murkiest)).toBeGreaterThan(aerialHazeAmount(3000, clearest));
  });

  it('still reads as a change of air at the BORDER sightline', () => {
    // Standing at a zone border looking in, the neighbour's land fills the 150
    // to 400 yard band, and two ships of this ramp under-shot it badly enough
    // to play as "the air did not change" (0.046 at 300 yards). The band is
    // deliberately lighter than the pass that over-corrected, but must stay
    // comfortably above those numbers; the rest of the neighbour's identity is
    // carried by the baked COLOUR (hue, light level, weather veil), which is
    // per realm at any mix.
    expect(aerialHazeAmount(300, 0.8)).toBeGreaterThan(0.08);
    expect(aerialHazeAmount(400, 0.8)).toBeGreaterThan(0.15);
    expect(aerialHazeAmount(700, 0.83)).toBeGreaterThan(0.25);
  });
});

describe('zone light level in the bake', () => {
  it('computes full day as exactly 1 and the twilight rigs dimmer', () => {
    expect(hazeLightLevel()).toBe(1);
    expect(hazeLightLevel(1, 1, 1)).toBe(1);
    // The Nightbloom rig (sun 0.6, hemi 0.95, env 0.7) lands near 0.7.
    expect(hazeLightLevel(0.6, 0.95, 0.7)).toBeGreaterThan(0.65);
    expect(hazeLightLevel(0.6, 0.95, 0.7)).toBeLessThan(0.75);
    expect(hazeLightLevel(0.5)).toBeLessThan(hazeLightLevel(0.8));
  });

  it('darkens the baked haze colour, so a twilight realm reads dim from outside', () => {
    const dayField = buildBiomeHazeFieldData(
      presetTable({ night: { color: 0x8d7fc0, far: 460 } }),
      () => 'night',
    );
    const duskField = buildBiomeHazeFieldData(
      presetTable({ night: { color: 0x8d7fc0, far: 460, light: 0.7 } }),
      () => 'night',
    );
    const day = sampleBiomeHazeField(dayField, 0, 0);
    const dusk = sampleBiomeHazeField(duskField, 0, 0);
    expect(dusk.r).toBeCloseTo(day.r * 0.7, 2);
    expect(dusk.g).toBeCloseTo(day.g * 0.7, 2);
    expect(dusk.b).toBeCloseTo(day.b * 0.7, 2);
    expect(dusk.strength).toBeCloseTo(day.strength, 3);
  });
});

describe('baked weather veil', () => {
  it('whitens and thickens a snowing realm air', () => {
    const clear = buildBiomeHazeFieldData(
      presetTable({ frost: { color: 0xa9bed2, far: 325 } }),
      () => 'frost',
    );
    const snowing = buildBiomeHazeFieldData(
      presetTable({ frost: { color: 0xa9bed2, far: 325, precip: 'snow' } }),
      () => 'frost',
    );
    const base = sampleBiomeHazeField(clear, 0, 0);
    const veiled = sampleBiomeHazeField(snowing, 0, 0);
    expect(veiled.r).toBeGreaterThan(base.r);
    expect(veiled.g).toBeGreaterThan(base.g);
    expect(veiled.b).toBeGreaterThan(base.b);
    expect(veiled.strength).toBeGreaterThanOrEqual(HAZE_SNOW_STRENGTH_FLOOR - 1 / 255);
  });

  it('thickens a raining realm air without recolouring it', () => {
    const clear = buildBiomeHazeFieldData(
      presetTable({ marsh: { color: 0xc2cbb6, far: 400 } }),
      () => 'marsh',
    );
    const raining = buildBiomeHazeFieldData(
      presetTable({ marsh: { color: 0xc2cbb6, far: 400, precip: 'rain' } }),
      () => 'marsh',
    );
    const base = sampleBiomeHazeField(clear, 0, 0);
    const veiled = sampleBiomeHazeField(raining, 0, 0);
    expect(veiled.r).toBeCloseTo(base.r, 3);
    expect(veiled.g).toBeCloseTo(base.g, 3);
    expect(veiled.b).toBeCloseTo(base.b, 3);
    expect(veiled.strength).toBeGreaterThanOrEqual(HAZE_RAIN_STRENGTH_FLOOR - 1 / 255);
    expect(veiled.strength).toBeGreaterThan(base.strength);
  });

  it('floors, never caps: air already thicker than the floor keeps its own value', () => {
    const raining = buildBiomeHazeFieldData(
      // far 150 is the murkiest end: strength 1, above the rain floor.
      presetTable({ marsh: { color: 0xc2cbb6, far: 150, precip: 'rain' } }),
      () => 'marsh',
    );
    const veiled = sampleBiomeHazeField(raining, 0, 0);
    expect(veiled.strength).toBeGreaterThan(HAZE_RAIN_STRENGTH_FLOOR);
  });
});
