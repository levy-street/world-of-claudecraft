// Pure, host-agnostic core for the disenchant confirm's expected-yield preview.
// The destroy confirm used to say only that materials come out; a player had no
// way to know WHICH material or HOW MANY before an irreversible destroy. This
// models exactly what src/sim/professions/enchanting.ts resolveDisenchant grants,
// reading the sim's OWN pure functions and tables rather than restating them, so
// the preview can never drift from the grant:
//   - the primary is DISENCHANT_MATERIAL_BY_QUALITY[quality]; a rare-or-better
//     piece grants exactly 1, a sub-rare piece grants baseDisenchantYield to
//     maxDisenchantYield (the single +0/+1 rng bonus arm),
//   - the typed secondary is disenchant_reagents.ts typedSecondaryFor: absent
//     below rare and on a piece with no typed material (jewelry), exactly 1 on a
//     rare piece, 1 to 2 (one rng draw) on an epic/legendary piece.
// It is a PREVIEW, never a promise the client enforces: the server stays
// authoritative and the confirm's own OK path still just sends the command.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ITEMS } from '../sim/data';
import { typedSecondaryFor } from '../sim/professions/disenchant_reagents';
import {
  baseDisenchantYield,
  DISENCHANT_MATERIAL_BY_QUALITY,
  isDisenchantable,
  maxDisenchantYield,
} from '../sim/professions/enchanting';
import type { ItemDef } from '../sim/types';
import { itemDisplayName } from './entity_i18n';
import { formatNumber, t } from './i18n';

/** One material line of the preview: the item and the inclusive count range it
 *  can come out at. `min === max` is an exact count, not a range. */
export interface DisenchantYieldLine {
  itemId: string;
  min: number;
  max: number;
}

export interface DisenchantYieldPreview {
  primary: DisenchantYieldLine;
  /** The typed bind-on-trade secondary, absent below rare and on a rare+ piece
   *  with no typed material. */
  secondary?: DisenchantYieldLine;
}

/** The material yield one disenchant of `def` can produce, or null when the
 *  piece is not disenchantable at all (the confirm never opens for those, but
 *  the null keeps the core total). Pure: no rng draw, no side effects. */
export function disenchantYieldPreview(def: ItemDef | undefined): DisenchantYieldPreview | null {
  if (!isDisenchantable(def) || !def) return null;
  const quality = def.quality ?? 'common';
  const isRarePlus = quality === 'rare' || quality === 'epic' || quality === 'legendary';
  const primaryItemId = DISENCHANT_MATERIAL_BY_QUALITY[quality] ?? 'arcane_dust';
  const primary: DisenchantYieldLine = isRarePlus
    ? { itemId: primaryItemId, min: 1, max: 1 }
    : { itemId: primaryItemId, min: baseDisenchantYield(def), max: maxDisenchantYield(def) };
  const secondaryItemId = typedSecondaryFor(def);
  if (!secondaryItemId) return { primary };
  // rare grants exactly one secondary with no rng draw; epic/legendary rolls
  // one or two off a single draw.
  const secondary: DisenchantYieldLine =
    quality === 'rare'
      ? { itemId: secondaryItemId, min: 1, max: 1 }
      : { itemId: secondaryItemId, min: 1, max: 2 };
  return { primary, secondary };
}

function count(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

/** One preview line as localized plain text: an exact count reads "3 Chime
 *  Dust", a range reads "2 to 3 Chime Dust". Plain text, not HTML: the confirm
 *  dialog escapes its whole body. */
export function disenchantYieldLineText(line: DisenchantYieldLine): string {
  const item = itemDisplayName(ITEMS[line.itemId]);
  return line.min === line.max
    ? t('hudChrome.enchanting.yieldLineExact', {
        count: count(line.min),
        item,
      })
    : t('hudChrome.enchanting.yieldLineRange', {
        min: count(line.min),
        max: count(line.max),
        item,
      });
}

/** The full preview as localized plain-text lines (header first), or an empty
 *  array when the item yields nothing previewable. The caller joins them into
 *  the confirm body. */
export function disenchantYieldLines(def: ItemDef | undefined): string[] {
  const preview = disenchantYieldPreview(def);
  if (!preview) return [];
  const lines = [t('hudChrome.enchanting.yieldHeader')];
  lines.push(disenchantYieldLineText(preview.primary));
  if (preview.secondary) lines.push(disenchantYieldLineText(preview.secondary));
  return lines;
}
