// The active-content world readers and their EMPTY-ZONE-LIST policy, pinned
// as one contract (the merge-settlement checkpoint's decision):
//
//   Zone RESOLUTION stays TOTAL: zoneAt, zoneBiomeAt, and worldXBoundsAt fall
//   back to the builtin zones when a hand-built content carries an empty zone
//   list, because their callers demand an answer at every coordinate.
//
//   Terrain FEATURES follow the active content VERBATIM: baseHeight's
//   hub-plateau and lake-carve loops read the zone list raw, so a zero-zone
//   content flattens no builtin hubs and carves no builtin lakes (an
//   invisible builtin plateau under a custom map would be worse than a bare
//   hill). The band-shape cascade (shapeAt) still reads the static builtin
//   bands: byte-identical on every shipped host, a known custom-map seam,
//   deferred with the map-editor terrain work.
//
// On shipped hosts BUILTIN_WORLD.zones IS the ZONES reference, so every arm
// here is exercising paths the builtin world cannot reach; the parity suite
// (byte-identical goldens) is what pins the builtin world.
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_WORLD,
  setActiveWorldContent,
  worldXBoundsAt,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import type { WorldContent } from '../src/sim/types';
import { terrainHeight, zoneBiomeAt } from '../src/sim/world';

const SEED = 4242;

afterEach(() => {
  setActiveWorldContent(null);
});

function zeroZoneContent(): WorldContent {
  return { ...BUILTIN_WORLD, zones: [], camps: [], roads: [] };
}

function customPeaks(): WorldContent {
  return {
    ...BUILTIN_WORLD,
    zones: [
      {
        id: 'custom_band',
        name: 'Custom Peaks',
        zMin: -180,
        zMax: 180,
        levelRange: [1, 10],
        biome: 'peaks',
        hub: { x: 50, z: 50, radius: 20, name: 'Camp' },
        graveyard: { x: 0, z: 0 },
        lakes: [],
        pois: [],
        welcome: '',
      },
    ],
    camps: [],
    roads: [],
  };
}

describe('zone resolution stays total on an empty zone list', () => {
  it('zoneAt, zoneBiomeAt, and worldXBoundsAt all fall back to the builtin zones', () => {
    const builtinZone = zoneAt(50, 50).id;
    const builtinBounds = worldXBoundsAt(50);
    setActiveWorldContent(zeroZoneContent());
    expect(zoneAt(50, 50).id).toBe(builtinZone);
    expect(zoneBiomeAt(50, 50)).toBe(zoneAt(50, 50).biome);
    const bounds = worldXBoundsAt(50);
    expect(Number.isFinite(bounds.min)).toBe(true);
    expect(Number.isFinite(bounds.max)).toBe(true);
    expect(bounds.min).toBeLessThan(bounds.max);
    expect(bounds).toEqual(builtinBounds);
  });
});

describe('terrain features follow the active content verbatim', () => {
  it('a zero-zone content flattens no builtin hub (and stays finite)', () => {
    const hub = ZONES[0].hub;
    const builtinAtHub = terrainHeight(hub.x, hub.z, SEED);
    setActiveWorldContent(zeroZoneContent());
    const bare = terrainHeight(hub.x, hub.z, SEED);
    expect(Number.isFinite(bare)).toBe(true);
    // The builtin world plateaus the hub (blend 0 inside radius*0.7 gives the
    // biome's exact hubHeight); with no zones there is no plateau, so the raw
    // hill shows through and the two heights diverge.
    expect(bare).not.toBeCloseTo(builtinAtHub, 4);
  });

  it('the hub-plateau loop reads the ACTIVE zone list (moving the hub moves the plateau)', () => {
    // Two contents identical except where the hub sits: if the plateau loop
    // reads the active content, the height AT the first hub's core changes
    // when the hub moves away; if it silently fell back to the builtin
    // zones, both reads would agree and this arm reds. (terrainHeight
    // layers more than baseHeight, so exact-hubHeight flatness is not
    // assertable here; the hub-position sensitivity is.)
    const hubAt = customPeaks();
    setActiveWorldContent(hubAt);
    const withHub = terrainHeight(50, 50, SEED);
    expect(Number.isFinite(withHub)).toBe(true);
    const hubAway = customPeaks();
    hubAway.zones = [{ ...hubAway.zones[0], hub: { x: -300, z: -150, radius: 20, name: 'Camp' } }];
    setActiveWorldContent(hubAway);
    const withoutHub = terrainHeight(50, 50, SEED);
    expect(Number.isFinite(withoutHub)).toBe(true);
    expect(withHub).not.toBeCloseTo(withoutHub, 4);
  });

  it('a custom band resolves zone identity and bounds for its own rect', () => {
    setActiveWorldContent(customPeaks());
    expect(zoneAt(50, 50).id).toBe('custom_band');
    expect(zoneBiomeAt(50, 50)).toBe('peaks');
    const bounds = worldXBoundsAt(50);
    expect(Number.isFinite(bounds.min)).toBe(true);
    expect(Number.isFinite(bounds.max)).toBe(true);
    expect(bounds.min).toBeLessThan(bounds.max);
  });
});
