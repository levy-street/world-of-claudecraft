// Pure veLP math: tiers, weights, epoch budgeting (the flow-ledger bound),
// pro-rata splitting, vesting, and the unstake forfeit. Everything here is
// exercised again end to end in lp_staking_service.test.ts; this file pins the
// arithmetic itself, including the adversarial boundaries.
import { describe, expect, it } from 'vitest';
import {
  epochEmissionBudget,
  forfeitOnUnstake,
  positionWeight,
  splitEpochEmission,
  VE_LP_TIERS,
  veLpTierForRemainingLock,
  vestedAmount,
} from '../server/lp_staking';

const DAY = 86_400;

describe('veLpTierForRemainingLock', () => {
  it('maps remaining lock to the highest earned tier', () => {
    expect(veLpTierForRemainingLock(0).key).toBe('drift');
    expect(veLpTierForRemainingLock(30 * DAY - 1).key).toBe('drift');
    expect(veLpTierForRemainingLock(30 * DAY).key).toBe('ripple');
    expect(veLpTierForRemainingLock(90 * DAY).key).toBe('tide');
    expect(veLpTierForRemainingLock(180 * DAY).key).toBe('undertow');
    expect(veLpTierForRemainingLock(360 * DAY).key).toBe('maelstrom');
    expect(veLpTierForRemainingLock(366 * DAY).key).toBe('maelstrom');
  });
  it('tier multipliers are strictly increasing with lock duration', () => {
    for (let i = 1; i < VE_LP_TIERS.length; i++) {
      expect(VE_LP_TIERS[i].multiplierBps).toBeGreaterThan(VE_LP_TIERS[i - 1].multiplierBps);
      expect(VE_LP_TIERS[i].minRemainingLockSeconds).toBeGreaterThan(
        VE_LP_TIERS[i - 1].minRemainingLockSeconds,
      );
    }
  });
});

describe('positionWeight (ve-decay)', () => {
  const now = 1_750_000_000;
  it('weights amount by the remaining-lock multiplier', () => {
    expect(
      positionWeight({ owner: 'a', amountBase: 1_000n, lockedUntil: now + 360 * DAY }, now),
    ).toBe(5_000n);
    expect(
      positionWeight({ owner: 'a', amountBase: 1_000n, lockedUntil: now + 30 * DAY }, now),
    ).toBe(1_500n);
  });
  it('decays to 1x as the lock expires and never below', () => {
    expect(positionWeight({ owner: 'a', amountBase: 1_000n, lockedUntil: now - 1 }, now)).toBe(
      1_000n,
    );
    expect(positionWeight({ owner: 'a', amountBase: 1_000n, lockedUntil: 0 }, now)).toBe(1_000n);
  });
  it('an empty position weighs nothing', () => {
    expect(positionWeight({ owner: 'a', amountBase: 0n, lockedUntil: now + 360 * DAY }, now)).toBe(
      0n,
    );
  });
});

describe('epochEmissionBudget (the invariant bound)', () => {
  const base = { rateBase: 1_000n, headroomBase: 100_000n, headroomCapBps: 2_000, totalWeight: 1n };
  it('pays the configured rate when headroom allows', () => {
    expect(epochEmissionBudget(base)).toBe(1_000n);
  });
  it('clamps to the headroom-share cap', () => {
    expect(epochEmissionBudget({ ...base, rateBase: 50_000n })).toBe(20_000n);
  });
  it('is zero when the rate is zero (emissions dark), headroom empty, or nothing staked', () => {
    expect(epochEmissionBudget({ ...base, rateBase: 0n })).toBe(0n);
    expect(epochEmissionBudget({ ...base, headroomBase: 0n })).toBe(0n);
    expect(epochEmissionBudget({ ...base, headroomBase: -5n })).toBe(0n);
    expect(epochEmissionBudget({ ...base, totalWeight: 0n })).toBe(0n);
  });
  it('adversarial: a huge rate never exceeds the cap share of headroom', () => {
    const budget = epochEmissionBudget({ ...base, rateBase: 2n ** 96n });
    expect(budget).toBe(20_000n);
    expect(budget <= base.headroomBase).toBe(true);
  });
  it('tiny headroom with a sub-unit cap share yields zero, not a negative or 1', () => {
    expect(epochEmissionBudget({ ...base, headroomBase: 4n })).toBe(0n);
  });
});

describe('splitEpochEmission', () => {
  const now = 1_750_000_000;
  it('splits pro rata by weight and never exceeds the budget', () => {
    const shares = splitEpochEmission(
      1_000n,
      [
        { owner: 'a', amountBase: 300n, lockedUntil: 0 },
        { owner: 'b', amountBase: 100n, lockedUntil: now + 360 * DAY }, // 5x -> weight 500
        { owner: 'c', amountBase: 200n, lockedUntil: 0 },
      ],
      now,
    );
    const total = shares.reduce((a, s) => a + s.amountBase, 0n);
    expect(total <= 1_000n).toBe(true);
    const byOwner = Object.fromEntries(shares.map((s) => [s.owner, s.amountBase]));
    expect(byOwner.a).toBe(300n);
    expect(byOwner.b).toBe(500n);
    expect(byOwner.c).toBe(200n);
  });
  it('drops flooring dust rather than over-allocating', () => {
    const shares = splitEpochEmission(
      10n,
      [
        { owner: 'a', amountBase: 1n, lockedUntil: 0 },
        { owner: 'b', amountBase: 1n, lockedUntil: 0 },
        { owner: 'c', amountBase: 1n, lockedUntil: 0 },
      ],
      now,
    );
    expect(shares.reduce((a, s) => a + s.amountBase, 0n)).toBe(9n);
  });
  it('empty inputs yield no shares', () => {
    expect(splitEpochEmission(0n, [{ owner: 'a', amountBase: 1n, lockedUntil: 0 }], now)).toEqual(
      [],
    );
    expect(splitEpochEmission(100n, [], now)).toEqual([]);
    expect(splitEpochEmission(100n, [{ owner: 'a', amountBase: 0n, lockedUntil: 0 }], now)).toEqual(
      [],
    );
  });
});

describe('vestedAmount', () => {
  const accrual = { amountBase: 1_000n, accruedAtSeconds: 1_000 };
  it('vests linearly and clamps at both ends', () => {
    expect(vestedAmount(accrual, 100, 999)).toBe(0n);
    expect(vestedAmount(accrual, 100, 1_000)).toBe(0n);
    expect(vestedAmount(accrual, 100, 1_050)).toBe(500n);
    expect(vestedAmount(accrual, 100, 1_100)).toBe(1_000n);
    expect(vestedAmount(accrual, 100, 5_000)).toBe(1_000n);
  });
  it('a zero vest window vests instantly', () => {
    expect(vestedAmount(accrual, 0, 1_000)).toBe(1_000n);
  });
});

describe('forfeitOnUnstake (anti-mercenary decay)', () => {
  const base = {
    accrualAmountBase: 1_000n,
    vestedBase: 400n,
    alreadyForfeitedBase: 0n,
    removedBase: 50n,
    positionBase: 100n,
  };
  it('forfeits the removed fraction of the unvested remainder', () => {
    expect(forfeitOnUnstake(base)).toBe(300n); // half of the 600 unvested
  });
  it('a full exit forfeits everything unvested', () => {
    expect(forfeitOnUnstake({ ...base, removedBase: 100n })).toBe(600n);
  });
  it('never touches vested rewards and never over-forfeits on repeat', () => {
    expect(forfeitOnUnstake({ ...base, vestedBase: 1_000n })).toBe(0n);
    expect(forfeitOnUnstake({ ...base, alreadyForfeitedBase: 600n })).toBe(0n);
    expect(forfeitOnUnstake({ ...base, alreadyForfeitedBase: 500n, removedBase: 100n })).toBe(100n);
  });
  it('adversarial: removing more than the position clamps to a full exit', () => {
    expect(forfeitOnUnstake({ ...base, removedBase: 10_000n })).toBe(600n);
  });
  it('degenerate inputs are zero', () => {
    expect(forfeitOnUnstake({ ...base, positionBase: 0n })).toBe(0n);
    expect(forfeitOnUnstake({ ...base, removedBase: 0n })).toBe(0n);
  });
});
