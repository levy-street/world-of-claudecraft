import { describe, expect, it } from 'vitest';
import { computeDayNightLighting } from '../src/render/time_of_day_lighting';
import {
  DAY_NIGHT_CYCLE_SECONDS,
  DEFAULT_TIME_OF_DAY,
  normalizeTimeOfDay,
  timeOfDayAt,
} from '../src/sim/world_time';

describe('world day/night clock', () => {
  it('advances deterministically and wraps after one full cycle', () => {
    expect(timeOfDayAt(0)).toBe(DEFAULT_TIME_OF_DAY);
    expect(timeOfDayAt(DAY_NIGHT_CYCLE_SECONDS / 2)).toBeCloseTo(
      normalizeTimeOfDay(DEFAULT_TIME_OF_DAY + 0.5),
      6,
    );
    expect(timeOfDayAt(DAY_NIGHT_CYCLE_SECONDS)).toBeCloseTo(DEFAULT_TIME_OF_DAY, 6);
  });

  it('keeps night readable while making daylight visibly brighter', () => {
    const midnight = computeDayNightLighting(0);
    const noon = computeDayNightLighting(0.5);

    expect(noon.sunAnchor.y).toBeGreaterThan(midnight.sunAnchor.y);
    expect(noon.sunIntensityScale).toBeGreaterThan(midnight.sunIntensityScale);
    expect(noon.hemiIntensityScale).toBeGreaterThan(midnight.hemiIntensityScale);
    expect(midnight.sunIntensityScale).toBeGreaterThan(0.2);
    expect(midnight.hemiIntensityScale).toBeGreaterThan(0.4);
    expect(midnight.sunSpriteOpacityScale).toBeLessThan(0.05);
  });
});
