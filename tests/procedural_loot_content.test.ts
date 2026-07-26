import { describe, expect, it } from 'vitest';
import {
  baseEligibleForAffix,
  PROCEDURAL_AFFIXES,
  PROCEDURAL_BASE_POOLS,
  PROCEDURAL_ITEM_BASES,
  PROCEDURAL_RARITIES,
  PROCEDURAL_RARITY_TABLES,
  PROCEDURAL_STAT_BUDGET_COST,
  validateProceduralLootContent,
} from '../src/sim/content/procedural_loot';
import {
  calculateProceduralBudget,
  findProceduralBudgetFeasibleAffixSet,
} from '../src/sim/loot/procedural/budget';

describe('procedural loot content', () => {
  it('passes the startup validator', () => {
    expect(validateProceduralLootContent()).toEqual([]);
  });

  it('ships the complete 34-family launch taxonomy', () => {
    const bases = Object.values(PROCEDURAL_ITEM_BASES);
    expect(bases).toHaveLength(34);
    expect(bases.filter((base) => base.kind === 'weapon')).toHaveLength(9);
    expect(bases.filter((base) => base.kind === 'held_offhand')).toHaveLength(1);
    expect(bases.filter((base) => base.armorType === 'cloth')).toHaveLength(7);
    expect(bases.filter((base) => base.armorType === 'leather')).toHaveLength(7);
    expect(bases.filter((base) => base.armorType === 'mail' && !base.shield)).toHaveLength(7);
    expect(bases.filter((base) => base.slot === 'ring' || base.slot === 'neck')).toHaveLength(2);
    expect(bases.filter((base) => base.shield)).toHaveLength(1);

    const armorSlots = ['helmet', 'shoulder', 'chest', 'waist', 'legs', 'gloves', 'feet'];
    for (const armorType of ['cloth', 'leather', 'mail'] as const) {
      expect(
        bases
          .filter((base) => base.armorType === armorType && !base.shield)
          .map((base) => base.slot)
          .sort(),
        armorType,
      ).toEqual([...armorSlots].sort());
    }
  });

  it('ships all twelve initial affix families', () => {
    expect(Object.keys(PROCEDURAL_AFFIXES)).toHaveLength(12);
    expect(new Set(Object.values(PROCEDURAL_AFFIXES).map((affix) => affix.family)).size).toBe(12);
  });

  it('gives every affix at least one valid base and every stat a cost', () => {
    for (const affix of Object.values(PROCEDURAL_AFFIXES)) {
      expect(
        Object.values(PROCEDURAL_ITEM_BASES).some((base) => baseEligibleForAffix(base, affix)),
        affix.id,
      ).toBe(true);
      for (const tier of affix.tiers) {
        for (const stat of Object.keys(tier.rolls)) {
          expect(PROCEDURAL_STAT_BUDGET_COST[stat], `${affix.id}:${stat}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps every base pool non-empty and referentially valid', () => {
    for (const pool of Object.values(PROCEDURAL_BASE_POOLS)) {
      expect(pool.baseIds.length, pool.id).toBeGreaterThan(0);
      expect(new Set(pool.baseIds).size, pool.id).toBe(pool.baseIds.length);
      for (const baseId of pool.baseIds)
        expect(PROCEDURAL_ITEM_BASES[baseId], `${pool.id}:${baseId}`).toBeDefined();
    }
  });

  it('keeps rarity count bands at the intended current-scale density', () => {
    expect(PROCEDURAL_RARITIES.common.affixCounts.map((entry) => entry.count)).toEqual([0]);
    expect(PROCEDURAL_RARITIES.magic.affixCounts.map((entry) => entry.count)).toEqual([1, 2]);
    expect(PROCEDURAL_RARITIES.rare.affixCounts.map((entry) => entry.count)).toEqual([3, 4]);
    expect(PROCEDURAL_RARITIES.epic.affixCounts.map((entry) => entry.count)).toEqual([4, 5]);
    expect(PROCEDURAL_RARITIES.legendary.affixCounts.map((entry) => entry.count)).toEqual([3, 4]);
  });

  it('keeps active rarity table weights normalized with conservative live legendary rates', () => {
    const expectedLegendaryRates: Record<string, number> = {
      initial_world: 0.0002,
      initial_rare: 0.002,
      initial_dungeon_boss: 0.02,
    };

    for (const table of Object.values(PROCEDURAL_RARITY_TABLES)) {
      const total = Object.values(table.weights).reduce((sum, weight) => sum + (weight ?? 0), 0);
      expect(total, table.id).toBeCloseTo(1, 12);
      expect(table.weights.legendary, table.id).toBe(expectedLegendaryRates[table.id]);
    }
  });
  it('keeps normalized affix ceilings bounded without sacrificing top-tier capacity', () => {
    const maximumBudgetByTier = [0, 1.5, 6, 10, 16, 24];
    for (const affix of Object.values(PROCEDURAL_AFFIXES)) {
      for (const tier of affix.tiers) {
        const normalizedMaximum = Object.entries(tier.rolls).reduce(
          (sum, [stat, range]) => sum + range.max * PROCEDURAL_STAT_BUDGET_COST[stat],
          0,
        );
        expect(normalizedMaximum, `${affix.id}:tier${tier.tier}:maximum`).toBeLessThanOrEqual(
          maximumBudgetByTier[tier.tier] + 1e-8,
        );
        if (tier.tier === 5)
          expect(normalizedMaximum, `${affix.id}:tier5:capacity`).toBeGreaterThanOrEqual(23);
      }
    }
  });

  it('keeps a deterministic budget-feasible fallback for every reachable v0.30 scenario', () => {
    const rarityBonus = { magic: 0, rare: 0, epic: 1, legendary: 2 } as const;
    let scenarioCount = 0;
    let witnessCount = 0;
    for (const base of Object.values(PROCEDURAL_ITEM_BASES)) {
      for (const rarity of Object.keys(rarityBonus) as (keyof typeof rarityBonus)[]) {
        const minimumItemLevel = Math.max(1, base.sourceLevel - 1 + rarityBonus[rarity]);
        const maximumItemLevel = 21 + rarityBonus[rarity];
        for (let itemLevel = minimumItemLevel; itemLevel <= maximumItemLevel; itemLevel++) {
          const pool = Object.values(PROCEDURAL_AFFIXES).filter(
            (affix) =>
              itemLevel >= affix.minItemLevel &&
              (affix.maxItemLevel === undefined || itemLevel <= affix.maxItemLevel) &&
              baseEligibleForAffix(base, affix),
          );
          const canonicalBudget = calculateProceduralBudget(base, itemLevel, rarity);
          for (const { count } of PROCEDURAL_RARITIES[rarity].affixCounts) {
            const witness = findProceduralBudgetFeasibleAffixSet({
              pool,
              count,
              itemLevel,
              rarity,
              canonicalBudget,
            });
            expect(witness, `${base.id}:${rarity}:${itemLevel}:count${count}`).toHaveLength(count);
            witnessCount++;
          }
          scenarioCount++;
        }
      }
    }
    expect(scenarioCount).toBeGreaterThan(1_000);
    expect(witnessCount).toBeGreaterThan(2_000);
  });
});
