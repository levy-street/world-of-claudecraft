// Craft-deny message selection: maps a refused craftResult event to the log
// line's t() key. station_required names WHICH station: no station field rides
// the event, the type resolves from the recipe content (identical in both
// worlds). An unresolvable recipe id (cannot happen from a well-formed server)
// falls through to the generic materials line rather than rendering a broken
// name; the painter owns the t() calls and the station-name rendering
// (stationNameText stays in crafting_window.ts).
//
// ONE AUTHORITY, TWO MODULES (the masterwrought release sync, 2026-08-24): the
// release extracted this core out of hud.ts's arm while this branch extracted
// the same table as ./craft_denial_line_view. The reason-to-key table lives
// there, exhaustively typed, so a reason added to the union fails tsc rather
// than falling silently through to the materials line. THIS module is what
// hud.ts calls: it owns the id-resolving signature the release's call site
// already had, and delegates the decision. Keeping the call here rather than
// on the table directly is deliberate: a delegate nothing calls is dead
// production code, and the first version of this resolution left exactly that
// (its own header claimed two surfaces that cannot disagree, when only one
// existed).

import { recipeById } from '../../../sim/content/recipes';
import type { StationType } from '../../../sim/professions/stations';
import type { SimEvent } from '../../../sim/types';
import { durationText } from '../../duration_text';
import { craftDenialLine } from './craft_denial_line_view';
import type { ProfessionDenialLine } from './denial_line_core';

export type CraftDenyReason = NonNullable<Extract<SimEvent, { type: 'craftResult' }>['reason']>;

/** The crafting arm of the shared ProfessionDenialLine pattern
 *  (denial_line_core.ts): key plus ready-made params, extended by the one
 *  crafting-specific fact (stationType), which stays unresolved here because
 *  the localized station name lives window-side (stationNameText). */
export interface CraftDenyMessage extends ProfessionDenialLine {
  /** Set only for a resolvable station_required refusal; the painter renders
   *  the station name into the stationRequired template. */
  stationType?: StationType;
  /** Set only for a daily_limit refusal that carried a valid countdown
   *  (phase 14): the ready-made t() params for the dailyLimitRetry line, the
   *  {duration} already spelled through duration_text.ts so the painter needs
   *  no second resolver. Absent otherwise. */
  params?: { duration: string };
}

export function craftDenyMessage(
  reason: CraftDenyReason | undefined,
  recipeId: string,
  retryAfterSeconds?: number,
): CraftDenyMessage {
  const line = craftDenialLine(reason, recipeById(recipeId)?.stationType, retryAfterSeconds);
  return {
    key: line.key,
    ...(line.stationType !== undefined ? { stationType: line.stationType } : {}),
    ...(line.retrySeconds !== undefined
      ? { params: { duration: durationText(line.retrySeconds) } }
      : {}),
  };
}
