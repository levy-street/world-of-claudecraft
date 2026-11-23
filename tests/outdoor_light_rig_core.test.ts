import { describe, expect, it } from 'vitest';
import {
  HEMI_INTENSITY_COMPOSER,
  HEMI_INTENSITY_FLAT,
  HEMI_INTENSITY_GRADE,
  hemiOutdoorIntensity,
  LAMBERT_RIG_HEMI_INTENSITY,
  LAMBERT_RIG_SUN_INTENSITY,
  lambertTerrainFillBoost,
  lowHemiIntensity,
  lowSunIntensity,
  terrainFillBoostTarget,
} from '../src/render/outdoor_light_rig_core';

describe('hemiOutdoorIntensity', () => {
  it('lifts Low fill without altering the higher-tier Lambert terrain reference', () => {
    expect(lowHemiIntensity({ lowReadabilityLighting: true })).toBe(1.2);
    expect(lowSunIntensity({ lowReadabilityLighting: true })).toBe(1.85);
    expect(lowHemiIntensity({ lowReadabilityLighting: false })).toBe(LAMBERT_RIG_HEMI_INTENSITY);
    expect(lowSunIntensity({ lowReadabilityLighting: false })).toBe(LAMBERT_RIG_SUN_INTENSITY);
    expect(LAMBERT_RIG_HEMI_INTENSITY).toBe(0.9);
    expect(LAMBERT_RIG_SUN_INTENSITY).toBe(2.65);
  });
  it('compensates for missing night IBL on Low, with extra lift in dark realms like ember', () => {
    const low = { lowReadabilityLighting: true };
    const dayHemi = lowHemiIntensity(low, { fog: 'vale', nightAmt: 0 });
    const valeNightHemi = lowHemiIntensity(low, { fog: 'vale', nightAmt: 1 });
    const emberNightHemi = lowHemiIntensity(low, { fog: 'ember', nightAmt: 1 });
    expect(dayHemi).toBe(1.2);
    expect(valeNightHemi).toBeCloseTo(1.74, 5);
    expect(emberNightHemi).toBeCloseTo(2.34, 5);
    expect(lowSunIntensity(low, { fog: 'vale', nightAmt: 1 })).toBeCloseTo(2.3125, 5);
    expect(lowSunIntensity(low, { fog: 'ember', nightAmt: 1 })).toBeCloseTo(3.0525, 5);
    for (const darkBiome of ['ember', 'volcano', 'hollow', 'marsh']) {
      expect(lowHemiIntensity(low, { fog: [0.2, 0.2, 0.3], nightAmt: 1 }, darkBiome)).toBeCloseTo(
        2.34,
        5,
      );
      expect(lowSunIntensity(low, { fog: [0.2, 0.2, 0.3], nightAmt: 1 }, darkBiome)).toBeCloseTo(
        3.0525,
        5,
      );
    }
  });
  it('steps down as the post chain grows (composer < grade < flat)', () => {
    expect(hemiOutdoorIntensity({ composer: true, gradePass: true })).toBe(HEMI_INTENSITY_COMPOSER);
    expect(hemiOutdoorIntensity({ composer: false, gradePass: true })).toBe(HEMI_INTENSITY_GRADE);
    expect(hemiOutdoorIntensity({ composer: false, gradePass: false })).toBe(HEMI_INTENSITY_FLAT);
    expect(HEMI_INTENSITY_COMPOSER).toBeLessThan(HEMI_INTENSITY_GRADE);
    expect(HEMI_INTENSITY_GRADE).toBeLessThan(HEMI_INTENSITY_FLAT);
  });
});

describe('lambertTerrainFillBoost', () => {
  it('is a no-op on the Lambert rig, whose hemisphere is already the full fill', () => {
    expect(
      lambertTerrainFillBoost({ composer: false, gradePass: false, standardMaterials: false }),
    ).toBe(1);
  });

  it('lifts the standard rig hemisphere back to the Lambert rig daylight fill', () => {
    // The Advanced mix with Effects & Lighting Low: grade-only chain, no composer.
    const gradeOnly = lambertTerrainFillBoost({
      composer: false,
      gradePass: true,
      standardMaterials: true,
    });
    expect(gradeOnly).toBeCloseTo(LAMBERT_RIG_HEMI_INTENSITY / HEMI_INTENSITY_GRADE, 10);
    expect(gradeOnly * HEMI_INTENSITY_GRADE).toBeCloseTo(LAMBERT_RIG_HEMI_INTENSITY, 10);
    // The composer chain fills even less, so its boost is larger, never smaller.
    const composer = lambertTerrainFillBoost({
      composer: true,
      gradePass: true,
      standardMaterials: true,
    });
    expect(composer).toBeGreaterThan(gradeOnly);
    expect(composer * HEMI_INTENSITY_COMPOSER).toBeCloseTo(LAMBERT_RIG_HEMI_INTENSITY, 10);
  });

  it('rides the graded hemisphere: night lands at the Lambert fill times the grade', () => {
    // The renderer writes hemi = hemiOutdoorIntensity * ambientScale * hemiScale
    // and the shader multiplies that irradiance by the boost, so the boosted
    // ground darkens with the grade instead of holding the ungraded low-tier
    // 0.9 (deep night 0.35 ambient, the Nightbloom realm's 0.95 hemi).
    const profile = { composer: false, gradePass: true, standardMaterials: true };
    const ambientScale = 0.35;
    const hemiScale = 0.95;
    const hemiAtNight = hemiOutdoorIntensity(profile) * ambientScale * hemiScale;
    expect(hemiAtNight * lambertTerrainFillBoost(profile)).toBeCloseTo(
      LAMBERT_RIG_HEMI_INTENSITY * ambientScale * hemiScale,
      10,
    );
    expect(hemiAtNight * lambertTerrainFillBoost(profile)).toBeLessThan(LAMBERT_RIG_HEMI_INTENSITY);
  });
});

describe('terrainFillBoostTarget', () => {
  const standard = { composer: true, gradePass: true, standardMaterials: true };

  it('lifts only while the live outdoor rig owns the lights', () => {
    expect(terrainFillBoostTarget(standard, true)).toBe(lambertTerrainFillBoost(standard));
    expect(terrainFillBoostTarget(standard, true)).toBeGreaterThan(3);
  });

  it('is 1 under an interior rig, whose absolute hemisphere needs no lift', () => {
    // Dawnhold writes hemi 0.72 on settle: a 3.3x lift would blow the ground
    // seen through its doorway to 2.4, far past the 0.9 daylight fill.
    expect(terrainFillBoostTarget(standard, false)).toBe(1);
  });

  it('is 1 on the Lambert tier in every state', () => {
    const lambert = { composer: false, gradePass: false, standardMaterials: false };
    expect(terrainFillBoostTarget(lambert, true)).toBe(1);
    expect(terrainFillBoostTarget(lambert, false)).toBe(1);
  });
});
