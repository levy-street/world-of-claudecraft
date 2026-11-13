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

import { BUILTIN_WORLD, getActiveWorldContent, isBuiltinWorldActive } from '../sim/data';
import type { PromotedScenery } from '../sim/types';

export function activeWorldPromoted(family: keyof PromotedScenery): boolean {
  const content = getActiveWorldContent();
  if (content === BUILTIN_WORLD) return false;
  return content.promotedScenery?.[family] === true;
}

/** Whether the active world is the built-in one, whose live touch-up document
 *  (data/world_touchup/current.map.json, applied by sim/data.ts) stands the hand-painted
 *  square dressing of Eastbrook and Fenbridge and the weekly vault's strong-house as
 *  placements of its own, so only there do the town views stand their own copies down for
 *  it. A Studio map or a custom world carries no touch-up: its towns draw their dressing and
 *  the vault hall themselves, as they always did (unless the document owns them,
 *  activeWorldPromoted). "Built-in" is sim/data.ts isBuiltinWorldContent: the shipped world,
 *  the Studio's preview of it, and its touch-up-less base, which only tests activate. */
export function activeWorldStandsLiveTouchup(): boolean {
  return isBuiltinWorldActive();
}
