// The craft-denial chat-line model: maps a text-free craftResult denial to
// the hudChrome.crafting.* key the HUD renders, plus the station type the
// stationRequired line names. Extracted from Hud.handleEvents (Masterwrought
// Phase 07 review round) so every arm is table-tested instead of riding an
// untestable ternary inside the coordinator; hud.ts stays a thin caller.
//
// station_required names WHICH station: no station field rides the event,
// the type resolves from the recipe content the CALLER looks up (identical
// in both worlds). An unresolvable recipe id (cannot happen from a
// well-formed server) falls through to the generic materials line rather
// than rendering a broken name.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { SimEvent, StationType } from '../sim/types';
import type { TranslationKey } from './i18n';

type CraftResultEvent = Extract<SimEvent, { type: 'craftResult' }>;
export type CraftDenialReason = CraftResultEvent['reason'];

export interface CraftDenialLine {
  key: TranslationKey;
  /** Present only for a resolvable station_required denial: the caller
   *  renders the named stationRequired line with this type. */
  stationType?: StationType;
}

/** The chat-line model for one craftResult denial. `recipeStationType` is the
 *  denied recipe's stationType from static content; it is read only for the
 *  station_required arm. An absent or unrecognized reason reads as the
 *  generic materials line, the historical fall-through. */
export function craftDenialLine(
  reason: CraftDenialReason,
  recipeStationType: StationType | undefined,
): CraftDenialLine {
  if (reason === 'station_required' && recipeStationType) {
    return { key: 'hudChrome.crafting.stationRequired', stationType: recipeStationType };
  }
  return {
    key:
      reason === 'unknown_recipe'
        ? 'hudChrome.crafting.unknownRecipe'
        : reason === 'combo_requirement_unmet'
          ? 'hudChrome.crafting.comboRequirementUnmet'
          : reason === 'busy' || reason === 'throttled'
            ? 'hudChrome.crafting.busy'
            : reason === 'recipe_not_learned'
              ? 'hudChrome.crafting.recipeNotLearned'
              : reason === 'no_bag_space'
                ? 'hudChrome.crafting.noBagSpace'
                : reason === 'daily_limit'
                  ? 'hudChrome.crafting.dailyLimit'
                  : 'hudChrome.crafting.insufficientMaterials',
  };
}
