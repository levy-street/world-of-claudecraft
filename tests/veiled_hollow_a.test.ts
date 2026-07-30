// The Veiled Hollow, shard a: zone registration and the sealed border ridge
// walked northward (into the realm). See tests/veiled_hollow_shared.ts; the
// southward scan lives in veiled_hollow_b, the live-sim movement wall and
// coastline in veiled_hollow.test.ts.

import { describe, expect, it } from 'vitest';
import { REALM_ZONE } from '../src/sim/content/realm';
import { WORLD_MAX_Z, ZONES, zoneAt } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { SEED } from './veiled_hollow_shared';

describe('Veiled Hollow zone registration', () => {
  it('sits fourth in the band order, tiled against Thornpeak', () => {
    // Once the world's last band, now the gateway to the northern realms:
    // the Drakelands tile against its north edge, the Frostveil past them.
    expect(ZONES[3].id).toBe('veiled_hollow');
    expect(ZONES[3].zMin).toBe(900);
    // the continent: the strip column stacks vale to garden; the columns
    // sit beside their rows (fire and ice, dream and nightmare, and so on)
    const byId = (id: string) => ZONES.find((zn) => zn.id === id)!;
    expect(byId('frostveil').zMin).toBe(ZONES[3].zMax); // the strip's north cap
    expect(byId('drakelands').xMin).toBe(180); // east beside the Reach
    expect(byId('amberfall').xMax).toBe(-180); // west beside the Reach
    expect(byId('galecrest').zMin).toBe(180); // the east column's south end
    expect(byId('evergarden').zMin).toBe(byId('galecrest').zMax);
    expect(byId('wraithwood').zMin).toBe(byId('evergarden').zMax);
    expect(byId('drakelands').zMin).toBe(byId('wraithwood').zMax);
    expect(byId('willowfen').zMin).toBe(180); // the west column's south end
    expect(byId('palmreach').zMin).toBe(byId('willowfen').zMax);
    expect(byId('nightbloom').zMin).toBe(byId('palmreach').zMax);
    expect(byId('amberfall').zMin).toBe(byId('nightbloom').zMax);
    // append order is rng-stream order, not stack order, since the grid:
    // the world's north end is the MAX zMax over all zones
    expect(WORLD_MAX_Z).toBe(Math.max(...ZONES.map((zn) => zn.zMax)));
    expect(zoneAt(0, 1000).id).toBe('veiled_hollow');
    expect(zoneAt(0, 899).id).toBe('thornpeak_heights');
    expect(zoneAt(0, 1500).id).toBe('frostveil');
    expect(zoneAt(360, 2000).id).toBe('drakelands');
  });

  it('declares its southern border sealed', () => {
    expect(REALM_ZONE.sealedSouthBorder).toBe(true);
  });

  it('keeps its hub and graveyard on dry, in-zone ground', () => {
    const { hub, graveyard } = REALM_ZONE;
    expect(hub.z).toBeGreaterThan(REALM_ZONE.zMin);
    expect(hub.z).toBeLessThan(REALM_ZONE.zMax);
    expect(terrainHeight(hub.x, hub.z, SEED)).toBeGreaterThan(WATER_LEVEL);
    expect(terrainHeight(graveyard.x, graveyard.z, SEED)).toBeGreaterThan(WATER_LEVEL);
  });
});

describe('the sealed border wall', () => {
  // Steepest straight-line gradient found walking north across the wall band
  // at a fixed x, sampled at the footstep scale the sim's climb check uses.
  function maxNorthGradient(x: number, seed: number): number {
    const step = 0.5;
    let steepest = 0;
    // terrainHeight is pure and seeded, so the sample at z + step is carried
    // into the next iteration instead of being recomputed: bit-identical rises
    // at half the terrain calls.
    let prev = terrainHeight(x, 880, seed);
    for (let z = 880; z < 955; z += step) {
      const next = terrainHeight(x, z + step, seed);
      const rise = next - prev;
      prev = next;
      if (rise / step > steepest) steepest = rise / step;
    }
    return steepest;
  }

  it('blocks a straight walk in from Thornpeak at every x (several seeds)', () => {
    for (const seed of [SEED, 1, 42, 99999]) {
      for (let x = -170; x <= 170; x += 1) {
        expect(maxNorthGradient(x, seed), `x=${x} seed=${seed}`).toBeGreaterThan(
          PLAYER_MAX_CLIMB_SLOPE,
        );
      }
    }
  });

  it('leaves the Gravewyrm Sanctum approach essentially unchanged', () => {
    // The sealed crest sits 15yd inside the realm band with a narrow sigma,
    // so the raid gate at (0, 880) must not have been shoved upward.
    const atSanctum = terrainHeight(0, 880, SEED);
    const nearby = terrainHeight(0, 860, SEED);
    expect(Math.abs(atSanctum - nearby)).toBeLessThan(12);
  });
});
