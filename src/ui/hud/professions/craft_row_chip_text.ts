// The craft row's chips in words: the skill-gain difficulty label and the cast
// duration. Its own module so the crafting painter composes the wording (the
// painter is on the monolith ratchet, tests/monolith_budget.test.ts) and a test
// can drive both without building a row.

import { formatNumber, type TranslationKey, t } from '../../i18n';
import type { CraftDifficulty } from './crafting_view';

// Skill-gain difficulty labels, the classic four-color recipe intuition
// orange = full gains, yellow = reduced, green = minimal,
// gray = none. The tints live in CSS (`.crafting-difficulty[data-difficulty]`
// over the --color-craft-* tokens in tokens.css), keyed by the data attribute
// the painter writes. A tint is only ever a HINT: the adjacent difficulty LABEL
// and the aria text carry the same information, and both are identical on every
// graphics preset/tier (docs/design/graphics-settings-fairness.md).
const DIFFICULTY_LABEL_KEY: Record<CraftDifficulty, TranslationKey> = {
  full: 'hudChrome.crafting.difficultyFull',
  reduced: 'hudChrome.crafting.difficultyReduced',
  minimal: 'hudChrome.crafting.difficultyMinimal',
  none: 'hudChrome.crafting.difficultyNone',
} as const;

/** Duration chip and aria: up to two decimals when non-integer (1.75s), whole
 *  seconds otherwise. Exported for the row's aria and tooltip lines, which
 *  spell the same number out of line. */
export const DURATION_FRACTION_DIGITS = 2;

/** The skill-gain reading of one recipe, in words rather than only a tint. */
export function craftDifficultyLabel(difficulty: CraftDifficulty): string {
  return t(DIFFICULTY_LABEL_KEY[difficulty]);
}

/** Format a cast duration for the row chip (localized number + s unit key). */
export function durationChipText(durationSec: number): string {
  const whole = Number.isInteger(durationSec);
  return t('hudChrome.crafting.durationChip', {
    seconds: formatNumber(durationSec, {
      maximumFractionDigits: whole ? 0 : DURATION_FRACTION_DIGITS,
    }),
  });
}
