import { afterEach, describe, expect, it } from 'vitest';
import { isLeapableWater } from '../src/render/fish';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { findPlayerPath, PLAYER_SWIM_DEPTH, resolvePlayerDestination } from '../src/sim/pathfind';
import type { WorldContent } from '../src/sim/types';
import {
  isInWaterBody,
  terrainHeight,
  WATER_LEVEL,
  waterBodies,
  waterLevelAt,
} from '../src/sim/world';
import { mapCanvasHeight, paintTerrainRows } from '../src/ui/map_terrain';

// #1518: water height must be terrain/feature-aware (declared lakes only), not
// a single flat height applied to a whole zone. A content author's sunken
// feature outside every declared lake must stay dry and walkable no matter how
// deep it goes.

const SEED = 20061; // matches the deep-lake-cell seed used in pathfind.test.ts
// Open ground in zone 1, well clear of the built-in lake (-92, 88, r30) and
// clear of static colliders.
const DRY_SPOT = { x: 30, z: 40 };
const DEEP_DELTA = -25; // well past WATER_LEVEL - PLAYER_SWIM_DEPTH

function withSunkenFeature(): WorldContent {
  return {
    ...BUILTIN_WORLD,
    terrainEdits: [
      { x: DRY_SPOT.x, z: DRY_SPOT.z, radius: 6, delta: DEEP_DELTA, falloff: 'flat', mode: 'add' },
    ],
  };
}

afterEach(() => setActiveWorldContent(null));

describe('terrain/feature-aware water (#1518)', () => {
  it('the built-in lake is a declared water body; open ground is not', () => {
    const [lakeX, lakeZ] = [-92, 88];
    expect(isInWaterBody(lakeX, lakeZ)).toBe(true);
    expect(isInWaterBody(DRY_SPOT.x, DRY_SPOT.z)).toBe(false);
    expect(waterLevelAt(lakeX, lakeZ)).toBe(WATER_LEVEL);
    expect(waterLevelAt(DRY_SPOT.x, DRY_SPOT.z)).toBe(-Infinity);
  });

  it('waterBodies() reflects only declared lakes, not incidental low terrain', () => {
    const bodies = waterBodies();
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => Math.hypot(b.x - DRY_SPOT.x, b.z - DRY_SPOT.z) < b.radius)).toBe(
      false,
    );
  });

  it('a sunken feature outside any declared lake goes well below the old global floor', () => {
    setActiveWorldContent(withSunkenFeature());
    const h = terrainHeight(DRY_SPOT.x, DRY_SPOT.z, SEED);
    expect(h).toBeLessThan(WATER_LEVEL - PLAYER_SWIM_DEPTH - 5);
    expect(isInWaterBody(DRY_SPOT.x, DRY_SPOT.z)).toBe(false);
  });

  it('a dry sunken feature does not block normal (non-swim) walking', () => {
    setActiveWorldContent(withSunkenFeature());
    expect(isBlocked(SEED, DRY_SPOT.x, DRY_SPOT.z)).toBe(false);

    // resolvePlayerDestination (walker) lands exactly on the deep-but-dry spot,
    // instead of being shoved away as if it were flooded.
    const dest = resolvePlayerDestination(SEED, DRY_SPOT, false);
    expect(dest).toEqual(DRY_SPOT);

    // A player path can end inside the sunken feature without detouring around
    // it as deep water.
    const from = { x: DRY_SPOT.x - 10, z: DRY_SPOT.z };
    const path = findPlayerPath(SEED, from, DRY_SPOT, 64, false, false);
    expect(path[path.length - 1]).toEqual(DRY_SPOT);
  });

  it('render-side water predicates (swim pose, underwater fog, ambience) stay dry at a sunken feature', () => {
    // src/render/renderer.ts derives swim pose / fog / ambience from
    // waterLevelAt(x, z), not the old flat waterLevel(): a dry sunken feature
    // must never satisfy those predicates no matter how deep it goes.
    setActiveWorldContent(withSunkenFeature());
    const h = terrainHeight(DRY_SPOT.x, DRY_SPOT.z, SEED);
    const wl = waterLevelAt(DRY_SPOT.x, DRY_SPOT.z);
    expect(wl).toBe(-Infinity);
    expect(h <= wl - 0.5).toBe(false); // swim-pose feet-depth gate
    expect(h < wl + 0.4).toBe(false); // ambience nearWater gate
  });

  it('a real declared lake still blocks walkers and still requires swim to enter', () => {
    const water = { x: -108, z: 84 }; // deep lake cell (see pathfind.test.ts)
    expect(terrainHeight(water.x, water.z, SEED)).toBeLessThan(WATER_LEVEL - PLAYER_SWIM_DEPTH);
    expect(isInWaterBody(water.x, water.z)).toBe(true);

    const walked = resolvePlayerDestination(SEED, water, false);
    expect(Math.hypot(walked.x - water.x, walked.z - water.z)).toBeGreaterThan(0.5);

    const swum = resolvePlayerDestination(SEED, water, true);
    expect(Math.hypot(swum.x - water.x, swum.z - water.z)).toBeLessThan(0.5);
  });

  it('src/render/fish.ts never leaps at a dry sunken feature (real render predicate)', () => {
    setActiveWorldContent(withSunkenFeature());
    // mirrors buildFish()'s depthAt: waterLevelAt() - terrainHeight(), the
    // actual render-side composition, not a hand-duplicated formula.
    const depthAt = (x: number, z: number): number =>
      waterLevelAt(x, z) - terrainHeight(x, z, SEED);
    expect(isLeapableWater(DRY_SPOT.x, DRY_SPOT.z, depthAt)).toBe(false);

    const [lakeX, lakeZ] = [-108, 84]; // deep lake cell (see pathfind.test.ts)
    expect(isLeapableWater(lakeX, lakeZ, depthAt)).toBe(true);
  });

  it('src/ui/map_terrain.ts never paints a dry sunken feature as water', () => {
    setActiveWorldContent(withSunkenFeature());
    const region = {
      minX: DRY_SPOT.x - 8,
      maxX: DRY_SPOT.x + 8,
      minZ: DRY_SPOT.z - 8,
      maxZ: DRY_SPOT.z + 8,
    };
    const W = 32;
    const H = mapCanvasHeight(W, region);
    const data = new Uint8ClampedArray(W * H * 4);
    paintTerrainRows(data, W, H, region, SEED, 0, H);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    const k = (cy * W + cx) * 4;
    // the map's water blue is (38, 84, 138); a dry sunken feature must not
    // paint that color no matter how deep it goes.
    expect([data[k], data[k + 1], data[k + 2]]).not.toEqual([38, 84, 138]);
  });
});
