// The Liquidity Guardian cosmetic ladder: gates (dust floor, seasoning),
// remaining-lock tiering, and the LOCKSTEP pin against the server's veLP
// reward tiers (flair and reward weight must always step together).
import { describe, expect, it } from 'vitest';
import { VE_LP_TIERS } from '../server/lp_staking';
import {
  GUARDIAN_SEASONING_SECONDS,
  GUARDIAN_TIER_DEFS,
  guardianTierByIndex,
  guardianTierIndex,
} from '../src/sim/guardian_tier';

const DAY = 86_400;
const NOW = 1_750_000_000;
const seasoned = NOW - GUARDIAN_SEASONING_SECONDS - 1;
const pos = (over: Partial<{ amountBase: bigint; lockedUntil: number; stakedAt: number }>) => ({
  amountBase: 100n,
  lockedUntil: 0,
  stakedAt: seasoned,
  ...over,
});

describe('guardianTierIndex', () => {
  it('maps remaining lock to tiers 1..5 once seasoned', () => {
    expect(guardianTierIndex(pos({}), NOW, 1n)).toBe(1); // wader
    expect(guardianTierIndex(pos({ lockedUntil: NOW + 30 * DAY }), NOW, 1n)).toBe(2);
    expect(guardianTierIndex(pos({ lockedUntil: NOW + 90 * DAY }), NOW, 1n)).toBe(3);
    expect(guardianTierIndex(pos({ lockedUntil: NOW + 180 * DAY }), NOW, 1n)).toBe(4);
    expect(guardianTierIndex(pos({ lockedUntil: NOW + 360 * DAY }), NOW, 1n)).toBe(5);
  });

  it('no stake, dust stake, or unseasoned stake shows nothing', () => {
    expect(guardianTierIndex(pos({ amountBase: 0n }), NOW, 1n)).toBe(0);
    expect(guardianTierIndex(pos({ amountBase: 5n }), NOW, 10n)).toBe(0); // below dust floor
    expect(guardianTierIndex(pos({ stakedAt: NOW - 1 }), NOW, 1n)).toBe(0); // fresh position
    expect(guardianTierIndex(pos({ stakedAt: 0 }), NOW, 1n)).toBe(0); // empty/reset position
  });

  it('seasoning is a hard boundary (farm-and-dump shows no badge for a week)', () => {
    expect(
      guardianTierIndex(pos({ stakedAt: NOW - GUARDIAN_SEASONING_SECONDS + 1 }), NOW, 1n),
    ).toBe(0);
    expect(guardianTierIndex(pos({ stakedAt: NOW - GUARDIAN_SEASONING_SECONDS }), NOW, 1n)).toBe(1);
  });

  it('flair decays with the lock exactly like reward weight (expired lock = wader)', () => {
    expect(guardianTierIndex(pos({ lockedUntil: NOW - 1 }), NOW, 1n)).toBe(1);
  });

  it('guardianTierByIndex resolves 1..5 and nothing else', () => {
    expect(guardianTierByIndex(0)).toBeUndefined();
    expect(guardianTierByIndex(1)?.key).toBe('wader');
    expect(guardianTierByIndex(5)?.key).toBe('abyssguard');
    expect(guardianTierByIndex(6)).toBeUndefined();
  });
});

describe('lockstep with the veLP reward tiers', () => {
  it('guardian tier i+1 uses exactly the veLP tier i lock threshold', () => {
    expect(GUARDIAN_TIER_DEFS).toHaveLength(VE_LP_TIERS.length);
    for (let i = 0; i < VE_LP_TIERS.length; i++) {
      expect(GUARDIAN_TIER_DEFS[i].index).toBe(i + 1);
      expect(GUARDIAN_TIER_DEFS[i].minRemainingLockSeconds).toBe(
        VE_LP_TIERS[i].minRemainingLockSeconds,
      );
    }
  });
});
