// Tests for the Dungeon Finder "Show on Map" pure core
// (src/ui/map_show_on_map_core.ts): the pan/zoom/level state the ping applies,
// and the zone-crossing reset guard it must survive.
//
// Reproduces two real Hud bugs before their fix:
//  - showFinderOnMap left mapLevel untouched, so a ping fired while the map
//    was already open on the continent overview never reached the per-zone
//    view that actually reads mapPing/mapZoom/mapCenter.
//  - updateMapWindow's zone-crossing guard unconditionally reset mapZoom/
//    mapCenter back to the full-frame default the instant the tracked zone
//    changed, which is exactly what happens on the very first redraw after a
//    ping into a different zone than the one the map was already showing.

import { describe, expect, it } from 'vitest';
import {
  SHOW_ON_MAP_MIN_ZOOM,
  shouldResetMapPanOnZoneCross,
  showOnMapPanState,
} from '../src/ui/map_show_on_map_core';

describe('showOnMapPanState', () => {
  it('pans and zooms onto the entrance and forces the per-zone detail level', () => {
    const next = showOnMapPanState(1, 100, -50, 'zoneB');
    expect(next).toEqual({
      zoneOverride: 'zoneB',
      ping: { x: 100, z: -50 },
      zoom: SHOW_ON_MAP_MIN_ZOOM,
      center: { x: 100, z: -50 },
      level: 'zone',
      hoverZone: null,
    });
  });

  it('forces zone level regardless of the map already being on the continent overview', () => {
    // The map state before the ping is irrelevant to the transform: it always
    // returns 'zone', which is the fix for the continent-branch-never-reads-the-
    // ping bug. showOnMapPanState takes no "current level" input at all, so a
    // caller cannot accidentally thread the stale level back through.
    const next = showOnMapPanState(1, 0, 0, 'zoneA');
    expect(next.level).toBe('zone');
    expect(next.hoverZone).toBeNull();
  });

  it('only zooms in from the current zoom, never back out', () => {
    expect(showOnMapPanState(1, 0, 0, 'z').zoom).toBe(SHOW_ON_MAP_MIN_ZOOM);
    expect(showOnMapPanState(SHOW_ON_MAP_MIN_ZOOM, 0, 0, 'z').zoom).toBe(SHOW_ON_MAP_MIN_ZOOM);
    expect(showOnMapPanState(5, 0, 0, 'z').zoom).toBe(5);
  });
});

describe('shouldResetMapPanOnZoneCross', () => {
  it('resets on an ordinary zone crossing with no pending ping', () => {
    expect(shouldResetMapPanOnZoneCross(false, null, 'zoneB')).toBe(true);
  });

  it('resets when a stale override zone does not match the zone just entered', () => {
    // A ping is technically pending, but its override targets a different
    // zone than the one the guard is reacting to: this is an ordinary
    // crossing (or a leftover ping from an earlier, already-superseded call),
    // not the ping's own override taking effect, so the reset must still fire.
    expect(shouldResetMapPanOnZoneCross(true, 'zoneA', 'zoneB')).toBe(true);
  });

  it('skips the reset when the crossing is the pending ping override taking effect', () => {
    // This is the exact sequence showFinderOnMap produces: it sets mapPing and
    // mapZoneOverride to the SAME zone in the same call, then updateMapWindow's
    // tracked mapZoneId differs (the player is standing somewhere else), so the
    // guard fires on the very next redraw. It must not clobber the ping's pan/zoom.
    expect(shouldResetMapPanOnZoneCross(true, 'zoneB', 'zoneB')).toBe(false);
  });

  it('resets when there is an override zone but no pending ping (openZoneFromContinent)', () => {
    // openZoneFromContinent sets mapZoneOverride without ever setting mapPing,
    // and explicitly resets zoom/center itself; the guard must not treat a
    // bare override as a reason to skip its own (redundant but harmless) reset.
    expect(shouldResetMapPanOnZoneCross(false, 'zoneB', 'zoneB')).toBe(true);
  });
});
