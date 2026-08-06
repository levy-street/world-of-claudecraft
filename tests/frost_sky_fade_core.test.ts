import { describe, expect, it } from 'vitest';
import {
  AURORA_RAMP,
  AURORA_Z_FAR,
  AURORA_Z_NEAR,
  auroraFadeBand,
} from '../src/render/frost_sky_fade_core';
import { AMBERFALL_ZONE } from '../src/sim/content/amberfall';
import { DRAKELANDS_ZONE } from '../src/sim/content/drakelands';

// A z well inside the aurora's z band, so only the x edges are under test.
const MID_Z = (AURORA_Z_NEAR + AURORA_Z_FAR) / 2;

function requireDefined(value: number | undefined, label: string): number {
  if (value === undefined) throw new Error(`${label} is undefined`);
  return value;
}

// Pin the fade boundary against the REAL neighboring-zone bounds, not the
// module's own constant: this is what a drifted magic number (the bug this
// covers) would slip past if the test read AURORA_X_BOUND instead.
const DRAKELANDS_X_MIN = requireDefined(DRAKELANDS_ZONE.xMin, 'DRAKELANDS_ZONE.xMin'); // 180
const AMBERFALL_X_MAX = requireDefined(AMBERFALL_ZONE.xMax, 'AMBERFALL_ZONE.xMax'); // -180

describe('frost sky aurora fade band', () => {
  it('is fully visible deep inside the frost rect', () => {
    expect(auroraFadeBand(0, MID_Z)).toBe(1);
  });

  it('is zero exactly at the Drakelands boundary (xMin)', () => {
    expect(auroraFadeBand(DRAKELANDS_X_MIN, MID_Z)).toBe(0);
  });

  it('is zero exactly at the Amberfall boundary (xMax)', () => {
    expect(auroraFadeBand(AMBERFALL_X_MAX, MID_Z)).toBe(0);
  });

  it('stays zero past the east boundary, into the Drakelands', () => {
    expect(auroraFadeBand(DRAKELANDS_X_MIN + 1, MID_Z)).toBe(0);
    expect(auroraFadeBand(DRAKELANDS_X_MIN + 40, MID_Z)).toBe(0);
    expect(auroraFadeBand(540, MID_Z)).toBe(0); // deep in the Drakelands
  });

  it('stays zero past the west boundary, into the Amberfall', () => {
    expect(auroraFadeBand(AMBERFALL_X_MAX - 1, MID_Z)).toBe(0);
    expect(auroraFadeBand(AMBERFALL_X_MAX - 40, MID_Z)).toBe(0);
    expect(auroraFadeBand(-540, MID_Z)).toBe(0); // deep in the Amberfall
  });

  it('ramps linearly over the 80-unit edge on both sides', () => {
    const halfway = DRAKELANDS_X_MIN - AURORA_RAMP / 2;
    expect(auroraFadeBand(halfway, MID_Z)).toBeCloseTo(0.5, 5);
    expect(auroraFadeBand(-halfway, MID_Z)).toBeCloseTo(0.5, 5);
  });

  it('also fades to zero outside the z band', () => {
    expect(auroraFadeBand(0, AURORA_Z_NEAR - 1)).toBe(0);
    expect(auroraFadeBand(0, AURORA_Z_FAR + AURORA_RAMP + 1)).toBe(0);
  });
});
