// The Farshore: the island in the starter sea, joined to the mainland only
// by the Ferrywalk causeway. What these tests pin is the island's contract:
// a rectangle all but ringed by open ocean, NO teleport, a walkable sandbar
// causeway as the one way over, a dry town and road net, and higher ground
// inland; plus the vale's new organic coast around it.

import { describe, expect, it } from 'vitest';
import { FARSHORE_PORTALS, FARSHORE_ROADS, FARSHORE_ZONE } from '../src/sim/content/farshore';
import { zoneAt } from '../src/sim/data';
import {
  inHollowOpenSea,
  onCauseway,
  terrainHeight,
  valeLandness,
  WATER_LEVEL,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The SHIPPED world seed (src/sim/world_seed.ts, mandated for geometry
// tests): this file long pinned 1337 under a comment claiming it matched
// the fixed client seed, but every shipping host seeds WORLD_SEED, so the
// dry-road and elevation pins were proving a world nobody plays.
const SEED = WORLD_SEED;

describe('Farshore zone registration', () => {
  it('is a rectangle in the starter sea beside the vale', () => {
    expect(FARSHORE_ZONE.xMin).toBe(180);
    expect(FARSHORE_ZONE.xMax).toBe(540);
    expect(FARSHORE_ZONE.zMin).toBe(-180);
    expect(FARSHORE_ZONE.zMax).toBe(180);
    expect(zoneAt(0, 0).id).toBe('eastbrook_vale');
    expect(zoneAt(360, 0).id).toBe('farshore_isle');
    expect(zoneAt(360, 0).biome).toBe('vale'); // shares the vale's sky and song
  });

  it('keeps its hub, graveyard, and every road on dry ground', () => {
    const { hub, graveyard } = FARSHORE_ZONE;
    expect(terrainHeight(hub.x, hub.z, SEED)).toBeGreaterThan(WATER_LEVEL + 0.4);
    expect(terrainHeight(graveyard.x, graveyard.z, SEED)).toBeGreaterThan(WATER_LEVEL + 0.4);
    for (const road of FARSHORE_ROADS) {
      for (let i = 0; i < road.length - 1; i++) {
        const a = road[i];
        const b = road[i + 1];
        const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          expect(
            terrainHeight(x, z, SEED),
            `road ${Math.round(x)},${Math.round(z)}`,
          ).toBeGreaterThan(WATER_LEVEL);
        }
      }
    }
  });

  it('rises inland: the Watch Meadow stands above the town and the shores', () => {
    const crown = terrainHeight(375, -5, SEED);
    expect(crown).toBeGreaterThan(terrainHeight(305, 70, SEED) + 4); // Gullhaven
    expect(crown).toBeGreaterThan(terrainHeight(256, 16, SEED) + 6); // the Landing
  });
});

describe('the Ferrywalk: a walk-in causeway, no teleport', () => {
  it('has no portal: the island is reached on foot', () => {
    expect(FARSHORE_PORTALS).toHaveLength(0);
  });

  it('the causeway is walkable, dry, end to end from the vale point to the Landing', () => {
    // the causeway road IS the sandbar; sample it at footstep scale
    const bar = FARSHORE_ROADS[0]; // the Ferrywalk polyline
    let prev = terrainHeight(bar[0].x, bar[0].z, SEED);
    let maxSlope = 0;
    for (let i = 0; i < bar.length - 1; i++) {
      const a = bar[i];
      const b = bar[i + 1];
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let k = 1; k <= steps; k++) {
        const x = a.x + ((b.x - a.x) * k) / steps;
        const z = a.z + ((b.z - a.z) * k) / steps;
        const h = terrainHeight(x, z, SEED);
        expect(h, `causeway ${Math.round(x)},${Math.round(z)}`).toBeGreaterThan(WATER_LEVEL);
        maxSlope = Math.max(maxSlope, Math.abs(h - prev));
        prev = h;
      }
    }
    expect(maxSlope).toBeLessThan(1.5); // PLAYER_MAX_CLIMB_SLOPE
    expect(onCauseway(200, -14)).toBe(true);
  });

  it('the strait to either side of the causeway is open sea', () => {
    // off the sandbar, north and south, the world is deep water with fatigue
    expect(terrainHeight(200, 55, SEED)).toBeLessThan(WATER_LEVEL);
    expect(terrainHeight(205, -70, SEED)).toBeLessThan(WATER_LEVEL);
    expect(inHollowOpenSea(200, 60)).toBe(true);
    expect(onCauseway(200, 60)).toBe(false);
  });
});

describe('the vale meets the sea with an organic coast', () => {
  it('east, south, and west edges are water, not rim mountains', () => {
    // clearly offshore in the vale's bays
    expect(terrainHeight(-192, 25, SEED)).toBeLessThan(WATER_LEVEL); // the west bay
    expect(terrainHeight(30, -196, SEED)).toBeLessThan(WATER_LEVEL); // the south bay
    expect(terrainHeight(196, 104, SEED)).toBeLessThan(WATER_LEVEL); // the east bay
    // no old rim-range heights left in the shore band
    for (const [x, z] of [
      [-176, -40],
      [40, -172],
    ]) {
      expect(terrainHeight(x, z, SEED), `shore at ${x},${z}`).toBeLessThan(14);
    }
  });

  it('the vale interior is untouched land (the starter fixtures live here)', () => {
    expect(zoneAt(2, -2).id).toBe('eastbrook_vale');
    // the interior sits at high landness, so the coast applier leaves it be
    expect(valeLandness(0, 0)).toBeGreaterThan(0.3);
    expect(terrainHeight(0, 0, SEED)).toBeGreaterThan(WATER_LEVEL + 0.4);
    // the north edge stays the Mirefen land border, full width
    for (const x of [-160, 0, 160]) {
      expect(terrainHeight(x, 174, SEED), `north border ${x}`).toBeGreaterThan(WATER_LEVEL + 0.4);
    }
  });
});
