// Mobile crafting station (#1134, WIRED LIVE in Professions 2.0): a
// specialized player can set up a temporary crafting station in the field.
// Originally landed inert (no location gate existed to relax); the
// hands-vs-stations split gave it one: `resolveCraftForRecipe` (crafting.ts)
// now accepts an ACTIVE own mobile station (isStationActive against the
// current tick) in place of physical presence at a station, for recipes
// whose stationType matches stationTypeForCraft(station.craftId)
// (stations.ts). Masterwrought phase 09 adds the partyShared arm: a
// station placed through the Master's Field Forge ITEM
// (placeMobileStationFromItem below) also serves the owner's party members,
// but only within STATION_RADIUS of the crafter (partySharedStationSatisfies
// below). The per-player slot is `PlayerMeta.mobileStation` (sim.ts):
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

import { MOBILE_CRAFTING_STATION_DURATION_TICKS, STATION_RADIUS } from '../content/professions';
import { refusedWhileDead } from '../dead_gate';
import type { SimContext } from '../sim_context';
import type { StationType } from '../types';
import { stationTypeForCraft } from './stations';
import { type CraftSkillState, isSpecialized } from './wheel';

export interface MobileCraftingStation {
  playerId: string;
  /** Which craft this station serves (stationTypeForCraft maps it to a
   *  station type). Specialization placements record the craft the placing
   *  player was specialized in; item placements record the craft the item
   *  names. */
  craftId: string;
  /** Party-usable placement (Masterwrought phase 09, the Master's Field
   *  Forge item path): while active, party members of the owner within
   *  STATION_RADIUS also satisfy the crafting station gate (crafting.ts).
   *  Optional so the pre-phase record shape (and every literal built to it)
   *  stays valid: absent reads as false, owner-only, which is what every
   *  specialization placement sets explicitly. */
  partyShared?: boolean;
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
    // Specialization placements stay owner-only: the party grant is the
    // Master's Field Forge item's alone (placeMobileStationFromItem).
    partyShared: false,
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
 * Returns the placed station, or undefined when the caller is dead (the
 * shared while-dead error line is the only surface), unresolvable, or not
 * specialized in `craftId`. Draws no rng; denial has no side effect.
 */
export function placeMobileStationForPlayer(
  ctx: SimContext,
  craftId: string,
  pid?: number,
): MobileCraftingStation | undefined {
  // Dead gate INSIDE the module (not on the Sim wrapper like the rest of the
  // profession family): this command emits no result event, so the module
  // placement costs nothing, and it keeps the `/dev mobilestation` cheat
  // (dev_commands.ts), which calls this directly, behind the same gate; the
  // cheat saves the walk, never a gate.
  if (refusedWhileDead(ctx, pid)) return undefined;
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

/**
 * Command body behind the `placeMobileStation` ItemUse arm (items.ts useItem):
 * the Master's Field Forge (Masterwrought phase 09) and any future
 * station-placing item. Deliberately NO isSpecialized gate: holding the item
 * IS the credential (crafting it already sat behind the apex ladder), so the
 * only refusals are the shared dead gate (the matcher-covered while-dead
 * error line, same as placeMobileStationForPlayer) and an unresolvable pid.
 * The placed station is partyShared: party members within STATION_RADIUS of
 * it satisfy the crafting station gate (crafting.ts). Stores into the same
 * per-player PlayerMeta.mobileStation slot, replacing any previous station.
 * Success emits one player-visible log line naming `name`, the placing
 * item's display name (the phase 06 scroll-read pattern in items.ts; matched
 * by log.placeStation in src/ui/sim_i18n.ts), so a placement is never
 * silent. Draws no rng, reads no wall clock; the CALLER never consumes the
 * item (a permanent tool, the mount-reins convention).
 */
export function placeMobileStationFromItem(
  ctx: SimContext,
  stationCraftId: string,
  name: string,
  pid?: number,
): MobileCraftingStation | undefined {
  if (refusedWhileDead(ctx, pid)) return undefined;
  const r = ctx.resolve(pid);
  if (!r) return undefined;
  const station: MobileCraftingStation = {
    playerId: r.meta.name,
    craftId: stationCraftId,
    partyShared: true,
    pos: { x: r.e.pos.x, z: r.e.pos.z },
    placedAtTick: ctx.tickCount,
    expiresAtTick: ctx.tickCount + MOBILE_CRAFTING_STATION_DURATION_TICKS,
  };
  r.meta.mobileStation = station;
  ctx.emit({ type: 'log', text: `You set up the ${name}.`, color: '#c9f', pid: r.meta.entityId });
  return station;
}

/**
 * THE party-station walk, shared by the craft gate's party arm and the
 * per-viewer set resolver so the two can never drift apart (the exact
 * mismatch the set-valued readout was built to kill): visits every OTHER
 * member's ACTIVE partyShared station within STATION_RADIUS of `pos`
 * (squared-distance, the stations.ts isAtStation idiom). The self slot is
 * skipped on purpose: an own station already satisfies the gate at ANY
 * distance (the training precedent, crafting.ts), and an owner-only station
 * must never leak through the party walk. The station-TYPE filter stays OUT
 * of the walk deliberately: the gate layers it per craft below, while the
 * resolver ships every qualifying craft and lets inRangeStationTypes apply
 * the type dimension on the consumer side (pinned in
 * tests/mobile_station_party.test.ts). Returns true as soon as `visit`
 * does; `metas` is any pid-keyed lookup (the live ctx.players view in
 * production).
 */
function eachPartyStationInRange(
  party: { members: readonly number[] } | null,
  selfPid: number,
  metas: { get(pid: number): { mobileStation: MobileCraftingStation | null } | undefined },
  pos: { x: number; z: number },
  nowTick: number,
  visit: (station: MobileCraftingStation) => boolean,
): boolean {
  if (!party) return false;
  const radiusSq = STATION_RADIUS * STATION_RADIUS;
  for (const memberPid of party.members) {
    if (memberPid === selfPid) continue;
    const station = metas.get(memberPid)?.mobileStation;
    if (!station || !station.partyShared || !isStationActive(station, nowTick)) continue;
    const dx = pos.x - station.pos.x;
    const dz = pos.z - station.pos.z;
    if (dx * dx + dz * dz > radiusSq) continue;
    if (visit(station)) return true;
  }
  return false;
}

/**
 * The party arm of the crafting station gate (Masterwrought phase 09): true
 * while any OTHER member of `party` holds an ACTIVE partyShared mobile
 * station whose craft serves `type`, within STATION_RADIUS of `crafterPos`.
 * A thin type-filtering consumer of the one shared walk above; run per
 * craft command, never per tick.
 */
export function partySharedStationSatisfies(
  party: { members: readonly number[] } | null,
  crafterPid: number,
  metas: { get(pid: number): { mobileStation: MobileCraftingStation | null } | undefined },
  crafterPos: { x: number; z: number },
  type: StationType,
  nowTick: number,
): boolean {
  return eachPartyStationInRange(
    party,
    crafterPid,
    metas,
    crafterPos,
    nowTick,
    (station) => stationTypeForCraft(station.craftId) === type,
  );
}

// Returned whenever no station serves the viewer: the common case on the
// per-viewer snapshot path. The party-null path allocates nothing at all;
// a partied viewer pays one bounded closure for the shared walk even when
// the result is empty.
const EMPTY_CRAFTS: readonly string[] = Object.freeze([]);

/**
 * The per-viewer set resolver behind Sim.activeMobileStationCraftsFor (and
 * so the `mst` snapshot delta and the offline getter): the DEDUPED, SORTED
 * array of every mobile craft id whose station currently serves the viewer.
 * Two arms qualify a craft: the viewer's own ACTIVE station at ANY distance
 * (the training precedent, crafting.ts), and EVERY ACTIVE partyShared
 * station owned by another party member within STATION_RADIUS of the viewer.
 * Empty array when none qualify, never null. There is no nearest pick and no
 * tie-break: the set carries every qualifying craft, so the crafting-window
 * row set mirrors the craft gate (crafting.ts) exactly instead of shadowing
 * a shared craft behind the viewer's own. This runs on the server per-viewer
 * snapshot path at up to 20 Hz, so the value is movement-driven: it changes
 * as players walk across STATION_RADIUS of a shared station.
 */
export function activeMobileStationCraftsForViewer(
  ctx: SimContext,
  pid: number,
): readonly string[] {
  // The craft gate denies outright for a missing entity (crafting.ts checks
  // `!entity` before every station arm, the own-station one included), so a
  // viewer with no entity reports NO crafts rather than advertising an own
  // station the gate would refuse.
  const viewer = ctx.entities.get(pid);
  if (!viewer) return EMPTY_CRAFTS;
  let crafts: string[] | null = null;
  const own = ctx.players.get(pid)?.mobileStation;
  if (own && isStationActive(own, ctx.tickCount)) crafts = [own.craftId];
  {
    const party = ctx.partyOf(pid);
    if (party) {
      eachPartyStationInRange(party, pid, ctx.players, viewer.pos, ctx.tickCount, (station) => {
        // Dedupe on insert: the own craft and a shared craft can be equal,
        // and two members can carry stations of one craft.
        if (!crafts) crafts = [station.craftId];
        else if (!crafts.includes(station.craftId)) crafts.push(station.craftId);
        return false;
      });
    }
  }
  if (!crafts) return EMPTY_CRAFTS;
  // Frozen like the ClientWorld mirror's split result, so the two IWorld
  // implementations hand consumers the same array contract (a mutation
  // throws in both worlds instead of succeeding offline only).
  return Object.freeze(crafts.sort());
}
