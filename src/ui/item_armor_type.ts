// Pure resolver: maps an item to the i18n key for its armor subtype label
// (Cloth / Leather / Mail) shown on the tooltip slot line. The decision of WHICH
// armor type an item is lives in the sim's armorTypeForItem; this leaf only turns
// that into a label key so the
// HUD consumer stays a thin lookup. DOM-free and i18n-runtime-free, unit-tested in
// tests/item_armor_type.test.ts.
import { armorTypeForItem } from '../sim/equipment_rules';
import type { ArmorType, ItemDef } from '../sim/types';
import type { TranslationKey } from './i18n';

const ARMOR_TYPE_LABEL_KEY: Record<ArmorType, TranslationKey> = {
  cloth: 'hudChrome.itemArmorType.cloth',
  leather: 'hudChrome.itemArmorType.leather',
  mail: 'hudChrome.itemArmorType.mail',
};

// Returns the label key for the item's armor subtype, or null for non-armor items.
export function itemArmorTypeLabelKey(item: ItemDef): TranslationKey | null {
  const armorType = armorTypeForItem(item);
  return armorType ? ARMOR_TYPE_LABEL_KEY[armorType] : null;
}
