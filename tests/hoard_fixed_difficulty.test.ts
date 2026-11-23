import { describe, expect, it } from 'vitest';
import { TREASURE_MAP_RARITIES, TREASURE_MAP_RIFT_TIER } from '../src/sim/content/treasure_maps';
import { hoardMarkTargets } from '../src/sim/rift/hoard_boss';
import { hoardIntensity, hoardMechanicDamage } from '../src/sim/rift/hoard_scaling';
import { RIFT_RANK_BASE_LEVEL, riftRankTuningFor } from '../src/sim/rift/ranks';
import type { RiftInstance } from '../src/sim/rift/types';
import { vaultScaledTuning } from '../src/sim/treasure_vault';

describe('fixed hoard difficulty', () => {
  it('uses the authored mark budget while respecting available targets', () => {
    expect(hoardMarkTargets([10, 20], 0, 5).ids).toEqual([10, 20]);
    expect(hoardMarkTargets([10, 20, 30, 40, 50], 0, 1).ids).toEqual([10]);
  });
  for (const rarity of TREASURE_MAP_RARITIES) {
    it(`${rarity} keeps its authored difficulty for every entrant count`, () => {
      const base = riftRankTuningFor(RIFT_RANK_BASE_LEVEL[TREASURE_MAP_RIFT_TIER[rarity]]);
      const common = rarity === 'common';
      for (const headCount of [1, 2, 3, 4, 5]) {
        const vault = { rarity, headCount, ownerPid: 1, level: 20 };
        const tuning = vaultScaledTuning(base, vault);
        expect(tuning.bossHealthMultiplier).toBeCloseTo(
          base.bossHealthMultiplier * (common ? 0.4 : 1),
        );
        expect(tuning.healthMultiplier).toBeCloseTo(base.healthMultiplier * (common ? 0.4 : 1));
        expect(tuning.bossDamageMultiplier).toBeCloseTo(
          base.bossDamageMultiplier * (common ? 0.3 : 0.7),
        );
        expect(tuning.damageMultiplier).toBeCloseTo(base.damageMultiplier * (common ? 0.3 : 0.5));
        expect(tuning.addDamageMultiplier).toBeCloseTo(
          base.addDamageMultiplier * (common ? 0.3 : 0.5),
        );
        expect(hoardIntensity(vault, headCount)).toBe(hoardIntensity(vault, common ? 1 : 5));
      }
    });
  }

  it('cuts group boss mechanics by 30%, leaving common mechanics unchanged', () => {
    const expected = [306, 252, 282, 315];
    TREASURE_MAP_RARITIES.forEach((rarity, index) => {
      const inst = { vault: { rarity } } as RiftInstance;
      expect(hoardMechanicDamage(inst, 0.3)).toBe(expected[index]);
    });
  });

  it('does not change ordinary Rift tuning', () => {
    const base = riftRankTuningFor(RIFT_RANK_BASE_LEVEL.S);
    expect(vaultScaledTuning(base, null)).toBe(base);
  });

  it('cuts group add casts by 50%, leaving common casts unchanged', () => {
    const expected = [306, 180, 202, 225];
    TREASURE_MAP_RARITIES.forEach((rarity, index) => {
      expect(hoardMechanicDamage({ vault: { rarity } } as RiftInstance, 0.3, 'add')).toBe(
        expected[index],
      );
    });
  });
});
