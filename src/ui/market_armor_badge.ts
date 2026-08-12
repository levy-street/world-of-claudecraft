// Pure resolver: the World Market Browse row's cloth/leather/mail badge.
// Reuses the sim's armorTypeForItem (source of truth for the classification) and
// item_armor_type's label key so the market row shows the same armor-type vocabulary
// as the tooltip slot line, instead of a second one. DOM-free and i18n-runtime-free
// (returns a translation key, not resolved text), unit-tested in
// tests/market_armor_badge.test.ts.
import { armorTypeForItem } from '../sim/equipment_rules';
import type { ArmorType, ItemDef } from '../sim/types';
import type { TranslationKey } from './i18n';
import { itemArmorTypeLabelKey } from './item_armor_type';

export interface MarketArmorBadge {
  readonly armorType: ArmorType;
  readonly labelKey: TranslationKey;
}

// Returns the Browse row armor badge for an item, or null for non-armor listings
// (weapons, bags, materials, and so on show no badge).
export function marketArmorBadge(item: ItemDef): MarketArmorBadge | null {
  const armorType = armorTypeForItem(item);
  const labelKey = itemArmorTypeLabelKey(item);
  if (!armorType || !labelKey) return null;
  return { armorType, labelKey };
}
