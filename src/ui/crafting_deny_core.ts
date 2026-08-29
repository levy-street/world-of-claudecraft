// Craft-deny message selection: maps a refused craftResult event to the log
// line's t() key, extracted verbatim from hud.ts's handleEvents arm so the
// reason table is unit testable. station_required names WHICH station: no
// station field rides the event, the type resolves from the recipe content
// (identical in both worlds). An unresolvable recipe id (cannot happen from a
// well-formed server) falls through to the generic materials line rather than
// rendering a broken name; the painter owns the t() calls and the station-name
// rendering (stationNameText stays in crafting_window.ts).

import { recipeById } from '../sim/content/recipes';
import type { StationType } from '../sim/professions/stations';
import type { SimEvent } from '../sim/types';
import type { TranslationKey } from './i18n';

export type CraftDenyReason = NonNullable<Extract<SimEvent, { type: 'craftResult' }>['reason']>;

export interface CraftDenyMessage {
  key: TranslationKey;
  /** Set only for a resolvable station_required refusal; the painter renders
   *  the station name into the stationRequired template. */
  stationType?: StationType;
}

export function craftDenyMessage(
  reason: CraftDenyReason | undefined,
  recipeId: string,
): CraftDenyMessage {
  const stationType = reason === 'station_required' ? recipeById(recipeId)?.stationType : undefined;
  if (stationType) return { key: 'hudChrome.crafting.stationRequired', stationType };
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
              : reason === 'locked'
                ? 'hudChrome.crafting.reagentLocked'
                : reason === 'no_bag_space'
                  ? 'hudChrome.crafting.noBagSpace'
                  : 'hudChrome.crafting.insufficientMaterials',
  };
}
