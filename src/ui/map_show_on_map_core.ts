// Pure state transitions for the Dungeon Finder "Show on Map" ping
// (Hud.showFinderOnMap) and the zone-crossing pan/zoom reset guard in
// Hud.updateMapWindow that the ping must survive.
//
// Both bugs shared one root cause: the ping only ever WROTE mapZoom/mapCenter/
// mapPing on Hud, and two other pieces of Hud's own map state silently
// overrode that write on the very next redraw. showOnMapPanState is the
// single place that decides every field the ping sets (so a future field
// cannot be added to one call site and forgotten on the other); it forces the
// per-zone detail level regardless of the map's PRIOR state, because the
// continent overview branch of updateMapWindow never reads mapPing/mapZoom/
// mapCenter at all: a map left open on that level swallowed the ping
// silently. shouldResetMapPanOnZoneCross is the other half: the ordinary
// zone-crossing guard (a fresh open, walking to a new zone, or a continent
// pick) resets pan/zoom to the full-frame default, but must not fire when the
// crossing IS the ping's own override taking effect, or the reset undoes the
// pan/zoom the ping just chose.
//
// DOM-free so tests/map_show_on_map_core.test.ts can drive both directly;
// Hud composes them over its own mapZoom/mapCenter/mapPing/mapZoneOverride/
// mapLevel/mapHoverZone fields.

/** showFinderOnMap never zooms out past this, even if the map was already
 *  zoomed further out when the ping arrived. */
export const SHOW_ON_MAP_MIN_ZOOM = 2;

export interface MapPanState {
  zoneOverride: string;
  ping: { x: number; z: number };
  zoom: number;
  center: { x: number; z: number };
  level: 'zone';
  hoverZone: null;
}

/** The complete map state a Dungeon Finder "Show on Map" ping applies: pan and
 *  zoom onto the entrance, ring it, and force the per-zone detail level (see
 *  the file header for why the level write is not optional). `prevZoom` is
 *  the map's zoom before the ping; the ping only zooms IN from there. */
export function showOnMapPanState(
  prevZoom: number,
  x: number,
  z: number,
  zoneId: string,
): MapPanState {
  return {
    zoneOverride: zoneId,
    ping: { x, z },
    zoom: Math.max(prevZoom, SHOW_ON_MAP_MIN_ZOOM),
    center: { x, z },
    level: 'zone',
    hoverZone: null,
  };
}

/** Whether crossing into `newZoneId` (Hud.updateMapWindow's mapZoneId
 *  tracking) should reset the per-zone pan/zoom to the full-frame default.
 *  True for an ordinary crossing; false only when a pending Show-on-Map ping
 *  is the reason the tracked zone just changed (its override zone matches
 *  this crossing exactly), so the reset would otherwise clobber the pan/zoom
 *  showOnMapPanState just chose. */
export function shouldResetMapPanOnZoneCross(
  pendingPing: boolean,
  zoneOverride: string | null,
  newZoneId: string,
): boolean {
  return !(pendingPing && zoneOverride === newZoneId);
}
