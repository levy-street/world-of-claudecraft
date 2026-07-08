// Mobile crafting station (#1134): a specialized player can set up a
// temporary crafting station in the field. Scope note, per this issue's own
// text: there is currently NO existing "must be near a town crafting
// station" gate anywhere in this codebase (there is no town/crafting-station
// system filed at all yet; see the unfiled prerequisite noted in epic
// #1152's Tier 6 notes). A gate-bypass mechanic has nothing to bypass, so
// this module implements the MINIMAL viable slice instead: a real, tested,
// INERT-for-now mechanic. It can be placed (gated on specialization via
// wheel.ts), has a fixed duration, and is queryable. It currently has no
// gameplay effect on `resolveCraft` (crafting.ts) because there is no
// location gate to relax there. Once the town build-out lands a location
// gate on crafting, `resolveCraft`/`resolveCraftForRecipe` (crafting.ts, #1127)
// should read `isStationActive` alongside the town-proximity check.
//
// Same "caller owns the state" shape as `ToolEffectSlot` (tools.ts): this
// module holds no state itself, it only builds/queries a plain
// `MobileCraftingStation` value the caller (a future per-player station
// slot, e.g. on `PlayerMeta` once one exists) stores and passes back in.

import { MOBILE_CRAFTING_STATION_DURATION_TICKS } from '../content/professions';
import { type CraftSkillState, isSpecialized } from './wheel';

export interface MobileCraftingStation {
  playerId: string;
  /** Which craft the placing player was specialized in when they placed it. */
  craftId: string;
  pos: { x: number; z: number };
  /** Sim tick this station was placed at. */
  placedAtTick: number;
  /** Sim tick this station expires at (placedAtTick + duration). */
  expiresAtTick: number;
}

/**
 * Attempts to place a mobile crafting station for `playerId` at `pos`.
 * Gated on `isSpecialized(crafterSkills, craftId)` (#1134): returns
 * `undefined` when the player is not specialized in `craftId`, otherwise a
 * fresh station good for `MOBILE_CRAFTING_STATION_DURATION_TICKS` from
 * `nowTick`. Pure: does not mutate any caller state, the caller is
 * responsible for storing the returned station (e.g. in a per-player slot
 * or a world-visible list) and for removing it once `isStationActive`
 * reports it expired.
 */
export function placeMobileCraftingStation(
  playerId: string,
  craftId: string,
  pos: { x: number; z: number },
  crafterSkills: CraftSkillState,
  nowTick: number,
): MobileCraftingStation | undefined {
  if (!isSpecialized(crafterSkills, craftId)) return undefined;
  return {
    playerId,
    craftId,
    pos,
    placedAtTick: nowTick,
    expiresAtTick: nowTick + MOBILE_CRAFTING_STATION_DURATION_TICKS,
  };
}

/** True only while `nowTick` is still within the station's placed duration. */
export function isStationActive(station: MobileCraftingStation, nowTick: number): boolean {
  return nowTick < station.expiresAtTick;
}
