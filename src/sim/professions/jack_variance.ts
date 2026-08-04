// Jack of All Trades improviser output-variance roll (issue #1296). Per the
// design doc's own Open Questions section, the exact magnitude of this perk
// is genuinely undecided ("the magnitude of the better/worse output
// variance... is open"), so JACK_VARIANCE_* below are the working
// placeholder values pending a resolved number, the same posture
// wheel.ts's TIER_SKILL_STEP takes on its own open tuning question.
// Symmetric on purpose: a Jack's improvisation is as likely to fumble as it
// is to shine, a neutral-EV gamble rather than a hidden buff.
//
// This is a pure leaf module: no Sim/SimContext import, no content-table
// import, explicit arguments only, so a Vitest imports it directly and
// crafting.ts supplies the one rng draw. See crafting.ts resolveCraftForRecipe
// for how the outcome composes with the shared masterwork proc: 'worse'
// forces this craft's masterwork bump off outright (even if the ordinary
// proc roll would have hit), 'better' improves (never guarantees) this
// craft's masterwork odds, 'normal' changes nothing.

/** Fraction of Jack crafts that roll a worse improvisation. */
export const JACK_VARIANCE_WORSE_CHANCE = 0.1;

/** Fraction of Jack crafts that roll a better improvisation; kept equal to
 *  JACK_VARIANCE_WORSE_CHANCE so the roll stays a neutral-EV gamble. */
export const JACK_VARIANCE_BETTER_CHANCE = 0.1;

/** Flat bonus a 'better' outcome adds to this craft's masterwork proc chance
 *  (masterwork.ts MasterworkChanceInput terms are all fractions of 1, so this
 *  is percentage points: 0.05 = +5). Modest, matching the existing
 *  masterwork tuning constants' own scale (MASTERWORK_SIGNED_CHANCE /
 *  MASTERWORK_SPECIALIZATION_CHANCE). */
export const JACK_VARIANCE_BETTER_PROC_BONUS = 0.05;

export type CraftVarianceOutcome = 'worse' | 'normal' | 'better';

/**
 * Bucket one rng draw (caller draws via ctx.rng.next(), a value in [0, 1))
 * into a variance outcome: the bottom JACK_VARIANCE_WORSE_CHANCE of the range
 * is 'worse', the next JACK_VARIANCE_BETTER_CHANCE is 'better', everything
 * else is 'normal'. Pure bucketing, no rng drawn here.
 */
export function rollCraftVariance(roll: number): CraftVarianceOutcome {
  if (roll < JACK_VARIANCE_WORSE_CHANCE) return 'worse';
  if (roll < JACK_VARIANCE_WORSE_CHANCE + JACK_VARIANCE_BETTER_CHANCE) return 'better';
  return 'normal';
}
