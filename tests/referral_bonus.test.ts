// Pure tests for the referral bonus engine (#475). These pin the money math and,
// critically, the checkpoint logic that stops a granted referee XP boost from
// being re-counted as earnings on the next reconciliation (which would compound
// the bonus). The DB + live grant wiring is covered separately.

import { describe, expect, it } from 'vitest';
import {
  computeReferralBonus,
  reconcileReferral,
  withinReferralWindow,
  REFERRAL_REFEREE_BPS,
  REFERRAL_REFERRER_BPS,
  REFERRAL_BONUS_MS,
} from '../server/referral_bonus';

describe('computeReferralBonus', () => {
  it('uses the default 10% referee / 5% referrer split in-window', () => {
    expect(REFERRAL_REFEREE_BPS).toBe(1000);
    expect(REFERRAL_REFERRER_BPS).toBe(500);
    expect(computeReferralBonus(1000, 2000, true)).toEqual({
      refereeXp: 100, refereeCopper: 200, referrerXp: 50, referrerCopper: 100,
    });
  });

  it('is all zero outside the window', () => {
    expect(computeReferralBonus(1000, 2000, false)).toEqual({ refereeXp: 0, refereeCopper: 0, referrerXp: 0, referrerCopper: 0 });
  });

  it('is zero for no new earnings, and clamps negative deltas', () => {
    expect(computeReferralBonus(0, 0, true)).toEqual({ refereeXp: 0, refereeCopper: 0, referrerXp: 0, referrerCopper: 0 });
    expect(computeReferralBonus(-50, -10, true)).toEqual({ refereeXp: 0, refereeCopper: 0, referrerXp: 0, referrerCopper: 0 });
  });

  it('floors the bps cut (never over-credits on odd amounts)', () => {
    // 95 xp * 10% = 9.5 -> 9 (referee), * 5% = 4.75 -> 4 (referrer)
    expect(computeReferralBonus(95, 0, true)).toMatchObject({ refereeXp: 9, referrerXp: 4 });
  });
});

describe('reconcileReferral', () => {
  it('computes the bonus from the delta and advances the checkpoint past the granted referee XP', () => {
    const r = reconcileReferral({ xpGained: 1000, lootCopper: 1000, lastXpGained: 0, lastLootCopper: 0, withinWindow: true });
    expect(r).toMatchObject({
      refereeXp: 100, refereeCopper: 100, referrerXp: 50, referrerCopper: 50, applied: true,
      newLastXpGained: 1100, // 1000 earned + 100 boost (granted via grantXp, so checkpointed past it)
      newLastLootCopper: 1000, // copper boost does not touch lootCopper
    });
  });

  it('does NOT re-count a prior boost on the next round (no compounding)', () => {
    // Round 1: 1000 earned -> +100 boost, checkpoint 1100, live xpGained = 1100.
    const r1 = reconcileReferral({ xpGained: 1000, lootCopper: 0, lastXpGained: 0, lastLootCopper: 0, withinWindow: true });
    expect(r1.refereeXp).toBe(100);
    expect(r1.newLastXpGained).toBe(1100);
    // Round 2: player earns 500 more -> live xpGained = 1100 + 500 = 1600.
    const r2 = reconcileReferral({ xpGained: 1600, lootCopper: 0, lastXpGained: r1.newLastXpGained, lastLootCopper: 0, withinWindow: true });
    expect(r2.refereeXp).toBe(50); // 10% of the 500 NEW xp, not of 600 (the 100 boost is excluded)
    expect(r2.newLastXpGained).toBe(1650);
  });

  it('out of window: no grant, but the checkpoint still advances to current counters', () => {
    const r = reconcileReferral({ xpGained: 5000, lootCopper: 3000, lastXpGained: 1000, lastLootCopper: 500, withinWindow: false });
    expect(r).toMatchObject({ refereeXp: 0, refereeCopper: 0, referrerXp: 0, referrerCopper: 0, applied: false, newLastXpGained: 5000, newLastLootCopper: 3000 });
  });
});

describe('withinReferralWindow', () => {
  it('is true inside the window and false at/after the boundary', () => {
    const referredAt = 1_000_000_000;
    expect(withinReferralWindow(referredAt, referredAt + REFERRAL_BONUS_MS - 1)).toBe(true);
    expect(withinReferralWindow(referredAt, referredAt + REFERRAL_BONUS_MS)).toBe(false);
    expect(withinReferralWindow(referredAt, referredAt + REFERRAL_BONUS_MS + 1)).toBe(false);
  });
});
