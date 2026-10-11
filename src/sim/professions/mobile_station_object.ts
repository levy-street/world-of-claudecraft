// The placed mobile station's WORLD OBJECT (the "you can brew but cannot see
// it" report from Last Keep, 2026-09-18): a mobile crafting station used to
// live only in the transient PlayerMeta.mobileStation slot the crafting gate
// reads, so neither host had anything to snapshot or draw and a placed Grand
// Cauldron was a log line and nothing else. This module gives every placement
// a REAL entity, the shared-feast shape (professions/feast.ts): a ground
// object with a custom templateId, no pickup item, not lootable, riding the
// normal interest-scoped entity snapshot, so no new wire mechanism exists.
// The render half is src/render/mobile_stations.ts, which reuses the town
// crafting-station props (stations.ts) so a placed hearth reads like the
// kitchens station in a town.
//
// THE TEMPLATE ID carries WHAT was placed: `mobile_station_<suffix>`, where
// the suffix is the placing ITEM id (grand_cauldron, laden_hearth,
// masters_field_forge: an item placement knows its own tool) or the CRAFT id
// for a specialization placement (placeMobileStationForPlayer, which has no
// item). mobileStationCraftOf resolves either suffix back to the craft the
// station serves, so the render plan (STATION_PROP_CLUSTERS by station type)
// and the client title ("{name}'s Grand Cauldron" vs "{name}'s Apothecary")
// both derive from one string and never key on a bare literal.
//
// LIFECYCLE mirrors the feast exactly: the entity spawns at placement, is
// dropped when the owner replaces the station (one slot per player), when the
// station expires (the 1 Hz sweep below, riding updateFarming's existing
// guard, never a second appended sim.ts sweep), when its room tears down (the
// instance/delve/rift object rosters, whose teardown drops the id; the sweep
// then reclaims the slot), and when the owner leaves (Sim.removePlayer, since
// the slot dies with the meta and an orphaned entity would stand until
// restart). `respawnTimer = Infinity` keeps the generic lootable-false
// re-arm sweep off it (the feast's documented finding).
//
// Draws ZERO rng, reads no wall clock: every decision is stored state.

import { ITEMS } from '../data';
import { delveRunForPlayer } from '../delves/runs';
import { createGroundObject } from '../entity';
import { instanceAt } from '../instances/dungeons';
import { riftInstanceAtPos } from '../rift/runs';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { feastPlacementHeight } from './feast_placement';
import type { MobileCraftingStation } from './mobile_station';
import { stationTypeForCraft } from './stations';

export const MOBILE_STATION_TEMPLATE_PREFIX = 'mobile_station_';

/** The templateId a placed station entity carries. `suffix` is the placing
 *  item id, or the craft id when no item placed it. */
export function mobileStationTemplateId(suffix: string): string {
  return `${MOBILE_STATION_TEMPLATE_PREFIX}${suffix}`;
}

export function isMobileStationTemplateId(templateId: string | null | undefined): boolean {
  return typeof templateId === 'string' && templateId.startsWith(MOBILE_STATION_TEMPLATE_PREFIX);
}

/** The suffix behind the prefix, or null for any other templateId. */
export function mobileStationSuffixOf(templateId: string | null | undefined): string | null {
  if (!isMobileStationTemplateId(templateId)) return null;
  return (templateId as string).slice(MOBILE_STATION_TEMPLATE_PREFIX.length);
}

/** The placing ITEM id when the suffix names a placeMobileStation item,
 *  else null (a specialization placement has no item). */
export function mobileStationItemOf(templateId: string | null | undefined): string | null {
  const suffix = mobileStationSuffixOf(templateId);
  if (suffix === null) return null;
  const def = ITEMS[suffix];
  return def?.use?.type === 'placeMobileStation' ? suffix : null;
}

/** The CRAFT a placed station entity serves, resolved from either suffix
 *  form, or null when the templateId is not a mobile station or names a
 *  craft no station serves. */
export function mobileStationCraftOf(templateId: string | null | undefined): string | null {
  const suffix = mobileStationSuffixOf(templateId);
  if (suffix === null) return null;
  const def = ITEMS[suffix];
  if (def?.use?.type === 'placeMobileStation') return def.use.stationCraftId;
  return stationTypeForCraft(suffix) ? suffix : null;
}

/** The room roster a placed object joins so the room's teardown drops it
 *  (the feast's objectOwner idiom). */
interface ObjectRoster {
  readonly objectIds: number[];
}

function rosterAt(ctx: SimContext, placer: Entity, pos: Entity['pos']): ObjectRoster | undefined {
  let roster: ObjectRoster | undefined;
  const inst = instanceAt(ctx, pos);
  if (inst && inst.partyKey !== null) roster = inst;
  const run = delveRunForPlayer(ctx, placer.id);
  if (run) roster = run;
  const rift = riftInstanceAtPos(ctx, pos);
  if (rift) roster = rift;
  return roster;
}

/**
 * Spawns the world object for a freshly built `station` at the placer's
 * feet and records its id on the station (`entityId`). `name` is the
 * PLACER'S raw player name carried as a VALUE: the client composes the
 * localized "{name}'s <Station>" title off the templateId
 * (src/ui/hud/professions/mobile_station_title.ts), never sim-side English.
 */
export function spawnMobileStationObject(
  ctx: SimContext,
  station: MobileCraftingStation,
  placer: Entity,
  suffix: string,
): number {
  const e = createGroundObject(ctx.nextId++, '', station.playerId, {
    x: station.pos.x,
    y: feastPlacementHeight(ctx, placer),
    z: station.pos.z,
  });
  e.templateId = mobileStationTemplateId(suffix);
  e.objectItemId = null;
  e.lootable = false;
  e.respawnTimer = Infinity;
  ctx.addEntity(e);
  rosterAt(ctx, placer, e.pos)?.objectIds.push(e.id);
  station.entityId = e.id;
  return e.id;
}

/** Drops the station's world object if it still stands. Idempotent: a
 *  station whose entity a room teardown already removed is a no-op. Clears
 *  `entityId` either way so a later sweep pass sees nothing to reclaim. */
export function dropMobileStationObject(
  ctx: SimContext,
  station: MobileCraftingStation | null | undefined,
): void {
  if (!station || station.entityId === undefined) return;
  const id = station.entityId;
  station.entityId = undefined;
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/**
 * The 1 Hz reclaim, riding INSIDE updateFarming's existing guard: a station
 * past its expiry loses its object and its slot (isStationActive's
 * complement, `tickCount >= expiresAtTick`, restated here so this module
 * imports mobile_station.ts type-only and the two never form a runtime
 * cycle); a station whose object a room teardown already dropped loses its
 * slot too, so the crafting gate cannot outlive the thing players can see
 * (the feast's inverse-cleanup rule). Allocates nothing on the common
 * no-station tick.
 */
export function updateMobileStationObjects(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    const station = meta.mobileStation;
    if (!station) continue;
    if (ctx.tickCount >= station.expiresAtTick) {
      dropMobileStationObject(ctx, station);
      meta.mobileStation = null;
      continue;
    }
    if (station.entityId !== undefined && !ctx.entities.has(station.entityId)) {
      station.entityId = undefined;
      meta.mobileStation = null;
    }
  }
}
