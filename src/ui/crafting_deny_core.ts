// Craft-deny message selection: maps a refused craftResult event to the log
// line's t() key. station_required names WHICH station: no station field rides
// the event, the type resolves from the recipe content (identical in both
// worlds). An unresolvable recipe id (cannot happen from a well-formed server)
// falls through to the generic materials line rather than rendering a broken
// name; the painter owns the t() calls and the station-name rendering
// (stationNameText stays in crafting_window.ts).
//
// ONE AUTHORITY, TWO CALL SHAPES (the masterwrought release sync, 2026-08-24):
// the release extracted this core out of hud.ts's arm while this branch
// extracted the same table as ./craft_denial_line_view. The reason-to-key
// table lives there, exhaustively typed, so a reason added to the union fails
// tsc rather than falling silently through to the materials line; this module
// keeps its own signature (it resolves the recipe id itself) and delegates the
// decision, so the two surfaces cannot disagree about what a refusal says.

import { recipeById } from '../sim/content/recipes';
import type { StationType } from '../sim/professions/stations';
import type { SimEvent } from '../sim/types';
import { craftDenialLine } from './craft_denial_line_view';
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
  return craftDenialLine(reason, recipeById(recipeId)?.stationType);
}
