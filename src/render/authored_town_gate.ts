// Whether the ACTIVE world still carries an authored town's own buildings.
//
// v0.39 draws Eastbrook Vale and Fenbridge from bespoke authored subtrees
// (eastbrook_town.ts / fenbridge_town.ts) and skips the generic kit buildings
// that stand for them in ZonePropsDef. Both halves of that swap were gated on
// `getActiveWorldContent() === BUILTIN_WORLD`, an OBJECT IDENTITY check.
//
// Every editor document is a COPY of the built-in world, never that object, so
// in Studio both halves flipped the wrong way at once: the authored town built
// EMPTY and the kit buildings it replaces drew instead. The starting village
// rendered as the pre-rebuild brown kit houses while the live game showed the
// white-and-blue town, and no amount of rebuilding the map could fix it,
// because the map data was never the problem.
//
// Gate on the DATA instead: the built-in world by identity (unchanged, so the
// shipped path cannot drift), and any other world that still carries the
// town's buildings. A maker who keeps Eastbrook gets Eastbrook's real art; one
// who moves or deletes those buildings stops matching the per-building
// predicate and correctly falls back to the kit.

import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import type { BuildingDef } from '../sim/types';

export function activeWorldHasAuthoredTown(
  isRebuildBuilding: (building: BuildingDef) => boolean,
): boolean {
  const content = getActiveWorldContent();
  if (content === BUILTIN_WORLD) return true;
  return (content.props?.buildings ?? []).some(isRebuildBuilding);
}
