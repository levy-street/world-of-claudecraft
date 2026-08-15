// The Palmreach strand's beach palms and their fallen-coconut clusters are
// procedural (reachPalmSpots + reachCoconutSpots), anchored to terrainHeight at
// their exact (x, z). On a near-vertical face that anchor puts the trunk half
// inside the wall and throws the coconuts up the cliff, so both scatters gate
// on DECORATION_MAX_SLOPE the same way the generic tree/rock scatter does.
import { describe, expect, it } from 'vitest';
import { reachCoconutSpots } from '../src/render/jungle_features';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { DECORATION_MAX_SLOPE, reachPalmSpots, terrainSteepness } from '../src/sim/world';

const SEED = 20061;

describe('Palmreach cliff scatter', () => {
  it('keeps the decoration slope limit pinned to the impassable-wall gate', () => {
    expect(DECORATION_MAX_SLOPE).toBe(1.5);
    expect(DECORATION_MAX_SLOPE).toBe(PLAYER_MAX_CLIMB_SLOPE);
  });

  it('plants no beach palm on a cliff face', () => {
    const onCliffs = reachPalmSpots(SEED)
      .filter((p) => terrainSteepness(p.x, p.z, SEED) > DECORATION_MAX_SLOPE)
      .map((p) => `palm@${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    expect(onCliffs).toEqual([]);
  });

  it('drops no coconut cluster on a cliff face', () => {
    const onCliffs = reachCoconutSpots(SEED)
      .filter((c) => terrainSteepness(c.x, c.z, SEED) > DECORATION_MAX_SLOPE)
      .map((c) => `coconuts@${c.x.toFixed(1)},${c.z.toFixed(1)}`);
    expect(onCliffs).toEqual([]);
  });

  it('clears the palm and coconut reported buried in the wall north of the lagoon', () => {
    // The wall at z=1188 climbs from -4.2 to 31.4 over about twelve yards. The
    // palm stood at (-192.6, 1188.0) with its one surviving coconut cluster
    // fourteen yards up the face at (-188.3, 1187.2).
    const nearPalm = reachPalmSpots(SEED).filter((p) => Math.hypot(p.x + 192.6, p.z - 1188) < 2);
    expect(nearPalm).toEqual([]);
    const nearCoconuts = reachCoconutSpots(SEED).filter(
      (c) => Math.hypot(c.x + 188.3, c.z - 1187.2) < 2,
    );
    expect(nearCoconuts).toEqual([]);
  });

  it('leaves the rest of the strand standing', () => {
    // The gate is a cliff filter, not a cull: the strand keeps its canopy and
    // the clusters still outnumber the palms that carry them.
    const palms = reachPalmSpots(SEED);
    const coconuts = reachCoconutSpots(SEED);
    expect(palms.length).toBeGreaterThan(250);
    expect(coconuts.length).toBeGreaterThan(300);
  });
});
