// Shared corner-mark HTML + accessible-name keys for every inventory cell that
// paints an instanced copy (bags, personal bank, guild bank). The KIND priority
// lives in bag_instance_glyph_view.ts (pure core); this is the thin markup so
// every surface paints the same masterwork seal, enchanted/signed/bound glyph,
// or generic wedge. The mark is aria-hidden: the cell's accessible name carries
// the per-copy fact via INSTANCE_GLYPH_ARIA_KEYS (or the unknown-id siblings).
//
// Quest-purpose seals stay bag-only (quest items cannot enter the bank), so the
// bags painter composes masterwork > quest > other instance marks itself. This
// helper only mints ONE instance mark from a resolved kind.

import type { BagInstanceGlyphKind } from './bag_instance_glyph_view';
import type { TranslationKey } from './i18n';
import { MASTERWORK_SEAL_IMAGE_URL } from './profession_art';
import { svgIcon, type UiIconName } from './ui_icons';

// Procedural chrome glyph each non-masterwork kind paints. Masterwork keeps its
// authored seal image; generic keeps the CSS wedge. No binary asset is added.
const GLYPH_ICONS: Readonly<Record<'enchanted' | 'signed' | 'bound', UiIconName>> = {
  enchanted: 'enchant-rune',
  signed: 'makers-mark',
  bound: 'bond-link',
};

/** Accessible name each corner kind gives its CELL. The glyph is aria-hidden, so
 *  this is the only channel carrying the per-copy fact to assistive tech. */
export const INSTANCE_GLYPH_ARIA_KEYS: Readonly<
  Record<NonNullable<BagInstanceGlyphKind>, TranslationKey>
> = {
  masterwork: 'hudChrome.bags.itemAriaMasterwork',
  enchanted: 'hudChrome.bags.itemAriaEnchanted',
  signed: 'hudChrome.bags.itemAriaInstanced',
  bound: 'hudChrome.bags.itemAriaBound',
  generic: 'hudChrome.bags.itemAriaInstanced',
};

/** Unknown-id siblings: keep the UNKNOWN signal beside the per-copy flag. */
export const UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS: Readonly<
  Record<NonNullable<BagInstanceGlyphKind>, TranslationKey>
> = {
  masterwork: 'itemUi.bags.unknownItemAriaMasterwork',
  enchanted: 'itemUi.bags.unknownItemAriaEnchanted',
  signed: 'itemUi.bags.unknownItemAriaInstanced',
  bound: 'itemUi.bags.unknownItemAriaBound',
  generic: 'itemUi.bags.unknownItemAriaInstanced',
};

/** Corner-mark HTML for one resolved kind, or '' when null (plain fungible). */
export function instanceGlyphMarkHtml(kind: BagInstanceGlyphKind): string {
  if (kind === null) return '';
  if (kind === 'masterwork') {
    return `<img class="bi-masterwork-seal" src="${MASTERWORK_SEAL_IMAGE_URL}" alt="" aria-hidden="true" draggable="false">`;
  }
  if (kind === 'generic') {
    return '<span class="bi-instance" aria-hidden="true"></span>';
  }
  return `<span class="bi-glyph bi-glyph-${kind}" aria-hidden="true">${svgIcon(GLYPH_ICONS[kind])}</span>`;
}
