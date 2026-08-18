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
