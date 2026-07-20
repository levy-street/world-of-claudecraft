// Crafting stations (Professions 2.0 Phase 8): the hands-vs-stations split.
// Field recipes (content/recipes.ts FIELD_RECIPES) craft anywhere; a recipe
// carrying a `stationType` (professions/types.ts ProfessionRecipeRecord)
// resolves only while the crafter stands at a matching station, or while
// their own mobile station (mobile_station.ts) whose craft maps to that
// type is ACTIVE (the mobile arm checks activity and type, never distance). This replaces the retired level-20 crafting-hub gate (#1297's
// crafting_hub.ts): the level arm is gone entirely (2026-07-17 maintainer
// ruling), and the single hub circle is replaced by per-type stations spread
// across the towns (content/professions.ts STATIONS).
//
// Pure leaf, no Sim/Entity import (the same shape the old crafting_hub.ts
// had): callers resolve positions/state from SimContext and pass plain
// values in. The content half (STATIONS / STATION_RADIUS /
// STATION_TYPE_BY_CRAFT) lives in content/professions.ts; that module
// imports these TYPES back type-only, so there is no runtime cycle.

import { STATION_RADIUS, STATION_TYPE_BY_CRAFT, STATIONS } from '../content/professions';

// The six physical station kinds. A StationType is a stable id, never
// player-facing text: display names live in src/ui/i18n.catalog/
// hud_chrome.ts (`hudChrome.crafting.stationName.<type>`).
export type StationType = 'forge' | 'kitchens' | 'apothecary' | 'tannery' | 'loom' | 'toolworks';

// One placed station in the world: WHERE it sits and WHICH master NPC runs
// it. `pos` is world coordinates in the station's zone; `masterNpcId` names
// the resident master (content agent's NpcDef) so quest/vendor content can
// anchor to the station record instead of re-typing coordinates.
export interface StationDef {
  id: string;
  type: StationType;
  zoneId: string;
  pos: { x: number; z: number };
  masterNpcId: string;
}

/** Every station of one type (a type can have stations in several zones). */
export function stationsOfType(type: StationType): StationDef[] {
  return STATIONS.filter((s) => s.type === type);
}

/** True while `pos` sits within STATION_RADIUS of ANY station of `type`
 *  (squared-distance compare, the same proximity idiom the old
 *  crafting_hub.ts isAtCraftingHub used). */
export function isAtStation(pos: { x: number; z: number }, type: StationType): boolean {
  for (const station of STATIONS) {
    if (station.type !== type) continue;
    const dx = pos.x - station.pos.x;
    const dz = pos.z - station.pos.z;
    if (dx * dx + dz * dz <= STATION_RADIUS * STATION_RADIUS) return true;
  }
  return false;
}

/** The station type serving `craftId`, or undefined for a craft with no
 *  physical station (jewelcrafting/inscription/enchanting today). */
export function stationTypeForCraft(craftId: string): StationType | undefined {
  return STATION_TYPE_BY_CRAFT[craftId];
}

// The distinct station types present in STATIONS, in content order. Derived,
// so a content edit can never leave a type behind.
const STATION_TYPES: readonly StationType[] = [...new Set(STATIONS.map((s) => s.type))];

/**
 * The set of station types the crafting UI should treat as in range right
 * now: every type with a physical station within STATION_RADIUS of `pos`,
 * plus the type served by the viewer's own ACTIVE mobile station's craft
 * (pass the craft id, or null when none is active; the caller owns the
 * active/expiry check since only it holds the tick). Pure and cheap (six
 * stations), computed once per repaint by the HUD.
 */
export function inRangeStationTypes(
  pos: { x: number; z: number },
  activeMobileStationCraft: string | null = null,
): Set<StationType> {
  const inRange = new Set<StationType>();
  for (const type of STATION_TYPES) {
    if (isAtStation(pos, type)) inRange.add(type);
  }
  if (activeMobileStationCraft !== null) {
    const mobileType = stationTypeForCraft(activeMobileStationCraft);
    if (mobileType) inRange.add(mobileType);
  }
  return inRange;
}

/** Stable signature of an in-range set, for cheap changed-since-last-paint
 *  compares (the HUD's slow-band staleness check on the open window). */
export function stationTypesSignature(types: ReadonlySet<StationType>): string {
  return [...types].sort().join(',');
}
