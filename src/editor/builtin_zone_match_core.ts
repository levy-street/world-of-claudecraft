// Whether a Studio map is a full-world map of the built-in world, for the
// open-time upgrades that promote the built-in world's props into editable
// placements (world_prop_placements.ts, feature_prop_placements.ts).
//
// A map qualifies when its zones are the built-in zones, in order. The
// built-in world also gains zones over time, and a map saved before one
// existed is still a full-world map: it simply does not carry that zone. So a
// map also qualifies when its zones are the built-in list without the zones
// named here, and the upgrades then keep that zone's props out of it (they
// would stand in open sea on a map whose terrain has no such land).
//
// Pure and DOM-free: ids and rectangles only.

import { STRIP_MAX_X, STRIP_MIN_X } from '../sim/data';

/** Built-in zones added after the repo's Studio maps were saved. */
export const LATE_BUILTIN_ZONE_IDS: readonly string[] = ['quartered_isle'];

interface ZoneRectLike {
  id: string;
  xMin?: number;
  xMax?: number;
  zMin: number;
  zMax: number;
}

const sameIds = (a: readonly { id: string }[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((zone, index) => zone.id === b[index]);

/** True when `mapZones` are the built-in zones in order, with or without the
 *  late zones. */
export function carriesBuiltinZones(
  mapZones: readonly { id: string }[],
  builtinZones: readonly { id: string }[],
): boolean {
  const all = builtinZones.map((zone) => zone.id);
  if (sameIds(mapZones, all)) return true;
  const early = all.filter((id) => !LATE_BUILTIN_ZONE_IDS.includes(id));
  return early.length !== all.length && sameIds(mapZones, early);
}

/** The built-in late zones a full-world map does not carry. */
export function missingLateZones<T extends ZoneRectLike>(
  mapZones: readonly { id: string }[],
  builtinZones: readonly T[],
): T[] {
  const have = new Set(mapZones.map((zone) => zone.id));
  return builtinZones.filter(
    (zone) => LATE_BUILTIN_ZONE_IDS.includes(zone.id) && !have.has(zone.id),
  );
}

/** True when (x, z) lies inside any of `zones`' rectangles. */
export function insideAnyZone(zones: readonly ZoneRectLike[], x: number, z: number): boolean {
  return zones.some(
    (zone) =>
      z >= zone.zMin &&
      z < zone.zMax &&
      x >= (zone.xMin ?? STRIP_MIN_X) &&
      x < (zone.xMax ?? STRIP_MAX_X),
  );
}
