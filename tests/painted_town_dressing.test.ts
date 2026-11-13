// Drawn ground dressing (a bush, a fern, a mushroom) never roots in a painted town building:
// the dressing field is scattered over the whole map and only the hub circle, camps and
// roads kept it off the towns, so a lot standing outside its hub's clearing (the Palmreach
// inn) had a fern growing up through its floor.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateDressing } from '../src/render/foliage_dressing_spots';
import { zoneAt } from '../src/sim/data';
import {
  PAINTED_TOWN_DRESSING_PAD,
  paintedTownReachCovers,
} from '../src/sim/decoration_exclusions';
import { PAINTED_TOWNS } from '../src/sim/painted_towns';
import { distancePointToObb } from '../src/sim/placed_town_kit';

const SEED = 20061;
const reaches = PAINTED_TOWNS.flatMap((town) => town.buildings.map((building) => building.reach));

describe('drawn ground dressing keeps out of painted town buildings', () => {
  it('pins the reach and has towns to keep out of', () => {
    expect(PAINTED_TOWN_DRESSING_PAD).toBe(0.6);
    expect(reaches.length).toBeGreaterThan(30);
  });

  it('leaves no dressing spot inside any building or within the pad of its walls', () => {
    const spots = generateDressing(SEED);
    expect(spots.length).toBeGreaterThan(1000);
    // The Evergarden takes no random dressing: its clipped bushes are authored parterre
    // arrangements appended after the scatter (garden_parterre_core.ts), laid along its
    // town's walks on purpose, and are not this rule's to move.
    const inside = spots.filter(
      (spot) =>
        zoneAt(spot.x, spot.z).biome !== 'garden' &&
        reaches.some((reach) => distancePointToObb(spot, reach) < PAINTED_TOWN_DRESSING_PAD),
    );
    expect(inside.map((spot) => `${spot.kind} ${spot.x.toFixed(1)},${spot.z.toFixed(1)}`)).toEqual(
      [],
    );
  });

  it('drops only the authored Evergarden bushes a rebuilt house stands over', () => {
    const garden = generateDressing(SEED).filter(
      (spot) => zoneAt(spot.x, spot.z).biome === 'garden',
    );
    // the walks keep their rows...
    expect(garden.length).toBeGreaterThan(100);
    // ...but none of them is left under a building
    const under = garden.filter((spot) =>
      reaches.some((reach) => distancePointToObb(spot, reach) <= 0),
    );
    expect(under.map((spot) => `${spot.x.toFixed(1)},${spot.z.toFixed(1)}`)).toEqual([]);
    // the bush at the pond house's corner, just outside its outline, stays in its row
    expect(garden.some((spot) => Math.hypot(spot.x - 344.6, spot.z - 837.6) < 0.2)).toBe(true);
  });

  it('still dresses the ground just outside the walls', () => {
    const near = generateDressing(SEED).filter((spot) =>
      reaches.some((reach) => {
        const d = distancePointToObb(spot, reach);
        return d >= PAINTED_TOWN_DRESSING_PAD && d < 8;
      }),
    );
    expect(near.length).toBeGreaterThan(0);
  });

  it('is the reach test the scatter and the lamps use, at its own pad', () => {
    const reach = reaches[0];
    const { x, z } = reach.center;
    expect(paintedTownReachCovers(x, z, PAINTED_TOWN_DRESSING_PAD)).toBe(true);
    expect(paintedTownReachCovers(x + 500, z + 500, PAINTED_TOWN_DRESSING_PAD)).toBe(false);
  });

  it('is wired into the drawn scatter, and the editor copy is left for a bundle rebuild', () => {
    const render = readFileSync(
      new URL('../src/render/foliage_dressing_spots.ts', import.meta.url),
      'utf8',
    );
    expect(render).toContain(
      'if (paintedTownReachCovers(x, z, PAINTED_TOWN_DRESSING_PAD)) continue;',
    );
    const sim = readFileSync(new URL('../src/sim/ground_dressing.ts', import.meta.url), 'utf8');
    expect(sim).not.toContain('paintedTownReachCovers');
  });
});
