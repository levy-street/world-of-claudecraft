import { describe, expect, it } from 'vitest';
import {
  distanceSqToZone,
  fogFarForPreparedZones,
  INITIAL_SKY_PREWARM_RADIUS,
  MAX_OUTDOOR_FOG_FAR,
  MIN_OUTDOOR_FOG_FAR,
  UNPREPARED_ZONE_FOG_GUARD,
  ZONE_STREAM_RECHECK_DISTANCE,
  zoneEntryPoint,
  zonesWithinStreamingHorizon,
} from '../src/render/zone_streaming';
import { ZONES, zoneAt } from '../src/sim/data';

describe('renderer zone-streaming horizon', () => {
  it('keeps a zero-radius query scoped to the containing zone', () => {
    expect(zonesWithinStreamingHorizon(ZONES, 0, 0, 0).map((zone) => zone.id)).toEqual([
      'eastbrook_vale',
    ]);
  });

  it('includes a neighbouring column before the player crosses its boundary', () => {
    // From the Mirefen, 30 yd shy of the Galecrest column's west boundary
    // (x = 180), an 80 yd horizon already contains the column. (This used to
    // pin the Farshore at the vale's east edge; the island is far offshore
    // now, so the Galecrest is the nearest column boundary to stand at.)
    const ids = zonesWithinStreamingHorizon(ZONES, 150, 250, 80, 1, 0).map((zone) => zone.id);
    expect(ids).toEqual(['mirefen_marsh', 'galecrest', 'eastbrook_vale']);
    const galecrest = ZONES.find((zone) => zone.id === 'galecrest');
    if (!galecrest) throw new Error('expected Galecrest in built-in zones');
    expect(distanceSqToZone(galecrest, 150, 250)).toBe(30 * 30);
  });

  it('limits the spawn horizon to nearby regions instead of the whole world', () => {
    // the Farshore (700 yd east) no longer makes the cut: only the vale's
    // true land neighbours are inside the 470 yd horizon
    const ids = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, 1, 0).map((zone) => zone.id);
    expect(ids).toEqual(['eastbrook_vale', 'mirefen_marsh', 'galecrest', 'willowfen']);
    expect(ids.length).toBeLessThan(ZONES.length / 2);
  });

  it('limits loading-screen sky uploads to the active and immediately adjacent biomes', () => {
    const nearby = zonesWithinStreamingHorizon(ZONES, 2, -2, INITIAL_SKY_PREWARM_RADIUS);
    expect(nearby.map((zone) => zone.id)).toEqual(['eastbrook_vale', 'mirefen_marsh']);
    expect([...new Set(nearby.map((zone) => zone.biome))]).toEqual(['vale', 'marsh']);
  });

  it('prioritizes the camera-facing zone when adjacent boundaries tie', () => {
    // Galecrest and Willowfen both sit exactly sqrt(2) * 180 yd from (0, 0)
    // (the diagonal corners east and west): the camera facing breaks the tie.
    const east = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, 1, 0).map((zone) => zone.id);
    const west = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, -1, 0).map((zone) => zone.id);
    expect(east.indexOf('galecrest')).toBeLessThan(east.indexOf('willowfen'));
    expect(west.indexOf('willowfen')).toBeLessThan(west.indexOf('galecrest'));
  });

  it('prepares the travel-direction zone before a marginally nearer sideways zone', () => {
    // Regression for the Mirefen crossing stall (a travel-direction bias must
    // beat marginal nearest-first ordering). The original fixture pair, the
    // Farshore 178 yd east vs the Mirefen 182 yd north of spawn, is gone (the
    // island is far offshore now); the surviving marginal pair from (2, -2)
    // is Galecrest (sqrt(64808) yd, the nearer corner) vs Willowfen
    // (sqrt(66248) yd): walking west must build Willowfen first anyway.
    const ids = zonesWithinStreamingHorizon(ZONES, 2, -2, 470, -1, 0).map((zone) => zone.id);
    expect(ids[0]).toBe('eastbrook_vale');
    expect(ids.indexOf('willowfen')).toBeLessThan(ids.indexOf('galecrest'));
    // A stationary east-facing camera still takes the strictly nearer corner.
    const east = zonesWithinStreamingHorizon(ZONES, 2, -2, 470, 1, 0).map((zone) => zone.id);
    expect(east.indexOf('galecrest')).toBeLessThan(east.indexOf('willowfen'));
  });

  it('uses a non-zero movement threshold for cheap frame-loop rechecks', () => {
    expect(ZONE_STREAM_RECHECK_DISTANCE).toBeGreaterThan(0);
  });

  it('every entry point resolves back to its own zone, even from a boundary camera', () => {
    // Regression for the willowfen starvation: the un-inset nearest rectangle
    // point of a zone west of the camera lands exactly on its exclusive max-x
    // edge, zoneAt resolves it to the neighbour, the prepare no-ops, and the
    // streaming queue entry is consumed without ever building the zone.
    const cameras = [
      { x: 25, z: -16 }, // the vale spawn camera that starved willowfen live
      { x: 0, z: 0 },
      { x: 500, z: 2000 },
      { x: -500, z: 900 },
    ];
    for (const zone of ZONES) {
      for (const cam of cameras) {
        const entry = zoneEntryPoint(zone, cam.x, cam.z);
        expect(zoneAt(entry.x, entry.z).id, `${zone.id} from (${cam.x}, ${cam.z})`).toBe(zone.id);
      }
    }
  });
});

describe('renderer zone-residency fog', () => {
  const eastbrookOnly = new Set(['eastbrook_vale']);

  it('clamps ahead of the nearest unprepared zone at the Eastbrook spawn', () => {
    // Mirefen sits 182 yd from (2, -2) and is the closest unprepared zone
    // (the Farshore is 698 yd out at sea), so the fog is held at
    // 182 - guard = 174 no matter what was requested.
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 2, -2, 500)).toBe(174);
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 2, -2, 900)).toBe(174);
  });

  it('keeps the far-offshore Farshore outside the visible envelope from spawn', () => {
    // This used to prove the fog CONTRACTS as the player approached the
    // adjacent Farshore boundary. The island is far offshore now: from the
    // spawn zone it sits 640 yd out, past the whole requested envelope, so
    // it can never be the boundary the fog is protecting; the clamp that
    // does fire belongs to Mirefen (180 yd north), and stays put as the
    // player walks east because Mirefen's border runs alongside.
    const farshore = ZONES.find((zone) => zone.id === 'farshore_isle');
    if (!farshore) throw new Error('expected Farshore in built-in zones');
    expect(distanceSqToZone(farshore, 60, 0)).toBe(640 * 640);
    expect(640 - UNPREPARED_ZONE_FOG_GUARD).toBeGreaterThan(500);
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 60, 0, 500)).toBe(
      180 - UNPREPARED_ZONE_FOG_GUARD,
    );
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 100, 0, 500)).toBe(
      180 - UNPREPARED_ZONE_FOG_GUARD,
    );
  });

  it('never exposes an unloaded boundary at point-blank range', () => {
    // one yard shy of the unprepared Mirefen's z = 180 border
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 0, 179, 500)).toBe(MIN_OUTDOOR_FOG_FAR);
  });

  it('opens the view to the full request after the destination becomes resident', () => {
    const withFarshore = new Set(['eastbrook_vale', 'farshore_isle']);
    // The next unprepared zone is farther than the request, so the biome
    // preset wins outright once the crossing target is resident.
    expect(fogFarForPreparedZones(ZONES, withFarshore, 179, 0, 170)).toBe(170);
  });

  it('caps every request at the rendering envelope even with the world resident', () => {
    const all = new Set(ZONES.map((zone) => zone.id));
    expect(fogFarForPreparedZones(ZONES, all, 0, 0, MAX_OUTDOOR_FOG_FAR + 500)).toBe(
      MAX_OUTDOOR_FOG_FAR,
    );
    expect(fogFarForPreparedZones(ZONES, all, 0, 0, 80)).toBe(80);
  });
});
