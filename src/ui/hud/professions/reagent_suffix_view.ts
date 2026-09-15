// The reagent-line suffixes: the words the crafting window appends to one
// reagent's "name xhave/required" line. Three suffixes, one rule: every one is
// stated in WORDS (the fairness rule, never color alone) and rendered on the
// visible line, the row's aria fold, and the hover tooltip alike, so the
// painter composes them from one place.
//
// - fine substitution (the UX pass): the craft would spend fine-grade units
//   because base stock runs short (D8 downward substitution, 2x gather value).
// - vault draw (Bank Storage Phase 04): the craft would draw units from the
//   Materials Vault because carried stock runs short.
// - ordinary held (the Bronze Hoe report): the row asks for a fine grade the
//   player holds only the PLAIN twin of, so the 0/n has a reason beside it.
//
// Extracted from crafting_window.ts when the third suffix made the trio a
// nameable responsibility (the rule of three); the painter stays a thin
// consumer. DOM/Three-free (registered in tests/architecture.test.ts
// UI_PURE_CORES).

import { itemDisplayName } from '../../entity_i18n';
import { formatNumber, t } from '../../i18n';
import type { CraftingReagentRow } from './crafting_view';

const whole = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

/** The fine-substitution suffix, leading space included, or '' at 0. */
export function fineSubText(count: number): string {
  return count > 0 ? ` ${t('hudChrome.crafting.reagentFineSub', { count: whole(count) })}` : '';
}

/** The vault-draw suffix, leading space included, or '' at 0. */
export function vaultDrawText(count: number): string {
  return count > 0 ? ` ${t('hudChrome.crafting.reagentVaultDraw', { count: whole(count) })}` : '';
}

/** The ordinary-grade note, leading space included, or '' when the row holds
 *  none of its plain twin (or has none). Names the TWIN, never the fine
 *  reagent: the def when the catalog has it, else the twin's id. */
export function ordinaryHeldText(
  row: Pick<CraftingReagentRow, 'ordinaryHeld' | 'ordinaryItem' | 'ordinaryItemId'>,
): string {
  if (row.ordinaryHeld <= 0 || row.ordinaryItemId === undefined) return '';
  return ` ${t('hudChrome.crafting.reagentOrdinaryHeld', {
    count: whole(row.ordinaryHeld),
    name: row.ordinaryItem ? itemDisplayName(row.ordinaryItem) : row.ordinaryItemId,
  })}`;
}
