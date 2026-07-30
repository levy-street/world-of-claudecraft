import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_NEIGHBOR_STREAM_RADIUS,
  distanceSqToZone,
  INITIAL_SKY_PREWARM_RADIUS,
  ZONE_STREAM_RECHECK_DISTANCE,
  zoneEntryPoint,
  zonesWithinStreamingHorizon,
} from '../src/render/zone_streaming';
import { ZONES, zoneAt } from '../src/sim/data';

// The outdoor fog clamp itself moved to chunk_residency_core (it keys off the
// nearest unbuilt CHUNK now, not the nearest unprepared zone rectangle), so its
// behaviour is pinned in tests/chunk_residency.test.ts. What stays here is the
// zone policy that is still live: which zones to stream, and in what order.

describe('renderer zone-streaming horizon', () => {
  it('keeps a zero-radius query scoped to the containing zone', () => {
    expect(zonesWithinStreamingHorizon(ZONES, 0, 0, 0).map((zone) => zone.id)).toEqual([
      'eastbrook_vale',
    ]);
  });

  it('includes a neighbouring column before the player crosses its boundary', () => {
    const ids = zonesWithinStreamingHorizon(ZONES, 150, 0, 80, 1, 0).map((zone) => zone.id);
    expect(ids).toEqual(['eastbrook_vale', 'farshore_isle']);
    const farshore = ZONES.find((zone) => zone.id === 'farshore_isle');
    if (!farshore) throw new Error('expected Farshore in built-in zones');
    expect(distanceSqToZone(farshore, 150, 0)).toBe(30 * 30);
  });

  it('limits the spawn horizon to nearby regions instead of the whole world', () => {
    const ids = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, 1, 0).map((zone) => zone.id);
    expect(ids).toEqual([
      'eastbrook_vale',
      'farshore_isle',
      'mirefen_marsh',
      'galecrest',
      'willowfen',
    ]);
    expect(ids.length).toBeLessThan(ZONES.length / 2);
  });

  it('limits loading-screen sky uploads to the active and immediately adjacent biomes', () => {
    const nearby = zonesWithinStreamingHorizon(ZONES, 2, -2, INITIAL_SKY_PREWARM_RADIUS);
    expect(nearby.map((zone) => zone.id)).toEqual([
      'eastbrook_vale',
      'farshore_isle',
      'mirefen_marsh',
    ]);
    expect([...new Set(nearby.map((zone) => zone.biome))]).toEqual(['vale', 'marsh']);
  });

  it('prioritizes the camera-facing zone when adjacent boundaries tie', () => {
    const east = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, 1, 0).map((zone) => zone.id);
    const north = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, 0, 1).map((zone) => zone.id);
    expect(east.indexOf('farshore_isle')).toBeLessThan(east.indexOf('mirefen_marsh'));
    expect(north.indexOf('mirefen_marsh')).toBeLessThan(north.indexOf('farshore_isle'));
  });

  it('prepares the travel-direction zone before a marginally nearer sideways zone', () => {
    // Regression for the Mirefen crossing stall: from the spawn walk north,
    // Farshore (178 yd east) is strictly nearer than Mirefen (182 yd north),
    // so nearest-first ordering spent the whole approach building the isle
    // while the player crossed into an unprepared marsh.
    const ids = zonesWithinStreamingHorizon(ZONES, 2, -2, 470, 0, 1).map((zone) => zone.id);
    expect(ids[0]).toBe('eastbrook_vale');
    expect(ids.indexOf('mirefen_marsh')).toBeLessThan(ids.indexOf('farshore_isle'));
    // A stationary east-facing camera still takes the strictly nearer isle.
    const east = zonesWithinStreamingHorizon(ZONES, 2, -2, 470, 1, 0).map((zone) => zone.id);
    expect(east.indexOf('farshore_isle')).toBeLessThan(east.indexOf('mirefen_marsh'));
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

describe('teleport-arrival neighbourhood', () => {
  it('reaches every neighbour that would clamp a Drakelands portal landing', () => {
    // A realm portal into the Drakelands lands on the zone's western margin:
    // the Frostveil rectangle is 37 yd away and the Wraithwood 51 yd. Preparing
    // only the destination there left the player looking at a 45-yard wall of
    // ember haze (measured: still clamped after 198 s).
    const landing = { x: 217, z: 1871 };
    expect(zoneAt(landing.x, landing.z).id).toBe('drakelands');
    const arrival = zonesWithinStreamingHorizon(
      ZONES,
      landing.x,
      landing.z,
      ARRIVAL_NEIGHBOR_STREAM_RADIUS,
    );
    expect([...arrival.map((zone) => zone.id)].sort()).toEqual([
      'drakelands',
      'frostveil',
      'wraithwood',
    ]);
  });

  it('reaches the Mirefen border from a Thornpeak south-edge login', () => {
    // Reported live: logging in at (-2, 580) put the player 40 yd from the
    // Mirefen rectangle, and the peaks preset's 850-yard vista sat at the
    // 45-yard floor for about a minute.
    const login = { x: -2, z: 580 };
    expect(zoneAt(login.x, login.z).id).toBe('thornpeak_heights');
    const arrival = zonesWithinStreamingHorizon(
      ZONES,
      login.x,
      login.z,
      ARRIVAL_NEIGHBOR_STREAM_RADIUS,
    );
    expect([...arrival.map((zone) => zone.id)].sort()).toEqual([
      'mirefen_marsh',
      'thornpeak_heights',
    ]);
  });

  it('streams nothing extra for a landing in the middle of a rectangle', () => {
    // The Eastbrook hearthstone: no other rectangle is within the radius, so
    // the common arrival pays exactly what it paid before.
    const arrival = zonesWithinStreamingHorizon(ZONES, 0, 0, ARRIVAL_NEIGHBOR_STREAM_RADIUS);
    expect(arrival.map((zone) => zone.id)).toEqual(['eastbrook_vale']);
  });
});
