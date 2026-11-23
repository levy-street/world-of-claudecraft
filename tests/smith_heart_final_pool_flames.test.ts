// The burning pools' fire (the polish pass of 2026-11-23: the pools were a
// flat disc pricked with stick-like sprites): the pure plan
// (src/render/smith_heart_fx/final_pool_flames_core.ts). The painter over a
// fake world is in tests/smith_heart_final_kit_fx.test.ts.

import { describe, expect, it } from 'vitest';
import {
  POOL_FLAMES as L,
  poolFlameHeat,
  poolFlameHeight,
  poolTongueReach,
  poolTongueSpread,
} from '../src/render/smith_heart_fx/final_pool_flames_core';
import { ELEMENT_TUNING as E } from '../src/sim/encounters/smith_heart/final_elements_ids';
import { FINAL_TUNING as T } from '../src/sim/encounters/smith_heart/final_ids';
import { FINAL_PHASES } from '../src/sim/encounters/smith_heart/final_phase_ids';

describe('the pools fire', () => {
  it('holds every pool the fight can burn at once', () => {
    expect(L.pools).toBeGreaterThanOrEqual(T.poolCap + FINAL_PHASES.trailCap);
    // Magma Rift's lava pools ride the same pool (a pool past the cap keeps
    // its floor warning, only its fire is dropped).
    expect(L.pools).toBeGreaterThanOrEqual(T.poolCap + FINAL_PHASES.trailCap + 6);
  });

  it('never stands wider than the sim radius (foot, width and lean)', () => {
    expect(L.reach).toBeGreaterThan(0);
    expect(L.reach).toBeLessThan(1);
    // Every pool the fight lays: the Ember Mark's, Forge Fire's, the Cinder
    // Trail's and Magma Rift's.
    for (const r of [T.emberR, T.forgeFireR, FINAL_PHASES.trailR, E.magmaR]) {
      const h = poolFlameHeight(r);
      expect(poolTongueReach(r, h) + poolTongueSpread(h), `r ${r}`).toBeLessThanOrEqual(r + 1e-9);
      expect(poolTongueReach(r, h), `r ${r}`).toBeGreaterThan(0);
    }
  });

  it('catches as the pool lands, then burns steady', () => {
    expect(poolFlameHeat(0)).toBe(0);
    expect(poolFlameHeat(L.catch / 2)).toBeGreaterThan(0);
    expect(poolFlameHeat(L.catch)).toBe(1);
    expect(poolFlameHeat(30)).toBe(1);
  });

  it('a wider pool burns a little taller, never a wall', () => {
    expect(poolFlameHeight(T.emberR)).toBeCloseTo(L.height, 6);
    expect(poolFlameHeight(10)).toBeLessThanOrEqual(L.height * 1.35);
    expect(poolFlameHeight(1)).toBeGreaterThanOrEqual(L.height * 0.6);
  });

  it('the low tier keeps the fire, thinner', () => {
    expect(L.tonguesLow).toBeGreaterThan(0);
    expect(L.tonguesLow).toBeLessThan(L.tongues);
    expect(L.embersLow).toBeLessThan(L.embers);
  });
});
