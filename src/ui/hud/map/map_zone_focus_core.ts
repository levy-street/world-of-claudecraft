// Which zone the overworld map frames. Pure, extracted from Hud.updateMapWindow
// (the monolith ratchet): inside a dungeon, the zone its door stands in
// (dungeonAt owns the instance x-band layout); in any other instance band the
// zone the player entered from (the zone tracker freezes past
// DUNGEON_X_THRESHOLD, so `lastZoneId` carries it); outdoors, the committed
// zone, so border-straddling cannot thrash the cached terrain regen. A dev or
// atlas override wins over all three.
import type { ZoneDef } from '../../../sim/types';

export interface MapZoneFocusLookup {
  zones: readonly ZoneDef[];
  zoneAt(x: number, z: number): ZoneDef;
  dungeonAt(x: number): { doorPos: { x: number; z: number } } | null | undefined;
}

/**
 * @param mapZoneOverride the atlas / dev zone override, or null to follow the player
 * @param lastZoneId the zone tracker's last committed zone id (frozen inside instances)
 * @param pos the player's position
 */
export function resolveMapZone(
  mapZoneOverride: string | null,
  lastZoneId: string | null,
  pos: { x: number; z: number },
  lookup: MapZoneFocusLookup,
): ZoneDef {
  const byId = (id: string | null): ZoneDef | undefined =>
    id === null ? undefined : lookup.zones.find((zone) => zone.id === id);
  if (mapZoneOverride !== null) return byId(mapZoneOverride) ?? lookup.zoneAt(pos.x, pos.z);
  const dungeon = lookup.dungeonAt(pos.x);
  if (dungeon) return lookup.zoneAt(dungeon.doorPos.x, dungeon.doorPos.z);
  return byId(lastZoneId) ?? lookup.zoneAt(pos.x, pos.z);
}
