import { STRIP_MAX_X, STRIP_MIN_X } from '../sim/data';
import type { MapDoc } from '../sim/map_doc';
import type { WorldContent } from '../sim/types';
import type { WorldLayout } from '../sim/world_layout';

/** Move an existing station alongside its existing master, retaining their offset. */
export type StationLayoutBindings = Record<string, { masterNpcId: string; zoneId: string }>;

export function compileLayoutStations(
  current: WorldContent,
  npcs: WorldLayout['npcs'],
  bindings: StationLayoutBindings | undefined,
  preserve: Record<string, string> | undefined,
  issue: (id: string, reason: string) => void,
): WorldLayout['stations'] {
  const stations = current.services?.stations ?? [];
  const result: NonNullable<WorldLayout['stations']> = {};
  for (const [id, binding] of Object.entries(bindings ?? {})) {
    const matches = stations.filter((station) => station.id === id);
    const station = matches[0];
    const original = current.npcs[binding.masterNpcId];
    const moved = npcs[binding.masterNpcId];
    const zone = current.zones.find((entry) => entry.id === binding.zoneId);
    if (
      matches.length !== 1 ||
      station.masterNpcId !== binding.masterNpcId ||
      !original ||
      !moved ||
      !zone
    ) {
      issue(
        `station:${id}`,
        'Station, master move or destination zone binding no longer resolves.',
      );
      continue;
    }
    const pos = {
      x: moved.pos.x + (station.pos.x - original.pos.x),
      z: moved.pos.z + (station.pos.z - original.pos.z),
    };
    if (
      !Number.isFinite(pos.x) ||
      !Number.isFinite(pos.z) ||
      pos.z < zone.zMin ||
      pos.z >= zone.zMax ||
      pos.x < (zone.xMin ?? STRIP_MIN_X) ||
      pos.x >= (zone.xMax ?? STRIP_MAX_X)
    ) {
      issue(
        `station:${id}`,
        'Station anchor must be finite and inside its reviewed destination zone.',
      );
      continue;
    }
    result[id] = { pos, zoneId: zone.id };
  }
  for (const station of stations) {
    const move = npcs[station.masterNpcId];
    const original = current.npcs[station.masterNpcId];
    if (
      move &&
      original &&
      (move.pos.x !== original.pos.x || move.pos.z !== original.pos.z) &&
      !Object.hasOwn(result, station.id) &&
      !preserve?.[`station:${station.id}`]?.trim()
    )
      issue(
        `station:${station.id}`,
        'Moved station master needs a reviewed station anchor or an explicit reason to keep the current anchor.',
      );
  }
  return Object.keys(result).length ? result : undefined;
}

/** Explicit zone-to-service IDs keep extra resurrection sites and their spawn order. */
export function compileLayoutGraveyards(
  map: MapDoc,
  current: WorldContent,
  bindings: Record<string, string> | undefined,
  issue: (id: string, reason: string) => void,
): Pick<WorldLayout, 'graveyards' | 'zoneGraveyards'> {
  if (!bindings || !Object.keys(bindings).length) return {};
  const graveyards: NonNullable<WorldLayout['graveyards']> = {};
  const zoneGraveyards: NonNullable<WorldLayout['zoneGraveyards']> = {};
  for (const [zoneId, graveyardId] of Object.entries(bindings)) {
    const source = map.content.zones.filter((zone) => zone.id === zoneId);
    const zones = current.zones.filter((zone) => zone.id === zoneId);
    const sites = (current.services?.graveyards ?? []).filter((gy) => gy.id === graveyardId);
    if (
      source.length !== 1 ||
      zones.length !== 1 ||
      sites.length !== 1 ||
      Object.hasOwn(graveyards, graveyardId)
    ) {
      issue(`graveyard:${zoneId}`, 'Zone or graveyard binding is missing, ambiguous or reused.');
      continue;
    }
    const target = source[0].graveyard;
    const zone = zones[0];
    if (
      !target ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.z) ||
      target.z < zone.zMin ||
      target.z >= zone.zMax ||
      target.x < (zone.xMin ?? STRIP_MIN_X) ||
      target.x >= (zone.xMax ?? STRIP_MAX_X)
    ) {
      issue(`graveyard:${zoneId}`, 'Graveyard must be finite and inside its canonical zone.');
      continue;
    }
    zoneGraveyards[zoneId] = { ...target };
    graveyards[graveyardId] = {
      x: target.x + (sites[0].x - zone.graveyard.x),
      z: target.z + (sites[0].z - zone.graveyard.z),
    };
  }
  return { graveyards, zoneGraveyards };
}
