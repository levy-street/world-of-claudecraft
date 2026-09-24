import { describe, expect, it } from 'vitest';
import { HOARD_LOOT_CLASS_BIAS } from '../src/sim/content/hoard_loot';
import { VAULT_PAYOUTS } from '../src/sim/content/treasure_maps';
import { rollHoardReward } from '../src/sim/rift/hoard_reward_roll';
import { Rng } from '../src/sim/rng';

function scriptedRng(ints: number[], chances: boolean[]) {
  const calls: Array<['int' | 'chance', number, number?]> = [];
  const rng = {
    int(min: number, max: number): number {
      calls.push(['int', min, max]);
      const value = ints.shift();
      if (value === undefined || value < min || value > max) throw new Error('Unscripted int');
      return value;
    },
    chance(probability: number): boolean {
      calls.push(['chance', probability]);
      const value = chances.shift();
      if (value === undefined) throw new Error('Unscripted chance');
      return value;
    },
  };
  return { rng, calls, ints, chances };
}

describe('rollHoardReward', () => {
  it('preserves the owners full payout and exact draw order', () => {
    const script = scriptedRng([1, 0], [true, true, true, true, true]);
    const reward = rollHoardReward(script.rng, {
      rarity: 'rare',
      bossTemplateId: 'rift_boss_arcane',
      cls: 'mage',
      level: 20,
      owner: true,
      guestCapped: true,
      mountOwned: false,
    });
    expect(reward).toEqual({
      capped: false,
      copper: 54_000,
      items: [
        { itemId: 'elderwood_log', count: 6 },
        { itemId: 'rare_collapsar_band_of_nyxaris', count: 1 },
        { itemId: 'heroic_mark', count: 2 },
        { itemId: 'reins_lanternback_troll', count: 1 },
        { itemId: 'treasure_map_epic', count: 1 },
      ],
    });
    expect(script.calls).toEqual([
      ['int', 0, 2],
      ['chance', VAULT_PAYOUTS.rare.gearChance],
      ['chance', HOARD_LOOT_CLASS_BIAS],
      ['int', 0, 3],
      ['chance', VAULT_PAYOUTS.rare.markChance],
      ['chance', VAULT_PAYOUTS.rare.mountChance],
      ['chance', VAULT_PAYOUTS.rare.nextMapChance],
    ]);
    expect(script.ints).toEqual([]);
    expect(script.chances).toEqual([]);
    expect(Object.isFrozen(reward)).toBe(true);
    expect(Object.isFrozen(reward.items)).toBe(true);
    expect(reward.items.every(Object.isFrozen)).toBe(true);
  });

  it('uses guest odds and does not add the owner copper bonus', () => {
    const script = scriptedRng([2], [false, false, false, false]);
    const reward = rollHoardReward(script.rng, {
      rarity: 'epic',
      cls: 'warrior',
      level: 20,
      owner: false,
      guestCapped: false,
      mountOwned: false,
    });
    expect(reward).toEqual({
      capped: false,
      copper: 54_000,
      items: [{ itemId: 'sunpetal_herb', count: 8 }],
    });
    expect(script.calls).toEqual([
      ['int', 0, 2],
      ['chance', 0.2],
      ['chance', VAULT_PAYOUTS.epic.markChance],
      ['chance', VAULT_PAYOUTS.epic.mountChance],
      ['chance', VAULT_PAYOUTS.epic.nextMapChance],
    ]);
  });

  it('returns a capped guest with no payout and no random draws', () => {
    const script = scriptedRng([], []);
    expect(
      rollHoardReward(script.rng, {
        rarity: 'legendary',
        cls: 'druid',
        level: 20,
        owner: false,
        guestCapped: true,
        mountOwned: false,
      }),
    ).toEqual({ capped: true, copper: 0, items: [] });
    expect(script.calls).toEqual([]);
  });

  it('draws the mount chance even when already owned', () => {
    const script = scriptedRng([0], [false, false, true, false]);
    const reward = rollHoardReward(script.rng, {
      rarity: 'common',
      cls: 'hunter',
      level: 1,
      owner: true,
      guestCapped: false,
      mountOwned: true,
    });
    expect(reward.items).toEqual([{ itemId: 'thorium_ore', count: 4 }]);
    expect(reward.copper).toBe(18_450);
    expect(script.calls).toEqual([
      ['int', 0, 2],
      ['chance', VAULT_PAYOUTS.common.gearChance],
      ['chance', VAULT_PAYOUTS.common.markChance],
      ['chance', VAULT_PAYOUTS.common.mountChance],
      ['chance', VAULT_PAYOUTS.common.nextMapChance],
    ]);
  });

  it('is deterministic for a replay seed', () => {
    const input = {
      rarity: 'legendary' as const,
      bossTemplateId: 'rift_boss_tide',
      cls: 'shaman' as const,
      level: 25,
      owner: false,
      guestCapped: false,
      mountOwned: false,
    };
    expect(rollHoardReward(new Rng(473), input)).toEqual(rollHoardReward(new Rng(473), input));
  });
});
