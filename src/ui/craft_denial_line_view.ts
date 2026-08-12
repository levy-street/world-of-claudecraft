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

/** Every reason's key, as an EXHAUSTIVE Record (review round): a tenth
 *  reason added to the CraftResult union fails tsc HERE until it gets a
 *  line, where the old ternary chain would have silently rendered the
 *  materials fall-through. station_required's row is the KEYLESS line the
 *  unresolvable-recipe fall-through renders; the resolvable case is handled
 *  above the lookup. */
const DENIAL_KEY_BY_REASON: Record<NonNullable<CraftDenialReason>, TranslationKey> = {
  unknown_recipe: 'hudChrome.crafting.unknownRecipe',
  combo_requirement_unmet: 'hudChrome.crafting.comboRequirementUnmet',
  busy: 'hudChrome.crafting.busy',
  throttled: 'hudChrome.crafting.busy',
  recipe_not_learned: 'hudChrome.crafting.recipeNotLearned',
  no_bag_space: 'hudChrome.crafting.noBagSpace',
  daily_limit: 'hudChrome.crafting.dailyLimit',
  insufficient_materials: 'hudChrome.crafting.insufficientMaterials',
  station_required: 'hudChrome.crafting.insufficientMaterials',
};

/** The chat-line model for one craftResult denial. `recipeStationType` is the
 *  denied recipe's stationType from static content; it is read only for the
 *  station_required arm. An absent reason reads as the generic materials
 *  line, the historical fall-through. */
export function craftDenialLine(
  reason: CraftDenialReason,
  recipeStationType: StationType | undefined,
): CraftDenialLine {
  if (reason === 'station_required' && recipeStationType) {
    return { key: 'hudChrome.crafting.stationRequired', stationType: recipeStationType };
  }
  return {
    key: reason ? DENIAL_KEY_BY_REASON[reason] : 'hudChrome.crafting.insufficientMaterials',
  };
}
