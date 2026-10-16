// Whether the ACTIVE world's DOCUMENT has taken a scenery family over as
// editable placements, in which case the renderer-owned builder that normally
// draws that family must stand down.
//
// Studio promotes shipped scenery into map.placements so a maker can select,
// move, rescale and delete it. The renderer-side builders that draw the same
// records (jungle_features.ts for the Palmreach strand, the authored-town
// subtrees for Eastbrook Vale and Fenbridge) know nothing about the document,
// so without a gate BOTH draw: the strand renders 258 palms twice, the movable
// copy sitting exactly inside the one that cannot be picked. Moving the
// placement then leaves its ghost behind, which is what "these assets can't be
// moved" looks like from the outside.
//
// Same discipline as authored_town_gate.ts: the built-in world answers false by
// identity, so the shipped path is unchanged BY CONSTRUCTION and no shipped
// scenery can ever be gated off by a document flag it never carries.

import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import type { PromotedScenery } from '../sim/types';

export function activeWorldPromoted(family: keyof PromotedScenery): boolean {
  const content = getActiveWorldContent();
  if (content === BUILTIN_WORLD) return false;
  return content.promotedScenery?.[family] === true;
}
