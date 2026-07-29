// The Farshore: a LARGE island far out in the eastern sea, boat-only. What
// these tests pin is the island's contract: a rectangle in open ocean far
// past the mainland coast, NO portal and NO land link (deep fatiguing sea
// the whole way across), a dry town and road net, higher ground inland, the
// authored topology (cliffs wall the east, the breach crater sits dry
// inside its rim, the Wreckfields lie low), and the vale's organic coast on
// the mainland side.

import { describe, expect, it } from 'vitest';
import {
  FARSHORE_CAMPS,
  FARSHORE_PORTALS,
  FARSHORE_ROADS,
  FARSHORE_ZONE,
} from '../src/sim/content/farshore';
import { zoneAt } from '../src/sim/data';
import {
  FARSHORE_BREACH,
  inHollowOpenSea,
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
  it('pins the established shared-stream budget and private expansion tail', () => {
    expect(FARSHORE_CAMPS.map((camp) => camp.sharedRngCount)).toEqual([
      2,
      2,
      1,
      1,
      4,
      3,
      2,
      2,
      undefined,
    ]);
    expect(
      FARSHORE_CAMPS.reduce(
        (sum, camp) => sum + (camp.sharedRngCount === undefined ? camp.count : camp.sharedRngCount),
        0,
      ),
    ).toBe(18);
    expect(
      FARSHORE_CAMPS.reduce(
        (sum, camp) =>
          sum +
          (camp.sharedRngCount === undefined ? 0 : Math.max(0, camp.count - camp.sharedRngCount)),
        0,
      ),
    ).toBe(16);
  });

  it('is a rectangle far offshore in the eastern sea', () => {
    expect(FARSHORE_ZONE.xMin).toBe(700);
    expect(FARSHORE_ZONE.xMax).toBe(1300);
    expect(FARSHORE_ZONE.zMin).toBe(-250);
    expect(FARSHORE_ZONE.zMax).toBe(290);
    expect(zoneAt(0, 0).id).toBe('eastbrook_vale');
    expect(zoneAt(1000, 10).id).toBe('farshore_isle');
    expect(zoneAt(1000, 10).biome).toBe('vale'); // shares the vale's sky and song
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

  it('rises inland with the authored topology', () => {
    const meadow = terrainHeight(990, 10, SEED);
    // the Watch Meadow stands above the town and the Landing beach
    expect(meadow).toBeGreaterThan(terrainHeight(822, 118, SEED) + 3);
    expect(meadow).toBeGreaterThan(terrainHeight(780, -30, SEED) + 5);
    // the Sundered Cliffs wall the east coast: real mountains
    expect(terrainHeight(1170, -35, SEED)).toBeGreaterThan(35);
    // the breach crater floor is dry and sits inside a raised rim
    const crater = terrainHeight(FARSHORE_BREACH.x, FARSHORE_BREACH.z, SEED);
    expect(crater).toBeGreaterThan(WATER_LEVEL + 2);
    expect(terrainHeight(FARSHORE_BREACH.x, FARSHORE_BREACH.z + 26, SEED)).toBeGreaterThan(
      crater + 3,
    );
    // the Wreckfields lie low near the tide line
    expect(terrainHeight(885, 200, SEED)).toBeLessThan(4);
    expect(terrainHeight(885, 200, SEED)).toBeGreaterThan(WATER_LEVEL);
  });
});

describe('the crossing: boat-only, no land link', () => {
  it('has no portal: the ferry is the one way over', () => {
    expect(FARSHORE_PORTALS).toHaveLength(0);
  });

  it('the strait is deep, fatiguing ocean the whole way across', () => {
    // walk a straight line from the mainland dock toward Gullhaven: every
    // underwater sample between the two shores is fatiguing open sea
    const from = { x: 200, z: -30 };
    const to = { x: 760, z: 60 };
    let wet = 0;
    let total = 0;
    for (let k = 0; k <= 60; k++) {
      const x = from.x + ((to.x - from.x) * k) / 60;
      const z = from.z + ((to.z - from.z) * k) / 60;
      const h = terrainHeight(x, z, SEED);
      total++;
      if (h < WATER_LEVEL) {
        wet++;
        expect(inHollowOpenSea(x, z), `fatigue at ${Math.round(x)},${Math.round(z)}`).toBe(true);
      }
    }
    // nearly the entire crossing is water (only the shore aprons are dry)
    expect(wet / total).toBeGreaterThan(0.85);
    // and the middle of the strait is deep
    expect(terrainHeight(480, 10, SEED)).toBeLessThan(WATER_LEVEL - 1);
  });

  it("Gullhaven's harbor bay is calm water (no drowning off the town pier)", () => {
    expect(terrainHeight(775, 118, SEED)).toBeLessThan(WATER_LEVEL);
    expect(inHollowOpenSea(775, 118)).toBe(false);
  });

  it('no dry backdoor rings the island: north, east, and south are open sea', () => {
    for (const [x, z] of [
      [1000, -320],
      [1330, 0],
      [1366, -100],
      [1395, -100],
      [1000, 330],
      [640, -150],
    ]) {
      expect(terrainHeight(x, z, SEED), `sea at ${x},${z}`).toBeLessThan(WATER_LEVEL);
      expect(inHollowOpenSea(x, z), `fatigue at ${x},${z}`).toBe(true);
    }
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
