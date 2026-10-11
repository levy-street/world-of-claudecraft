import { describe, expect, it } from 'vitest';
import {
  HOARD_BRUTE_COMBO,
  HOARD_FROST_GUST,
  HOARD_STORM_FIELD_SEC,
  HOARD_TIDE_WAVE,
  HOARD_TIDE_WAVE_HALF_GAP,
  HOARD_TIDE_WAVE_LEAD_SEC,
  hoardMarkSpec,
  hoardTideWaveCenter,
  pointInHoardAnnulus,
  pointInHoardTideWave,
} from '../src/sim/rift/hoard_boss_kits';

describe('Buried Hoard boss kit plans', () => {
  it('makes Grask wider and shorter first, then narrower and longer', () => {
    expect(HOARD_BRUTE_COMBO.map((step) => step.variant)).toEqual([
      'brute-wide',
      'brute-medium',
      'brute-long',
    ]);
    expect(HOARD_BRUTE_COMBO.map((step) => step.radius)).toEqual([8, 12, 18]);
    expect(HOARD_BRUTE_COMBO.map((step) => step.halfAngle)).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(HOARD_BRUTE_COMBO[0].halfAngle).toBeGreaterThan(HOARD_BRUTE_COMBO[1].halfAngle);
    expect(HOARD_BRUTE_COMBO[1].halfAngle).toBeGreaterThan(HOARD_BRUTE_COMBO[2].halfAngle);
  });

  it('keeps the frost gust and tide wave readable before they push', () => {
    expect(HOARD_FROST_GUST.windup).toBeGreaterThanOrEqual(2);
    expect(HOARD_TIDE_WAVE.windup).toBeGreaterThanOrEqual(2);
    expect(HOARD_FROST_GUST.knockback).toBeGreaterThan(0);
    expect(HOARD_TIDE_WAVE.knockback).toBeGreaterThan(0);
  });

  it('gives Ring of Frost a safe center and the storm a long escape cast', () => {
    const ring = hoardMarkSpec('frost-ring');
    const storm = hoardMarkSpec('storm-charge');
    expect(ring.innerRadius).toBeGreaterThan(0);
    const innerRadius = ring.innerRadius ?? 0;
    expect(pointInHoardAnnulus({ x: 0, z: 0 }, { x: 0, z: 0 }, innerRadius, ring.radius)).toBe(
      false,
    );
    expect(pointInHoardAnnulus({ x: 0, z: 0 }, { x: 6, z: 0 }, innerRadius, ring.radius)).toBe(
      true,
    );
    expect(storm.windup).toBeGreaterThanOrEqual(3);
    expect(storm.hazardDuration).toBe(HOARD_STORM_FIELD_SEC);
  });

  it('moves each tide front across two lanes with a central escape gap and lead time', () => {
    const origin = { x: 0, z: 0 };
    const start = hoardTideWaveCenter(
      HOARD_TIDE_WAVE.radius,
      HOARD_TIDE_WAVE.windup,
      HOARD_TIDE_WAVE.windup,
    );
    expect(start).toBe(-HOARD_TIDE_WAVE.radius * 0.5);
    expect(
      pointInHoardTideWave(
        origin,
        0,
        { x: HOARD_TIDE_WAVE_HALF_GAP + 1, z: start },
        HOARD_TIDE_WAVE.radius,
        HOARD_TIDE_WAVE.windup,
        HOARD_TIDE_WAVE.windup,
      ),
    ).toBe(false);
    const afterLead = HOARD_TIDE_WAVE.windup - HOARD_TIDE_WAVE_LEAD_SEC - 0.4;
    const center = hoardTideWaveCenter(HOARD_TIDE_WAVE.radius, afterLead, HOARD_TIDE_WAVE.windup);
    expect(
      pointInHoardTideWave(
        origin,
        0,
        { x: 0, z: center },
        HOARD_TIDE_WAVE.radius,
        afterLead,
        HOARD_TIDE_WAVE.windup,
      ),
    ).toBe(false);
    expect(
      pointInHoardTideWave(
        origin,
        0,
        { x: HOARD_TIDE_WAVE_HALF_GAP + 1, z: center },
        HOARD_TIDE_WAVE.radius,
        afterLead,
        HOARD_TIDE_WAVE.windup,
      ),
    ).toBe(true);
  });
});
