// Pure resolver: maps a weapon item id to the i18n key for its type label
// (Sword / Dagger / Mace / Axe / Staff / Wand / Polearm / Bow / Crossbow) shown
// on its own plain line in the tooltip, under the quality/kind line and above the
// slot line. The decision of WHICH type a weapon is lives in the sim's
// weaponTypeForItem (the test-guarded WEAPON_TYPE_BY_ITEM map, heroic-aware); this
// leaf only turns that type into a label key so the HUD consumer stays a thin
// lookup. Unlike the armor-weight row, the type is NEVER colored by class: any
// class can equip most weapon types and the class/weapon rules are archetype-based,
// not type-based, so a red label would mislead. DOM-free and i18n-runtime-free,
// unit-tested in tests/weapon_type_label.test.ts.
import type { ItemWeaponType } from '../sim/content/weapon_skin_rules';
import { weaponTypeForItem } from '../sim/content/weapon_skin_rules';
import type { TranslationKey } from './i18n';

// The singular type labels live in the shared wtype catalog group (the same
// labels the Armory store uses via armory_labels.weaponTypeLabel); polearm was
// added there for this line, since no skin targets it.
const WEAPON_TYPE_LABEL_KEY: Record<ItemWeaponType, TranslationKey> = {
  sword: 'hudChrome.wocStore.wtype.sword',
  axe: 'hudChrome.wocStore.wtype.axe',
  mace: 'hudChrome.wocStore.wtype.mace',
  dagger: 'hudChrome.wocStore.wtype.dagger',
  staff: 'hudChrome.wocStore.wtype.staff',
  wand: 'hudChrome.wocStore.wtype.wand',
  bow: 'hudChrome.wocStore.wtype.bow',
  crossbow: 'hudChrome.wocStore.wtype.crossbow',
  polearm: 'hudChrome.wocStore.wtype.polearm',
};

// Returns the label key for the weapon's type, or null when the id does not
// classify (the map is test-guarded to cover every weapon item, so a null here
// means a non-weapon or unclassified id: the caller renders the slot line
// without a type rather than a broken chip).
export function weaponTypeLabelKey(itemId: string | null | undefined): TranslationKey | null {
  const type = weaponTypeForItem(itemId);
  return type ? WEAPON_TYPE_LABEL_KEY[type] : null;
}
