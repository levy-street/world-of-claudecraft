import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { expectedStatTotal, PRIMARY_STATS, primaryStatBudget } from '../src/sim/item_budget';
import { activeItemInstanceStats } from '../src/sim/item_instance_stats';
import { itemInstanceLevel } from '../src/sim/item_level';
import { type LootQualityDescriptor, lootQualityBonuses } from '../src/sim/loot_quality';
import {
  RIFT_BAND_SHELLS,
  riftBandItemLevel,
  riftBandPrimaryStats,
} from '../src/sim/rift/band_ladder';
import { createRiftGearInstance, sanitizeRiftGearInstance } from '../src/sim/rift/progression';
import { Sim } from '../src/sim/sim';
import { cloneItemInstancePayload } from '../src/sim/types';
import { moveToRiftForge } from './helpers/rift_forge';

describe('permanent Rift quality lane', () => {
  it('retains the descriptor through live forge upgrades, socket replacement and character reload', () => {
    const sim = new Sim({ seed: 731, playerClass: 'warrior', autoEquip: false });
    moveToRiftForge(sim);
    sim.setPlayerLevel(20);
    const gear = createRiftGearInstance('quality-forge', 'S', 'warrior', sim.player.id);
    const quality: LootQualityDescriptor = { version: 1, tier: 4, weights: [600, 1, 400, 1, 1] };
    gear.instance.lootQuality = quality;
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.addItem('rift_essence', 40);
    sim.addItem('rift_gem_azure', 1);
    sim.addItem('rift_gem_verdant', 2);
    for (let step = 0; step < 5; step++) expect(sim.upgradeRiftItem(gear.itemId).ok).toBe(true);
    for (const gem of ['rift_gem_azure', 'rift_gem_verdant', 'rift_gem_verdant'])
      expect(sim.socketRiftGem(gear.itemId, gem).ok).toBe(true);
    const current = sim.inventory.find((s) => s.itemId === gear.itemId)!;
    expect(current.instance!.lootQuality).toEqual(quality);
    expect(itemInstanceLevel(ITEMS[gear.itemId], current.instance)).toBe(42);
    expect(activeItemInstanceStats(current.instance, ITEMS[gear.itemId])!.hitRating).toBe(24);
    const save = JSON.parse(JSON.stringify(sim.serializeCharacter(sim.playerId)));
    const loaded = new Sim({ seed: 731, playerClass: 'warrior', autoEquip: false, noPlayer: true });
    const pid = loaded.addPlayer('warrior', 'Reload', { state: save });
    expect(
      loaded.players.get(pid)!.inventory.find((s) => s.itemId === gear.itemId)!.instance,
    ).toEqual({ ...current.instance, boundTo: pid });
  });
  it('keeps exact budgets, guaranteed floors and monotone stats across every rank and upgrade', () => {
    for (const cls of ['warrior', 'rogue', 'mage'] as const) {
      for (const rank of ['C', 'B', 'A', 'S'] as const) {
        for (const tier of [1, 2, 3, 4] as const) {
          for (const pair of [
            [1, 1000],
            [1000, 1],
            [1, 1],
            [9, 10],
            [400, 600],
          ]) {
            const quality: LootQualityDescriptor = {
              version: 1,
              tier,
              weights: [pair[0], pair[0], pair[1], pair[0], pair[1]],
            };
            let previous: Record<string, number> = {};
            for (let upgrade = 0; upgrade <= 5; upgrade++) {
              const { itemId, instance } = createRiftGearInstance(
                'quality-probe',
                rank,
                cls,
                1,
                upgrade,
                ['rift_gem_azure', 'rift_gem_verdant'],
              );
              instance.lootQuality = quality;
              const item = ITEMS[itemId];
              const stats = activeItemInstanceStats(instance, item)!;
              const ordinaryLevel = riftBandItemLevel(rank, upgrade);
              expect(itemInstanceLevel(item, instance)).toBe(ordinaryLevel + tier * 2);
              const total = PRIMARY_STATS.reduce((sum, k) => sum + (stats[k] ?? 0), 0);
              expect(total).toBe(
                expectedStatTotal(
                  primaryStatBudget(ordinaryLevel + tier * 2, 'epic', 'ring'),
                  cls === 'mage' ? 'caster' : 'physical',
                ),
              );
              const floor = riftBandPrimaryStats(
                RIFT_BAND_SHELLS[itemId],
                ordinaryLevel + (tier - 1) * 2,
              );
              for (const key of PRIMARY_STATS) {
                expect(
                  stats[key] ?? 0,
                  `${cls} ${rank} T${tier} +${upgrade} ${key}`,
                ).toBeGreaterThanOrEqual(previous[key] ?? 0);
                expect(stats[key] ?? 0).toBeGreaterThanOrEqual(floor[key] ?? 0);
              }
              expect(stats.hitRating).toBe(12);
              expect(lootQualityBonuses(item, instance).hitRating).toBeUndefined();
              const saved = JSON.parse(JSON.stringify(instance));
              const clean = sanitizeRiftGearInstance(itemId, saved, 1)!;
              expect(clean).toEqual(instance);
              const clone = cloneItemInstancePayload(clean);
              clone.lootQuality!.weights[0] = 500;
              expect(clean.lootQuality!.weights).toEqual(quality.weights);
              previous = stats;
            }
          }
        }
      }
    }
  });
});
