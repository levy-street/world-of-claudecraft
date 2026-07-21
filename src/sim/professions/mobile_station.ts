// Mobile crafting station (#1134, WIRED LIVE in Professions 2.0 Phase 8): a
// specialized player can set up a temporary crafting station in the field.
// Originally landed inert (no location gate existed to relax); the Phase 8
// hands-vs-stations split gave it one: `resolveCraftForRecipe` (crafting.ts)
// now accepts an ACTIVE own mobile station (isStationActive against the
// current tick) in place of physical presence at a station, for recipes
// whose stationType matches stationTypeForCraft(station.craftId)
// (stations.ts). The per-player slot is `PlayerMeta.mobileStation` (sim.ts):
// TRANSIENT, never serialized to the character save, since tick-domain
// expiry is not restart-safe. Placement rides the IWorld
// `placeMobileStation` member (world_api/professions.ts) and the
// place_mobile_station wire command (server/game.ts), plus the
// `/dev mobilestation <craftId>` cheat (dev_commands.ts).
//
// Same "caller owns the state" shape as `ToolEffectSlot` (tools.ts): the
// pure half holds no state itself, it only builds/queries a plain
// `MobileCraftingStation` value; `placeMobileStationForPlayer` below is the
// one command-shaped writer, storing onto the resolved player's meta slot.

import { MOBILE_CRAFTING_STATION_DURATION_TICKS } from '../content/professions';
import type { SimContext } from '../sim_context';
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

/**
 * Command body behind the IWorld `placeMobileStation` member and the
 * `/dev mobilestation` cheat: resolves the caller's player (ctx.resolve, the
 * same idiom craftItem uses), attempts the specialization-gated placement at
 * the player's current position, and on success stores the station in the
 * transient `PlayerMeta.mobileStation` slot (replacing any previous one).
 * Returns the placed station, or undefined when the caller is unresolvable
 * or not specialized in `craftId`. Draws no rng; denial has no side effect.
 */
export function placeMobileStationForPlayer(
  ctx: SimContext,
  craftId: string,
  pid?: number,
): MobileCraftingStation | undefined {
  const r = ctx.resolve(pid);
  if (!r) return undefined;
  const station = placeMobileCraftingStation(
    r.meta.name,
    craftId,
    { x: r.e.pos.x, z: r.e.pos.z },
    r.meta.craftSkills,
    ctx.tickCount,
  );
  if (station) r.meta.mobileStation = station;
  return station;
}
