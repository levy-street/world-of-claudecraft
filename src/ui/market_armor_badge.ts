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

// Weight, as a pip count: cloth is the lightest armor and mail the heaviest, so
// the number of pips reads as the armor's weight class. This is what lets the
// symbol carry the distinction with color removed (WCAG 1.4.1, not color-only):
// 1, 2, or 3 pips are countable in grayscale where three same-size colored dots
// are not.
const ARMOR_PIP_COUNT: Record<ArmorType, number> = {
  cloth: 1,
  leather: 2,
  mail: 3,
};

// The Browse-row armor cue markup: a small pip chip that sits on the item icon
// corner. `label` MUST be the caller's already-localized AND already-escaped
// armor-type word (this module stays i18n-runtime-free): it becomes the chip's
// accessible name (aria-label), so the localized word survives for screen readers
// even though the visible cue is a symbol. The pips themselves are aria-hidden so
// a reader announces the word once, not "3 dots". NO native `title`: the Browse
// row already shows the full game item tooltip on hover (attachTooltip), so a
// second native tooltip on the chip would stack on top of it, and a title
// duplicating the aria-label makes a verbose reader announce the word twice.
export function marketArmorPips(armorType: ArmorType, label: string): string {
  const pips = ARMOR_PIP_COUNT[armorType];
  const dots = Array.from({ length: pips }, () => '<span class="mkt-pip"></span>').join('');
  return (
    `<span class="mkt-armor-pips mkt-armor-pips--${armorType}" role="img"` +
    ` aria-label="${label}"><span class="mkt-pip-row" aria-hidden="true">${dots}</span></span>`
  );
}

// A heroic item is either a generated heroic VARIANT (heroicOf points at its base
// id) or a bespoke heroic-tier item (heroic === true). Both are the same "this is
// the heroic tier" distinction the tooltip shows as the [HEROIC] tag.
export function isHeroicItem(item: ItemDef): boolean {
  return item.heroicOf !== undefined || item.heroic === true;
}

// The heroic mark for a Browse row: a small gold star on the icon's TOP-LEFT
// corner (the armor pips ride the bottom-right, so they never collide). Returns
// '' for a non-heroic item. `label` MUST be the caller's already-localized AND
// escaped standalone "Heroic" word (this module stays i18n-runtime-free): it
// becomes the star's accessible name so the heroic distinction reaches a screen
// reader, while the star glyph itself is aria-hidden decoration. NO native
// `title` (same reason as marketArmorPips: the row's game tooltip already fires
// on hover, and a title duplicating the aria-label double-announces).
export function marketHeroicStar(item: ItemDef, label: string): string {
  if (!isHeroicItem(item)) return '';
  return (
    `<span class="mkt-heroic-star" role="img" aria-label="${label}">` +
    `<span aria-hidden="true">★</span></span>`
  );
}
