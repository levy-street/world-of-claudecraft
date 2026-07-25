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
      initial_dungeon_boss: 0.01,
    };

    for (const table of Object.values(PROCEDURAL_RARITY_TABLES)) {
      const total = Object.values(table.weights).reduce((sum, weight) => sum + (weight ?? 0), 0);
      expect(total, table.id).toBeCloseTo(1, 12);
      expect(table.weights.legendary, table.id).toBe(expectedLegendaryRates[table.id]);
    }
  });
});
