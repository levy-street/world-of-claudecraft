import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import {
  deriveProceduralItemSeed,
  formatProceduralItemUid,
  generateProceduralItem,
} from '../src/sim/loot/procedural';
import type { ItemDropContext, ProceduralRarity } from '../src/sim/procedural_item';
import type { PlayerClass } from '../src/sim/types';

export interface ProceduralLootSimulationOptions {
  poolId: string;
  rarityTableId: string;
  itemLevel: number;
  count: number;
  worldSeed: number;
  personalLootClass?: PlayerClass;
}

export interface ProceduralLootSimulationReport {
  version: 1;
  options: ProceduralLootSimulationOptions;
  rarityCounts: Record<string, number>;
  rarityRates: Record<string, number>;
  baseCounts: Record<string, number>;
  affixCounts: Record<string, number>;
  affixRatesPerAffixSlot: Record<string, number>;
  affixCountCounts: Record<string, number>;
  itemLevelCounts: Record<string, number>;
  rollPercentileDeciles: number[];
  totalAffixSlots: number;
  averageAffixBudget: number;
  maximumAffixBudget: number;
  averageItemAffixBudget: number;
  maximumItemAffixBudget: number;
  classUsableCount: number;
  classUsableRate: number;
  duplicateUidCount: number;
  duplicateFamilyCount: number;
  invalidValueCount: number;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function rates(counts: Record<string, number>, denominator: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, Number((value / denominator).toFixed(8))]),
  );
}

function sourceForTable(rarityTableId: string): ItemDropContext['source'] {
  if (rarityTableId.includes('dungeon')) return 'dungeon';
  if (rarityTableId.includes('rare')) return 'rare';
  return 'world';
}

export function simulateProceduralLoot(
  options: ProceduralLootSimulationOptions,
): ProceduralLootSimulationReport {
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 1_000_000)
    throw new Error('simulation count must be an integer from 1 to 1000000');
  if (!Number.isInteger(options.itemLevel) || options.itemLevel < 1 || options.itemLevel > 40)
    throw new Error('simulation item level must be an integer from 1 to 40');

  const rarityCounts: Record<string, number> = {};
  const baseCounts: Record<string, number> = {};
  const affixCounts: Record<string, number> = {};
  const affixCountCounts: Record<string, number> = {};
  const itemLevelCounts: Record<string, number> = {};
  const rollPercentileDeciles = Array.from({ length: 10 }, () => 0);
  const uids = new Set<string>();
  let duplicateUidCount = 0;
  let duplicateFamilyCount = 0;
  let invalidValueCount = 0;
  let totalAffixSlots = 0;
  let totalAffixBudget = 0;
  let maximumAffixBudget = 0;
  let totalItemAffixBudget = 0;
  let maximumItemAffixBudget = 0;
  let classUsableCount = 0;

  for (let index = 0; index < options.count; index++) {
    const context: ItemDropContext = {
      source: sourceForTable(options.rarityTableId),
      sourceEntityId: 10_000 + (index % 2048),
      sourceSpawnSequence: Math.floor(index / 2048),
      lootSlotIndex: index % 8,
      ...(options.personalLootClass && { recipientId: 1 }),
      sourceTemplateId: `simulation_${options.rarityTableId}`,
      sourceTags: ['simulation'],
    };
    const seed = deriveProceduralItemSeed(options.worldSeed, context);
    const uid = formatProceduralItemUid('simulation', index);
    const drop = generateProceduralItem({
      seed,
      uid,
      context,
      basePoolId: options.poolId,
      rarityTableId: options.rarityTableId,
      sourceItemLevel: options.itemLevel,
      personalLootClass: options.personalLootClass,
    });
    const item = drop.instance.procedural;
    increment(rarityCounts, item.rarity);
    increment(baseCounts, item.baseId);
    increment(affixCountCounts, String(item.affixes.length));
    increment(itemLevelCounts, String(item.itemLevel));
    if (uids.has(item.uid)) duplicateUidCount++;
    else uids.add(item.uid);

    const base = PROCEDURAL_ITEM_BASES[item.baseId];
    if (
      !options.personalLootClass ||
      !base.requiredClass ||
      base.requiredClass.includes(options.personalLootClass)
    )
      classUsableCount++;

    const families = new Set<string>();
    let itemBudget = 0;
    for (const affix of item.affixes) {
      increment(affixCounts, affix.affixId);
      totalAffixSlots++;
      totalAffixBudget += affix.budget;
      itemBudget += affix.budget;
      maximumAffixBudget = Math.max(maximumAffixBudget, affix.budget);
      if (families.has(affix.family)) duplicateFamilyCount++;
      families.add(affix.family);
      for (const [stat, value] of Object.entries(affix.values)) {
        const range = affix.ranges[stat];
        if (!range || !Number.isFinite(value) || value < range.min || value > range.max) {
          invalidValueCount++;
          continue;
        }
        const width = range.max - range.min;
        const percentile = width <= 0 ? 1 : (value - range.min) / width;
        const decile = Math.min(9, Math.max(0, Math.floor(percentile * 10)));
        rollPercentileDeciles[decile]++;
      }
    }
    totalItemAffixBudget += itemBudget;
    maximumItemAffixBudget = Math.max(maximumItemAffixBudget, itemBudget);
  }

  return {
    version: 1,
    options: { ...options },
    rarityCounts,
    rarityRates: rates(rarityCounts, options.count),
    baseCounts,
    affixCounts,
    affixRatesPerAffixSlot: rates(affixCounts, Math.max(1, totalAffixSlots)),
    affixCountCounts,
    itemLevelCounts,
    rollPercentileDeciles,
    totalAffixSlots,
    averageAffixBudget: Number((totalAffixBudget / Math.max(1, totalAffixSlots)).toFixed(6)),
    maximumAffixBudget,
    averageItemAffixBudget: Number((totalItemAffixBudget / options.count).toFixed(6)),
    maximumItemAffixBudget,
    classUsableCount,
    classUsableRate: Number((classUsableCount / options.count).toFixed(8)),
    duplicateUidCount,
    duplicateFamilyCount,
    invalidValueCount,
  };
}

export const SIMULATION_RARITY_ORDER: readonly ProceduralRarity[] = [
  'common',
  'magic',
  'rare',
  'epic',
  'legendary',
  'mythic',
];
