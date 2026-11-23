// Camera-zone streaming: the pure decision behind the Scene panel's
// "stream the camera's zone" toggle and its lock.
//
// Zone isolate answers "load the zone I picked". This answers "load the zone I
// am flying over, and swap it when I leave", the same residency rect, chosen
// from the camera rather than from a click, and re-chosen as the camera
// travels unless the maker has locked it.
//
// No DOM, no Three, no editor state: the app owns the rect and the reload,
// this owns the choice of zone.

import { zoneIdForPoint, zoneRectOf } from './zone_isolate_core';

/**
 * How far OUTSIDE its rect the camera must travel before the streamed zone
 * changes.
 *
 * A zone border is precisely where a maker works when joining two regions, and
 * an orbit around a building sat on the line would otherwise re-stream, a
 * full engine rebuild, on every nudge. Generous compared to the chunk-grid
 * band this replaced: zones are hundreds of yards across, so a wide band costs
 * nothing in precision and buys a stable edit at the seam.
 */
export const ZONE_SWITCH_HYSTERESIS_YD = 24;

export interface ZoneRectLike {
  id: string;
  xMin?: number;
  xMax?: number;
  zMin: number;
  zMax: number;
}

/** True while (x, z) is still within `margin` of the named zone's rect. */
export function nearZone(
  zones: readonly ZoneRectLike[],
  zoneId: string | null,
  x: number,
  z: number,
  margin = ZONE_SWITCH_HYSTERESIS_YD,
): boolean {
  if (zoneId === null) return false;
  const zone = zones.find((q) => q.id === zoneId);
  if (!zone) return false;
  // zoneRectOf, NOT an infinite fallback: a zone with no explicit x-range spans
  // the STRIP, and treating it as infinitely wide would mean the stream could
  // never leave it sideways, Eastbrook Vale has no x-range, so the camera
  // would have carried the Vale into every western zone forever.
  const r = zoneRectOf(zone);
  return x >= r.minX - margin && x < r.maxX + margin && z >= r.minZ - margin && z < r.maxZ + margin;
}

/**
 * The zone the stream should be showing.
 *
 * `locked` wins outright, that is the whole point of the padlock: the maker
 * keeps one region resident while working across its edge, and nothing the
 * camera does may unload it. Otherwise the current zone is held until the
 * camera is clear of it by the hysteresis band, and only then does the zone
 * under the camera take over.
 */
export function zoneForCamera(
  zones: readonly ZoneRectLike[],
  x: number,
  z: number,
  current: string | null,
  locked: boolean,
  margin = ZONE_SWITCH_HYSTERESIS_YD,
): string | null {
  if (locked && current !== null) return current;
  if (nearZone(zones, current, x, z, margin)) return current;
  return zoneIdForPoint(zones, x, z);
}

/** How many zones the camera stream keeps resident at once. The stream swaps
 *  the whole set, so this is also how many unload in one go. */
export const STREAM_ZONE_COUNT = 4;

/** Distance from (x, z) to a zone's rect: 0 inside, else the nearest-edge gap. */
function rectDistance(zone: ZoneRectLike, x: number, z: number): number {
  const r = zoneRectOf(zone);
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * The `count` zones nearest the camera, nearest first.
 *
 * Ties break on zone id so the set is stable frame to frame (two zones can sit
 * exactly the same distance away when the camera is on a shared border, and a
 * set that flickers between them would reload the engine on every poll).
 */
export function nearestZoneIds(
  zones: readonly ZoneRectLike[],
  x: number,
  z: number,
  count = STREAM_ZONE_COUNT,
): string[] {
  return [...zones]
    .map((zone) => ({ id: zone.id, d: rectDistance(zone, x, z) }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(1, count))
    .map((e) => e.id);
}

/**
 * The set the stream should be showing.
 *
 * Held until the camera leaves the CURRENT set, the zone under the eye is no
 * longer one of them, hysteresis included, and only then does a fresh nearest
 * set take over, wholesale. Holding the set (rather than re-ranking every poll)
 * is what keeps a border orbit from reloading the engine: the ranking behind
 * the camera swaps back and forth constantly, the membership does not.
 *
 * `locked` wins outright, exactly as it does for the single-zone stream.
 */
export function zoneSetForCamera(
  zones: readonly ZoneRectLike[],
  x: number,
  z: number,
  current: readonly string[],
  locked: boolean,
  margin = ZONE_SWITCH_HYSTERESIS_YD,
  count = STREAM_ZONE_COUNT,
): string[] {
  if (locked && current.length > 0) return [...current];
  const live = current.filter((id) => zones.some((zone) => zone.id === id));
  if (live.length > 0) {
    const inside = live.find((id) => nearZone(zones, id, x, z, margin));
    if (inside) return [...live];
  }
  return nearestZoneIds(zones, x, z, count);
}
