// /dev town: resolve a town name to its zone hub so a tester can jump to any
// settlement without knowing coordinates. Pure and data-driven: the ONLY
// destinations are the hub records the zone content already declares, so the
// command can never be steered to an arbitrary point (that is what /dev tp is
// for, and both ride the same ctx.devCommands gate, which the server arms only
// from ALLOW_DEV_COMMANDS and production never sets). Unknown names resolve
// to null and the caller refuses without moving anyone.
import type { ZoneDef } from '../types';

export interface DevTownTarget {
  /** Stable lookup key: the hub name slugged (`dawnrest_camp`). */
  id: string;
  /** The hub's display name as the zone content spells it. */
  name: string;
  /** The owning zone id, accepted as an alias (`eastbrook_vale`). */
  zoneId: string;
  x: number;
  z: number;
}

/** Lowercase, every run of non-alphanumerics collapsed to one underscore,
 *  leading/trailing underscores trimmed: "Dawnrest Camp" -> "dawnrest_camp". */
export function devTownSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** One target per zone hub, in zone order. A hub with an empty name (a
 *  user-authored map may leave it blank) falls back to the zone id so every
 *  zone stays reachable. */
export function devTownTargets(zones: readonly ZoneDef[]): DevTownTarget[] {
  return zones.map((zone) => {
    const name = zone.hub.name.trim() || zone.id;
    return {
      id: devTownSlug(name) || devTownSlug(zone.id),
      name,
      zoneId: zone.id,
      x: zone.hub.x,
      z: zone.hub.z,
    };
  });
}

/** Case- and punctuation-insensitive lookup by town slug, display name, or
 *  zone id. Exact matches only: a prefix would let "ever" pick a town the
 *  tester did not name. Hub names win over zone ids: should a custom map
 *  name a hub after another zone's id, the town the tester typed is the
 *  one they get, never the zone that happens to sit earlier in the array. */
export function resolveDevTown(zones: readonly ZoneDef[], query: string): DevTownTarget | null {
  const wanted = devTownSlug(query);
  if (!wanted) return null;
  const targets = devTownTargets(zones);
  return (
    targets.find((target) => target.id === wanted) ??
    targets.find((target) => devTownSlug(target.zoneId) === wanted) ??
    null
  );
}

/** The readout `/dev town` (no argument) and an unknown name print. */
export function devTownList(zones: readonly ZoneDef[]): string {
  return devTownTargets(zones)
    .map((target) => target.id)
    .join(', ');
}
