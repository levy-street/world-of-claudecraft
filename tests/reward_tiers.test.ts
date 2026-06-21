// Pure tests for the $WOC reward-tier split (server/reward_tiers.ts): exact
// bigint conservation, the dust-to-rank-1 rule, partial fields, env override,
// and amounts beyond Number.MAX_SAFE_INTEGER.
import { describe, it, expect } from 'vitest';
import { DEFAULT_REWARD_TIER_BPS, projectSeasonRewards, rewardTierBpsFromEnv, type RankedEntry } from '../server/reward_tiers';

const players = (n: number): RankedEntry[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, rating: 2000 - i * 10 }));

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe('DEFAULT_REWARD_TIER_BPS', () => {
  it('sums to exactly 10000 bps (the whole pool)', () => {
    expect(DEFAULT_REWARD_TIER_BPS.reduce((a, b) => a + b, 0)).toBe(10000);
  });
});

describe('projectSeasonRewards', () => {
  it('distributes the full pool across a full ladder, conserving exactly', () => {
    const pool = 1_000_000_000n; // 1000 $WOC @6
    const s = projectSeasonRewards(pool, players(10));
    expect(s).toHaveLength(10);
    expect(s[0].rank).toBe(1);
    expect(sum(s.map((x) => x.rewardBase))).toBe(pool); // nothing lost or minted
    // rank 1 = 30% (+ any dust); rank 2 = 20%
    expect(s[0].rewardBase).toBe(300_000_000n);
    expect(s[1].rewardBase).toBe(200_000_000n);
  });

  it('routes flooring dust to rank 1 so the sum equals the pool exactly', () => {
    const pool = 1_000_000_007n; // deliberately not cleanly divisible by the bps
    const s = projectSeasonRewards(pool, players(10));
    expect(sum(s.map((x) => x.rewardBase))).toBe(pool);
    // every other rank is an exact floor; rank 1 absorbs the remainder
    for (let i = 1; i < s.length; i++) {
      expect(s[i].rewardBase).toBe((pool * BigInt(DEFAULT_REWARD_TIER_BPS[i])) / 10000n);
    }
  });

  it('pays nothing from an empty pool', () => {
    const s = projectSeasonRewards(0n, players(5));
    expect(s.every((x) => x.rewardBase === 0n)).toBe(true);
  });

  it('with fewer players than tiers, only their tiers pay; the rest stays in the pool', () => {
    const pool = 1_000_000_000n;
    const s = projectSeasonRewards(pool, players(3));
    expect(s).toHaveLength(3);
    expect(s[0].rewardBase).toBe(300_000_000n); // 30%
    expect(s[1].rewardBase).toBe(200_000_000n); // 20%
    expect(s[2].rewardBase).toBe(120_000_000n); // 12%
    expect(sum(s.map((x) => x.rewardBase))).toBe(620_000_000n); // 62% allocated; 38% unspent
  });

  it('ranks beyond the schedule earn nothing', () => {
    const s = projectSeasonRewards(1_000_000_000n, players(15));
    expect(s).toHaveLength(15);
    for (let i = 10; i < 15; i++) expect(s[i].rewardBase).toBe(0n);
  });

  it('returns [] for no entries', () => {
    expect(projectSeasonRewards(1_000_000_000n, [])).toEqual([]);
  });

  it('handles pools beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const pool = 9_000_000_000_000_000_000n; // 9e18
    const s = projectSeasonRewards(pool, players(10));
    expect(sum(s.map((x) => x.rewardBase))).toBe(pool);
    expect(s[0].rewardBase >= (pool * 3000n) / 10000n).toBe(true);
  });

  it('preserves rank order and carries name + rating through', () => {
    const s = projectSeasonRewards(1_000_000_000n, [{ name: 'Ada', rating: 1999 }, { name: 'Bo', rating: 1888 }]);
    expect(s[0]).toMatchObject({ rank: 1, name: 'Ada', rating: 1999 });
    expect(s[1]).toMatchObject({ rank: 2, name: 'Bo', rating: 1888 });
  });
});

describe('rewardTierBpsFromEnv', () => {
  const prev = process.env.WOC_REWARD_TIER_BPS;
  const restore = () => { if (prev === undefined) delete process.env.WOC_REWARD_TIER_BPS; else process.env.WOC_REWARD_TIER_BPS = prev; };

  it('returns the default when unset', () => {
    delete process.env.WOC_REWARD_TIER_BPS;
    expect(rewardTierBpsFromEnv()).toEqual([...DEFAULT_REWARD_TIER_BPS]);
    restore();
  });

  it('parses a valid comma-separated override', () => {
    process.env.WOC_REWARD_TIER_BPS = '5000,3000,2000';
    expect(rewardTierBpsFromEnv()).toEqual([5000, 3000, 2000]);
    restore();
  });

  it('falls back to the default for an over-100% or malformed override', () => {
    process.env.WOC_REWARD_TIER_BPS = '9000,9000'; // sums > 10000
    expect(rewardTierBpsFromEnv()).toEqual([...DEFAULT_REWARD_TIER_BPS]);
    process.env.WOC_REWARD_TIER_BPS = '50,abc';
    expect(rewardTierBpsFromEnv()).toEqual([...DEFAULT_REWARD_TIER_BPS]);
    restore();
  });
});
