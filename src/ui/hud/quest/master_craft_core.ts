// Pure decision for the gossip dialog's Crafting shortcut: which craft tab a
// station master's Crafting option should open, so the player lands straight
// on that master's profession instead of hopping through the crafting keybind
// and hunting the right tab.
//
// DOM-free and i18n-free (the quest_dialog_controller localizes the row); the
// only inputs are the mirrored station registry plus the viewer's mirrored
// per-craft skills, so both hosts resolve identically.

import { craftsForStationType } from '../../../sim/professions/stations';
import type { StationDef } from '../../../sim/types';

/**
 * The craft the master's Crafting gossip option opens, or null when the NPC
 * runs no station (the option never renders; isStationMasterNpc is the render
 * gate). Every station type serves one craft except the forge
 * (weaponcrafting AND armorcrafting), so among the served crafts this picks
 * the viewer's highest flat skill; ties and the no-skill case fall to
 * STATION_TYPE_BY_CRAFT declaration order. The crafting window's own
 * resolveSelectedCraft still guards the pick (a craft with no known recipes
 * falls back to the first tab), so this is a preference, never a gate.
 */
export function masterCraftTarget(
  masterNpcId: string,
  stations: readonly StationDef[],
  craftSkills: Readonly<Record<string, number>>,
): string | null {
  const station = stations.find((entry) => entry.masterNpcId === masterNpcId);
  if (!station) return null;
  const crafts = craftsForStationType(station.type);
  if (crafts.length === 0) return null;
  let best = crafts[0];
  for (const craft of crafts) {
    if ((craftSkills[craft] ?? 0) > (craftSkills[best] ?? 0)) best = craft;
  }
  return best;
}
