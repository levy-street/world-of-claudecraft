import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  isSubmergedAt,
  rideHeight,
  rideHeightAt,
  rideSteepnessAt,
  SHORE_STEP_UP,
  shoreStepOut,
} from '../src/sim/ride_height';
import type { HeightStamp, WorldContent } from '../src/sim/types';
import { groundHeight, terrainSteepness, terrainSteepnessAt, WATER_LEVEL } from '../src/sim/world';

// Unit surface of src/sim/ride_height.ts: the waterline-clamped view of the
// heightfield that the movement kernel gates slopes on. Sculpted level stamps
// inside the built-in zone 1 lake give exact submerged heights.

const SEED = 42;
const LAKE = { x: -92, z: 88 }; // declared water body, r30
const DRY = { x: 30, z: 40 }; // open ground, no waterline

// A submerged shelf with a wading pocket, and a tall column rising out of the
// shelf (dry top, unstandable face).
const COL = { x: -78, z: 88 };
const EDITS: HeightStamp[] = [
  { x: LAKE.x, z: LAKE.z, radius: 8, delta: WATER_LEVEL - 0.1, falloff: 'flat', mode: 'level' },
  { x: LAKE.x, z: LAKE.z, radius: 3, delta: WATER_LEVEL - 0.75, falloff: 'flat', mode: 'level' },
  { x: COL.x, z: COL.z, radius: 5, delta: WATER_LEVEL - 0.05, falloff: 'flat', mode: 'level' },
  { x: COL.x, z: COL.z, radius: 1.5, delta: WATER_LEVEL + 3, falloff: 'flat', mode: 'level' },
];

function world(): WorldContent {
  return { ...BUILTIN_WORLD, terrainEdits: EDITS };
}

afterEach(() => setActiveWorldContent(null));

describe('ride_height: the waterline-clamped heightfield view', () => {
  it('clamps submerged ground to the waterline and leaves dry ground alone', () => {
    setActiveWorldContent(world());
    expect(rideHeight(LAKE.x, LAKE.z, WATER_LEVEL - 0.75, SEED)).toBe(WATER_LEVEL);
    expect(rideHeightAt(LAKE.x, LAKE.z, SEED)).toBe(WATER_LEVEL);
    expect(isSubmergedAt(LAKE.x, LAKE.z, SEED)).toBe(true);
    // no declared water body: -Infinity waterline never clamps
    expect(rideHeight(DRY.x, DRY.z, -20, SEED)).toBe(-20);
    expect(rideHeightAt(DRY.x, DRY.z, SEED)).toBe(groundHeight(DRY.x, DRY.z, SEED));
    expect(isSubmergedAt(DRY.x, DRY.z, SEED)).toBe(false);
  });

  it('reads a submerged step as flat, but defers to the memoized view on dry ground', () => {
    setActiveWorldContent(world());
    // the pocket rim: a 0.65yd instant step, entirely under water
    const rim = { x: LAKE.x + 3, z: LAKE.z };
    expect(terrainSteepness(rim.x, rim.z, SEED)).toBeGreaterThan(0.5);
    expect(rideSteepnessAt(rim.x, rim.z, SEED)).toBeLessThan(0.01);
    // dry ground: bit-identical to the memoized terrain view
    expect(rideSteepnessAt(DRY.x, DRY.z, SEED)).toBe(terrainSteepnessAt(DRY.x, DRY.z, SEED));
  });

  it('shore step-out: from water onto a low standable bank only', () => {
    setActiveWorldContent(world());
    const shelf = { x: COL.x + 3, z: COL.z }; // submerged footing near the column
    // onto more submerged shelf: standable and under the step-up ceiling
    expect(shoreStepOut(shelf.x, shelf.z, shelf.x + 1, shelf.z, SEED, 1.5)).toBe(true);
    // onto the column top: higher than SHORE_STEP_UP above the waterline
    expect(groundHeight(COL.x, COL.z, SEED)).toBeGreaterThan(WATER_LEVEL + SHORE_STEP_UP);
    expect(shoreStepOut(shelf.x, shelf.z, COL.x, COL.z, SEED, 1.5)).toBe(false);
    // onto the column's foot: low enough, but not standable (slide-back face)
    expect(shoreStepOut(shelf.x, shelf.z, COL.x + 1.5, COL.z, SEED, 1.5)).toBe(false);
    // from dry footing: the assist never applies on land
    expect(shoreStepOut(DRY.x, DRY.z, DRY.x + 1, DRY.z, SEED, 1.5)).toBe(false);
  });

  it('is deterministic: identical values for identical inputs', () => {
    setActiveWorldContent(world());
    const probe = (): number[] => [
      rideHeightAt(LAKE.x + 2.7, LAKE.z + 1.3, SEED),
      rideSteepnessAt(LAKE.x + 2.7, LAKE.z + 1.3, SEED),
      rideSteepnessAt(COL.x + 2.1, COL.z - 0.6, SEED),
    ];
    expect(probe()).toEqual(probe());
  });
});
