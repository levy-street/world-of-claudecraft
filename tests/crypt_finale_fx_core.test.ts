// The Hollow Crypt finale's effect plan (src/render/hollow_crypt/crypt_finale_fx_core.ts):
// the entrance lights in order off Morthen's cast bar (the circle ignites first,
// the columns and the light column peak as he speaks, the floor quakes as he
// breaks it) and goes dark outside it; the pyre fills to its landing; a burning
// lane flares, holds and gutters out; lane flames spread along the whole lane.

import { describe, expect, it } from 'vitest';
import {
  laneBurn,
  laneFlameSpots,
  pyreFill,
  riteLevels,
} from '../src/render/hollow_crypt/crypt_finale_fx_core';
import {
  KNELLWYRM_TUNING,
  MORTHEN_DESCEND,
  MORTHEN_PROCLAIM,
  MORTHEN_RISE,
  MORTHEN_RITE_WAKES,
} from '../src/sim/encounters/hollow_crypt/ids';

describe('crypt finale fx plan: the entrance', () => {
  it('is dark outside the entrance casts', () => {
    expect(riteLevels(null, 0, 0)).toEqual({ circle: 0, columns: 0, light: 0, wind: 0, quake: 0 });
    expect(riteLevels('crypt_grave_bolt', 1, 2).circle).toBe(0);
  });

  it('ignites the circle over the wake bar, then the columns and light swell to a peak as he speaks', () => {
    expect(riteLevels(MORTHEN_RITE_WAKES, 3, 3).circle).toBe(0);
    expect(riteLevels(MORTHEN_RITE_WAKES, 1.5, 3).circle).toBeCloseTo(0.5, 6);
    expect(riteLevels(MORTHEN_RITE_WAKES, 0, 3).circle).toBe(1);
    const early = riteLevels(MORTHEN_RISE, 5.5, 6);
    const late = riteLevels(MORTHEN_RISE, 0.5, 6);
    expect(late.columns).toBeGreaterThan(early.columns);
    expect(late.light).toBeGreaterThan(early.light);
    // The floor quakes as he breaks it, and settles as he clears it.
    expect(early.quake).toBe(1);
    expect(late.quake).toBe(0);
    const peak = riteLevels(MORTHEN_PROCLAIM, 1, 3.5);
    expect(peak).toEqual({ circle: 1, columns: 1, light: 1, wind: 1, quake: 0 });
    const down = riteLevels(MORTHEN_DESCEND, 0, 2.5);
    expect(down.wind).toBe(0);
    expect(down.columns).toBeLessThan(peak.columns);
  });
});

describe('crypt finale fx plan: the Knellwyrm', () => {
  it('fills the pyre warning exactly over its seconds', () => {
    expect(pyreFill(0)).toBe(0);
    expect(pyreFill(KNELLWYRM_TUNING.pyreSeconds / 2)).toBeCloseTo(0.5, 6);
    expect(pyreFill(KNELLWYRM_TUNING.pyreSeconds + 3)).toBe(1);
  });

  it('a burning lane flares, holds and gutters out with the sim lane', () => {
    expect(laneBurn(-1)).toBe(0);
    expect(laneBurn(0.1)).toBeLessThan(1);
    expect(laneBurn(3)).toBe(1);
    expect(laneBurn(KNELLWYRM_TUNING.laneSeconds - 1)).toBeCloseTo(0.5, 6);
    expect(laneBurn(KNELLWYRM_TUNING.laneSeconds + 0.1)).toBe(0);
  });

  it('spreads the lane flames over the whole lane, inside its width', () => {
    const spots = laneFlameSpots(12);
    expect(spots).toHaveLength(12);
    expect(spots[0].along).toBeLessThan(0.1);
    expect(spots[11].along).toBeGreaterThan(0.9);
    for (const s of spots) expect(Math.abs(s.side)).toBeLessThanOrEqual(1);
  });
});
