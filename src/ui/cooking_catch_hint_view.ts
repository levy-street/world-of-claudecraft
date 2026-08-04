// Purpose-hint keys for raw fishing catches that are cooking reagents only.
// Data half of the material_hint_view pattern: item id -> one shared
// translation key. All seven locked raw catches share the same sentence
// (they are cooking ingredients and must be cooked before eating). No markup:
// the host paints via createTooltipLine (tooltip_line.ts) so this feature
// does not grow materialHintLine's HTML-string path.
//
// Reuses RAW_COOKING_CATCH_IDS from content; does not re-list catch ids.
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { isRawCookingCatch } from '../sim/content/items';
import type { TranslationKey } from './i18n';

/** Shared purpose key for every raw cooking catch. */
export const COOKING_CATCH_HINT_KEY =
  'hudChrome.materialHint.cookingCatch' as const satisfies TranslationKey;

/** The cooking-ingredient purpose key for one item id, or undefined. */
export function cookingCatchHintKey(itemId: string): TranslationKey | undefined {
  return isRawCookingCatch(itemId) ? COOKING_CATCH_HINT_KEY : undefined;
}
