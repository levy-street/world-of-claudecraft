import { describe, expect, it } from 'vitest';
import { simulateProceduralLoot } from '../scripts/procedural_loot_sim_core';
import { PROCEDURAL_BASE_ITEMS } from '../src/sim/content/procedural_loot/item_defs';
import { canEquipItem } from '../src/sim/equipment_rules';

describe('procedural loot distribution', () => {
  it('holds the initial world table inside deterministic frequency envelopes', () => {
    const report = simulateProceduralLoot({
      poolId: 'initial_world',
      rarityTableId: 'initial_world',
      itemLevel: 18,
      count: 50_000,
      worldSeed: 13_371_337,
    });
    expect(report.rarityRates.common).toBeGreaterThan(0.69);
    expect(report.rarityRates.common).toBeLessThan(0.71);
    expect(report.rarityRates.magic).toBeGreaterThan(0.24);
    expect(report.rarityRates.magic).toBeLessThan(0.26);
    expect(report.rarityRates.rare).toBeGreaterThan(0.045);
    expect(report.rarityRates.rare).toBeLessThan(0.055);
    expect(report.rarityRates.epic ?? 0).toBeGreaterThan(0.0035);
    expect(report.rarityRates.epic ?? 0).toBeLessThan(0.0065);
    expect(report.rarityRates.legendary ?? 0).toBeGreaterThan(0);
    expect(report.rarityRates.legendary ?? 0).toBeLessThan(0.001);
    expect(report.duplicateUidCount).toBe(0);
    expect(report.duplicateFamilyCount).toBe(0);
    expect(report.invalidValueCount).toBe(0);
  });

  it('keeps smart loot biased but not exclusive for every class', () => {
    const classes = [
      'warrior',
      'paladin',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'mage',
      'warlock',
      'druid',
    ] as const;
    for (const personalLootClass of classes) {
      const report = simulateProceduralLoot({
        poolId: 'initial_all',
        rarityTableId: 'initial_world',
        itemLevel: 18,
        count: 10_000,
        worldSeed: 9000 + classes.indexOf(personalLootClass),
        personalLootClass,
      });
      expect(report.classUsableRate, personalLootClass).toBeGreaterThan(0.5);
      const expectedUsableCount = Object.entries(report.baseCounts).reduce(
        (sum, [baseId, count]) =>
          sum + (canEquipItem(personalLootClass, PROCEDURAL_BASE_ITEMS[baseId]) ? count : 0),
        0,
      );
      expect(report.classUsableCount, `${personalLootClass}:equip-rule parity`).toBe(
        expectedUsableCount,
      );
      expect(1 - report.classUsableRate, `${personalLootClass}:off-class rate`).toBeGreaterThan(
        0.02,
      );
      if (personalLootClass === 'shaman')
        expect(report.classUsableRate, personalLootClass).toBeLessThan(0.97);
    }
  });

  it('is exactly reproducible for an identical options object', () => {
    const options = {
      poolId: 'initial_dungeon_boss',
      rarityTableId: 'initial_dungeon_boss',
      itemLevel: 20,
      count: 5000,
      worldSeed: 20260724,
    };
    expect(simulateProceduralLoot(options)).toEqual(simulateProceduralLoot(options));
  });

  it('reports a stable versioned digest surface for review', () => {
    const report = simulateProceduralLoot({
      poolId: 'initial_world',
      rarityTableId: 'initial_world',
      itemLevel: 18,
      count: 10_000,
      worldSeed: 42,
    });
    expect({
      version: report.version,
      rarityCounts: report.rarityCounts,
      affixCountCounts: report.affixCountCounts,
      itemLevelCounts: report.itemLevelCounts,
      averageItemAffixBudget: report.averageItemAffixBudget,
      maximumItemAffixBudget: report.maximumItemAffixBudget,
    }).toMatchInlineSnapshot(`
      {
        "affixCountCounts": {
          "0": 7048,
          "1": 1346,
          "2": 1060,
          "3": 348,
          "4": 171,
          "5": 27,
        },
        "averageItemAffixBudget": 3.662585,
        "itemLevelCounts": {
          "17": 3266,
          "18": 3309,
          "19": 3397,
          "20": 27,
          "21": 1,
        },
        "maximumItemAffixBudget": 33.25,
        "rarityCounts": {
          "common": 7048,
          "epic": 58,
          "legendary": 2,
          "magic": 2406,
          "rare": 486,
        },
        "version": 1,
      }
    `);
  });
});
