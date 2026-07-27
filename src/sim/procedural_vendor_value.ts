import { PROCEDURAL_ITEM_BASES } from './content/procedural_loot';
import type { ProceduralItemInstance, ProceduralRarity } from './procedural_item';
import type { ItemDef } from './types';

const RARITY_FACTOR: Readonly<Record<ProceduralRarity, number>> = {
  common: 1,
  magic: 1.25,
  rare: 1.65,
  epic: 2.15,
  legendary: 3,
  mythic: 4,
};

export interface ProceduralVendorValueInstance {
  procedural?: Pick<ProceduralItemInstance, 'affixes' | 'baseId' | 'itemLevel' | 'rarity'>;
}

/**
 * Authoritative per-copy vendor value.
 *
 * Static and legacy instances retain the authored ItemDef value. Procedural
 * copies apply the attached economy formula using only persisted fields, so
 * the sale and buyback price cannot drift with player demand or regeneration:
 *
 * base value × item-level factor × rarity factor × affix-count factor.
 */
export function itemVendorSellValue(
  item: Pick<ItemDef, 'sellValue'>,
  instance?: ProceduralVendorValueInstance,
): number {
  const baseValue = Math.max(0, Math.floor(item.sellValue ?? 0));
  const procedural = instance?.procedural;
  if (!procedural || baseValue === 0) return baseValue;

  const base = PROCEDURAL_ITEM_BASES[procedural.baseId];
  if (!base) return baseValue;

  const levelDelta = procedural.itemLevel - base.sourceLevel;
  const itemLevelFactor = Math.min(2.5, Math.max(0.5, 1 + levelDelta * 0.04));
  const rarityFactor = RARITY_FACTOR[procedural.rarity];
  const affixCountFactor = 1 + Math.min(5, procedural.affixes.length) * 0.08;

  return Math.max(1, Math.round(baseValue * itemLevelFactor * rarityFactor * affixCountFactor));
}
