// Shared corner-mark HTML + accessible-name keys for every inventory cell that
// paints an owned item stack (bags, personal bank, guild bank). The KIND
// priorities live in the pure cores (bag_instance_glyph_view.ts for per-copy
// kinds, bag_corner_mark_view.ts for the cross-mark corner priority); this is
// the thin markup so every surface paints the same masterwork seal,
// enchanted/signed/bound glyph, generic wedge, or fine-grade seal. Marks are
// aria-hidden: the cell's accessible name carries the per-copy fact via
// INSTANCE_GLYPH_ARIA_KEYS (or the unknown-id siblings); the fine grade needs
// no aria arm because the item NAME carries the grade word in every locale.
//
// The mark FAMILY is all-surfaces by rule: a new mark (grade, purpose, or
// per-copy) is minted here and painted by bags, bank, AND guild bank in the
// same change, never inlined into one window (the fine seal shipped bag-only
// once and the bank gap was a reported defect). The one REACHABILITY
// exception is the quest-purpose seal: quest items cannot enter either bank,
// so only bags can ever mint it, but its markup still lives here so
// cornerMarkHtml is the one exhaustive dispatch. Each helper mints ONE mark
// from a resolved kind.

import type { BagCornerMark } from './bag_corner_mark_view';
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

/** Fine-grade corner seal (bag_fine_mark_view.ts decides WHICH stacks wear it,
 *  bag_corner_mark_view.ts decides when it wins the corner): a small crafting
 *  glyph in refined teal, identical on every surface. Aria-hidden; a fine id's
 *  item NAME already announces the grade, so no aria key exists for it. */
export function fineSealMarkHtml(): string {
  return `<span class="bi-fine-seal" aria-hidden="true">${svgIcon('crafting')}</span>`;
}

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

/** Corner-mark HTML for the RESOLVED corner kind (bag_corner_mark_view.ts
 *  bagCornerMark): the one exhaustive dispatch, so a painter never re-derives
 *  the corner from the raw glyph kind (a future corner kind would otherwise
 *  silently paint a per-copy glyph where the core said otherwise). The quest
 *  seal takes the caller's questReady state; the banks pass a null quest arm
 *  into bagCornerMark, so that arm only ever mints for bags. */
export function cornerMarkHtml(mark: BagCornerMark, opts?: { questReady?: boolean }): string {
  if (mark === null) return '';
  if (mark === 'fine') return fineSealMarkHtml();
  if (mark === 'quest') {
    return `<span class="bi-quest-seal${opts?.questReady ? ' bi-quest-seal-ready' : ''}" aria-hidden="true">${svgIcon('questlog')}</span>`;
  }
  return instanceGlyphMarkHtml(mark);
}
