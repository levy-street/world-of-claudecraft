import type { ItemTag } from '../../procedural_item';
import { PROCEDURAL_AFFIXES, PROCEDURAL_STAT_BUDGET_COST } from './affixes';
import { PROCEDURAL_ITEM_BASES } from './bases';
import { PROCEDURAL_BASE_POOLS } from './pools';
import { PROCEDURAL_RARITIES, PROCEDURAL_RARITY_TABLES } from './rarity';
import type { AffixDefinition, ProceduralItemBase } from './types';

function baseEligibleForAffix(base: ProceduralItemBase, affix: AffixDefinition): boolean {
  const tags = new Set<ItemTag>(base.tags);
  if (!affix.tags.some((tag) => tags.has(tag))) return false;
  return !affix.excludedTags?.some((tag) => tags.has(tag));
}

export function validateProceduralLootContent(): string[] {
  const errors: string[] = [];

  for (const [id, base] of Object.entries(PROCEDURAL_ITEM_BASES)) {
    if (id !== base.id) errors.push(`base key ${id} does not match id ${base.id}`);
    if (!Number.isFinite(base.sourceLevel) || base.sourceLevel < 1)
      errors.push(`base ${id} has invalid sourceLevel`);
    if (!Number.isFinite(base.slotMultiplier) || base.slotMultiplier <= 0)
      errors.push(`base ${id} has invalid slotMultiplier`);
    if (base.tags.length === 0) errors.push(`base ${id} has no tags`);
    if (base.kind === 'weapon' && !base.baseWeapon)
      errors.push(`weapon base ${id} has no baseWeapon`);
    if (base.kind !== 'weapon' && base.baseWeapon)
      errors.push(`non-weapon base ${id} has baseWeapon`);
  }

  for (const [id, affix] of Object.entries(PROCEDURAL_AFFIXES)) {
    if (id !== affix.id) errors.push(`affix key ${id} does not match id ${affix.id}`);
    if (!Number.isFinite(affix.weight) || affix.weight <= 0)
      errors.push(`affix ${id} has invalid weight`);
    if (affix.tiers.length === 0) errors.push(`affix ${id} has no tiers`);
    if (!Object.values(PROCEDURAL_ITEM_BASES).some((base) => baseEligibleForAffix(base, affix)))
      errors.push(`affix ${id} has no eligible base`);
    let lastLevel = -1;
    let lastTier = -1;
    for (const tier of affix.tiers) {
      if (tier.tier <= lastTier) errors.push(`affix ${id} tiers are not ascending`);
      if (tier.minItemLevel <= lastLevel)
        errors.push(`affix ${id} item-level tiers are not ascending`);
      if (!Number.isFinite(tier.budgetCost) || tier.budgetCost <= 0)
        errors.push(`affix ${id} tier ${tier.tier} has invalid budget cost`);
      for (const [stat, roll] of Object.entries(tier.rolls)) {
        if (!(stat in PROCEDURAL_STAT_BUDGET_COST))
          errors.push(`affix ${id} stat ${stat} has no budget cost`);
        if (!Number.isFinite(roll.min) || !Number.isFinite(roll.max) || roll.min > roll.max)
          errors.push(`affix ${id} tier ${tier.tier} has invalid ${stat} range`);
        if (roll.step !== undefined && (!Number.isFinite(roll.step) || roll.step <= 0))
          errors.push(`affix ${id} tier ${tier.tier} has invalid ${stat} step`);
      }
      lastLevel = tier.minItemLevel;
      lastTier = tier.tier;
    }
  }

  for (const [id, pool] of Object.entries(PROCEDURAL_BASE_POOLS)) {
    if (id !== pool.id) errors.push(`pool key ${id} does not match id ${pool.id}`);
    if (pool.baseIds.length === 0) errors.push(`pool ${id} is empty`);
    for (const baseId of pool.baseIds) {
      if (!PROCEDURAL_ITEM_BASES[baseId])
        errors.push(`pool ${id} references unknown base ${baseId}`);
    }
  }

  for (const [id, rarity] of Object.entries(PROCEDURAL_RARITIES)) {
    if (id !== rarity.id) errors.push(`rarity key ${id} does not match id ${rarity.id}`);
    if ((rarity.affixCounts as readonly unknown[]).length === 0)
      errors.push(`rarity ${id} has no affix counts`);
    for (const entry of rarity.affixCounts) {
      if (!Number.isInteger(entry.count) || entry.count < 0 || entry.count > 5)
        errors.push(`rarity ${id} has invalid affix count`);
      if (!Number.isFinite(entry.weight) || entry.weight <= 0)
        errors.push(`rarity ${id} has invalid affix-count weight`);
    }
  }

  for (const [id, table] of Object.entries(PROCEDURAL_RARITY_TABLES)) {
    if (id !== table.id) errors.push(`rarity table key ${id} does not match id ${table.id}`);
    const total = Object.values(table.weights).reduce<number>(
      (sum, weight) => sum + (weight ?? 0),
      0,
    );
    if (Math.abs(total - 1) > 1e-9) errors.push(`rarity table ${id} weights total ${total}`);
    for (const [rarity, weight] of Object.entries(table.weights)) {
      if (!(rarity in PROCEDURAL_RARITIES))
        errors.push(`rarity table ${id} references unknown rarity ${rarity}`);
      if (!Number.isFinite(weight) || weight <= 0)
        errors.push(`rarity table ${id} has invalid weight for ${rarity}`);
    }
  }

  return errors;
}

export function assertValidProceduralLootContent(): void {
  const errors = validateProceduralLootContent();
  if (errors.length > 0)
    throw new Error(`Invalid procedural loot content:\n${errors.map((e) => `- ${e}`).join('\n')}`);
}

export { baseEligibleForAffix };
