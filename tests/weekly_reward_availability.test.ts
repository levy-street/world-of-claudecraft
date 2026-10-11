import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  weeklyChoiceExhausted,
  weeklyChoiceResolvedForClaim,
  weeklyRewardAvailability,
} from '../src/sim/weekly_reward_availability';
import { weeklyRewardTableOptions } from '../src/sim/weekly_reward_options';
import * as rewards from '../src/sim/weekly_rewards';
import {
  type WeeklyChoice,
  type WeeklyVaultBatch,
  weeklyLootPool,
} from '../src/sim/weekly_rewards';

describe('weekly reward availability', () => {
  afterEach(() => vi.restoreAllMocks());
  it('distinguishes focus restrictions from missing clears and equip levels', () => {
    const batch: WeeklyVaultBatch = { resetAtMs: 1000, choices: [], bossUnlocks: {} };
    expect(weeklyRewardAvailability(batch, { pool: 'raid' }, 'paladin', 20, 'holy').reason).toBe(
      'noTables',
    );
    expect(weeklyRewardAvailability(batch, { pool: 'world' }, 'paladin', 1, 'holy').reason).toBe(
      'level',
    );
    vi.spyOn(rewards, 'weeklyLootPool').mockImplementation((_pool, _cls, _unlocks, spec) =>
      spec ? [] : ['forgefathers_temper'],
    );
    expect(weeklyRewardAvailability(batch, { pool: 'world' }, 'paladin', 20, 'holy')).toMatchObject(
      { tables: [], reason: 'focus', exhausted: true },
    );
    expect(weeklyChoiceResolvedForClaim(batch, { pool: 'world' }, 'paladin', 20, 'holy')).toBe(
      false,
    );
  });
  it.each(['world', 'pvp'] as const)(
    'treats an empty %s pool as exhausted without losing fixed rewards',
    (pool) => {
      vi.spyOn(rewards, 'weeklyLootPool').mockReturnValue([]);
      const batch: WeeklyVaultBatch = { resetAtMs: 1000, choices: [{ pool }] };
      const choice = batch.choices[0];
      expect(weeklyRewardTableOptions(batch, choice, 'mage', 20)).toEqual([]);
      expect(weeklyChoiceExhausted(batch, choice, 'mage', 20)).toBe(true);
      expect(weeklyChoiceResolvedForClaim(batch, choice, 'mage', 20)).toBe(true);
      expect(weeklyChoiceExhausted(batch, { ...choice, fixed: true }, 'mage', 20)).toBe(false);
    },
  );
  it.each(['world', 'pvp'] as const)('recognizes a fully reserved %s pool only', (pool) => {
    const batch: WeeklyVaultBatch = {
      resetAtMs: 1000,
      choices: weeklyLootPool(pool, 'mage').map((itemId) => ({ pool, itemId })),
    };
    const choice: WeeklyChoice = { pool };
    expect(weeklyChoiceExhausted(batch, choice, 'mage', 20)).toBe(true);
    batch.choices.pop();
    expect(weeklyChoiceExhausted(batch, choice, 'mage', 20)).toBe(false);
  });

  it.each([
    { fixed: true as const },
    { opening: true },
    { pendingSave: true as const },
    { itemId: 'wraithfire_orb' },
  ])('never skips a fixed or unsettled reward: %j', (flags) => {
    const batch: WeeklyVaultBatch = {
      resetAtMs: 1000,
      choices: weeklyLootPool('world', 'mage').map((itemId) => ({ pool: 'world', itemId })),
    };
    expect(weeklyChoiceExhausted(batch, { pool: 'world', ...flags }, 'mage', 20)).toBe(false);
  });
});
