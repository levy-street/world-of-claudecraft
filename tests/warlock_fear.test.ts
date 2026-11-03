import { describe, expect, it } from 'vitest';
import {
  DREAD_CHORUS_DAMAGE_BUDGET_PCT,
  HARROW_DAMAGE_BUDGET_PCT,
  warlockFearBreakThreshold,
} from '../src/sim/combat/warlock_fear';

describe('Warlock fear damage budget', () => {
  it('grants Harrow and Dread Chorus a 10% max-health budget', () => {
    expect(HARROW_DAMAGE_BUDGET_PCT).toBe(0.1);
    expect(DREAD_CHORUS_DAMAGE_BUDGET_PCT).toBe(0.1);
    expect(warlockFearBreakThreshold('fear', 100_000)).toBe(10_000);
    expect(warlockFearBreakThreshold('howl_of_terror', 50_000)).toBe(5_000);
  });

  it('rounds to a minimum budget of one damage', () => {
    expect(warlockFearBreakThreshold('fear', 6)).toBe(1);
    expect(warlockFearBreakThreshold('fear', 0)).toBe(1);
  });

  it('does not alter other fear-family or incapacitate abilities', () => {
    expect(warlockFearBreakThreshold('death_coil', 100_000)).toBeUndefined();
    expect(warlockFearBreakThreshold('psychic_scream', 100_000)).toBeUndefined();
    expect(warlockFearBreakThreshold('gouge', 100_000)).toBeUndefined();
  });
});
