// Divergence-only dialect overlay for "en_CA" over base locale "en".
//
// "en_CA" inherits from "en": the build (scripts/i18n_build.mjs) resolves it as
// nested `en` -> this overlay, so any key absent here falls through to English. This file
// therefore carries ONLY the keys whose value differs from en; every other key is
// intentionally omitted. A key must NOT be re-added with a value equal to en
// (redundant duplication). Every key here must be a real `en` leaf
// path (tests/i18n_overlay_key_membership.test.ts + the byte gate). Keys are in `en`'s
// leaf order.

import type { TranslationKey } from '../i18n.catalog';

export const en_CA: Partial<Record<TranslationKey, string>> = {
  'hudChrome.perf.textColor': 'Text Colour',
  'hudChrome.perf.bgColor': 'Background Colour',
  'hudChrome.perf.colorTheme': 'Colour Theme',
  'hudChrome.perf.thresholds': 'Colour-Coded Warnings',
  'classDetails.labels.armor': 'Armour',
  'classDetails.lore.paladin':
    'Paladins are holy crusaders who support allies with blessings, heal wounds with Holy Light, and protect the weak in heavy armour.',
  'classDetails.lore.druid':
    'Druids channel nature, healing wounds, entangling foes, and shifting into animal forms for defence or damage.',
  'fiesta.category.offense': 'Offence',
  'fiesta.category.defense': 'Defence',
  'itemUi.kind.armor': 'Armour',
  'itemUi.stats.armor': 'Armour',
  'itemUi.tooltip.armorStat': '{value} Armour',
  // Stat tooltips keep the en prose; only the Armor -> Armour spelling diverges.
  'hudChrome.statInfo.effects.armor': '+{value} Armour',
};
