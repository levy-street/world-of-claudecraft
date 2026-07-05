// Unit tests for the Devs portal's pure logic: contribution scoring, the level
// curve, and the gated $WOC reward math. No DB / network / chain.
import { afterEach, describe, expect, it } from 'vitest';
import {
  POINTS,
  scoreContributions,
  levelForPoints,
  computeClaimable,
  rewardRateBaseUnits,
  rewardsEnabled,
} from './devs';

describe('scoreContributions', () => {
  it('applies the per-activity point weights', () => {
    const s = scoreContributions({ prsMerged: 2, prReviews: 1, issuesOpened: 3, issuesClosed: 1, commits: 4 });
    const expected =
      2 * POINTS.prMerged + 1 * POINTS.prReviewed + 1 * POINTS.issueClosed + 3 * POINTS.issueOpened + 4 * POINTS.commit;
    expect(s.points).toBe(expected);
    expect(s.prsMerged).toBe(2);
  });

  it('scores a clean slate as level 1 / 0 points', () => {
    const s = scoreContributions({ prsMerged: 0, prReviews: 0, issuesOpened: 0, issuesClosed: 0, commits: 0 });
    expect(s.points).toBe(0);
    expect(s.level).toBe(1);
    expect(s.progressToNext).toBe(0);
  });
});

describe('levelForPoints', () => {
  it('matches the quadratic curve thresholds (L1=0, L2=100, L3=300, L4=600)', () => {
    expect(levelForPoints(0).level).toBe(1);
    expect(levelForPoints(99).level).toBe(1);
    expect(levelForPoints(100).level).toBe(2);
    expect(levelForPoints(299).level).toBe(2);
    expect(levelForPoints(300).level).toBe(3);
    expect(levelForPoints(600).level).toBe(4);
  });

  it('reports progress toward the next level in [0,1]', () => {
    const p = levelForPoints(200); // level 2 (100..300), halfway
    expect(p.level).toBe(2);
    expect(p.nextLevelPoints).toBe(300);
    expect(p.progressToNext).toBeCloseTo(0.5, 5);
  });
});

describe('computeClaimable', () => {
  const KEY = 'WOC_REWARD_RATE_BASE_UNITS';
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('is earned (points * rate) minus already-claimed, clamped at zero', () => {
    process.env[KEY] = '1000000'; // 1 $WOC per point (6 decimals)
    expect(computeClaimable(100, BigInt(0))).toBe(BigInt(100_000_000));
    expect(computeClaimable(100, BigInt(40_000_000))).toBe(BigInt(60_000_000));
    expect(computeClaimable(100, BigInt(100_000_000))).toBe(BigInt(0));
    // over-claimed (rate dropped) never goes negative
    expect(computeClaimable(10, BigInt(100_000_000))).toBe(BigInt(0));
  });

  it('is zero when no rate is configured (rewards off)', () => {
    delete process.env[KEY];
    expect(rewardRateBaseUnits()).toBe(BigInt(0));
    expect(computeClaimable(1000, BigInt(0))).toBe(BigInt(0));
  });
});

describe('rewardsEnabled', () => {
  const RATE = 'WOC_REWARD_RATE_BASE_UNITS';
  const KEYPAIR = 'SOLANA_TREASURY_KEYPAIR';
  const origRate = process.env[RATE];
  const origKey = process.env[KEYPAIR];
  afterEach(() => {
    for (const [k, v] of [[RATE, origRate], [KEYPAIR, origKey]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('requires BOTH a positive rate and a treasury keypair', () => {
    delete process.env[RATE];
    delete process.env[KEYPAIR];
    expect(rewardsEnabled()).toBe(false);

    process.env[RATE] = '1000000';
    expect(rewardsEnabled()).toBe(false); // rate but no treasury

    process.env[KEYPAIR] = '[1,2,3]';
    expect(rewardsEnabled()).toBe(true);

    process.env[RATE] = '0';
    expect(rewardsEnabled()).toBe(false); // treasury but zero rate
  });
});
