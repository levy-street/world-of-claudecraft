import { describe, expect, it } from 'vitest';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../src/sim/data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { terrainSteepnessAt, terrainWallStandoff, terrainWallStandoffPass } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// terrainWallStandoff pushes a player's body off nearby steep terrain in a
// single ring-sample-and-nudge pass, capped at one body radius. In a CONCAVE
// pocket (two walls meeting, most reliably reproduced at this world's rim
// corners, where the x-rim and z-rim walls press in from two directions at
// once) a single pass is not always enough to clear the wall, and the caller
// (stepPlayerMotion) only ever committed the pushed position once it read as
// fully walkable, so an unconverged single pass silently discarded every
// partial improvement. This is defensive hardening: on THIS world's simpler
// terrain the downhill-slide fallback (terrainDownhill in stepPlayerMotion)
// happens to always have a valid escape gradient wherever standoff alone
// would fall short, so the practical "permanently wedged" symptom isn't
// reproducible here today. This file pins the property that actually matters
// everywhere: iterating the standoff push converges strictly further than a
// single pass in a genuine concave pocket, and never regresses an
// already-fine position.
const SEED = WORLD_SEED; // the one shipped world seed (src/sim/world_seed.ts)
const R = PLAYER_BODY_RADIUS;
const SLOPE = PLAYER_MAX_CLIMB_SLOPE;

// A single ring-sample-and-nudge pass (the pre-fix behavior). Uses the real
// production helper (exported from world.ts for this purpose) rather than a
// hand copy, so this "never worse than a single pass" sweep cannot silently
// drift from production if the pass logic changes.
function singlePass(x: number, z: number): { x: number; z: number } {
  return terrainWallStandoffPass(x, z, SEED, R, SLOPE);
}

// A band of probe points near each of the playable rectangle's four
// corners, where the x-rim and z-rim walls press in from two directions at
// once: a reliable genuinely concave pocket on this world, used below as a
// generic no-regression net. PIN itself is a separate exact point (found by
// a full-world sweep, not necessarily near a rim corner) that reproduces a
// large single-pass shortfall that iteration closes; this world's terrain
// generation is content-driven and shifts pockets around, so this pin is
// re-derived whenever terrain content changes invalidate the previous one.
const PIN = { x: -232, z: 452 }; // steepOnce ~4.59, steepIterated ~0.02 at SEED 20061 (re-derived: the prior pocket was a Great Maze terrain wall corner, and the maze walls are modeled now, its lawn flat)
const CORNER_ORIGINS = [
  { x: WORLD_MAX_X, z: WORLD_MIN_Z, sx: -1, sz: 1 },
  { x: WORLD_MAX_X, z: WORLD_MAX_Z, sx: -1, sz: -1 },
  { x: -WORLD_MAX_X, z: WORLD_MIN_Z, sx: 1, sz: 1 },
  { x: -WORLD_MAX_X, z: WORLD_MAX_Z, sx: 1, sz: -1 },
] as const;

describe('terrainWallStandoff converges further than a single pass in concave corners', () => {
  it('closes a large single-pass shortfall at a known concave pocket', () => {
    const once = singlePass(PIN.x, PIN.z);
    const steepOnce = terrainSteepnessAt(once.x, once.z, SEED);
    const iterated = terrainWallStandoff(PIN.x, PIN.z, SEED, R, SLOPE);
    const steepIterated = terrainSteepnessAt(iterated.x, iterated.z, SEED);
    // Independent pins on both readings (not a self-comparison). steepOnce is
    // effectively the UNMOVED starting steepness here: terrainSteepnessAt
    // rounds to 1-yard cells and the single pass's push does not leave that
    // cell in this pocket, so the value below (~3.66, about 2.4x the ~1.5
    // climb limit) pins "a single pass makes no meaningful progress," not
    // what one pass alone converges to in general. Iteration brings the
    // reading under the climb limit.
    expect(steepOnce).toBeGreaterThan(3.5);
    expect(steepIterated).toBeLessThan(SLOPE);
  });

  it('never leaves the player steeper than a single pass alone, anywhere near the four corners', () => {
    for (const c of CORNER_ORIGINS) {
      for (let dx = 0; dx <= 6; dx += 1) {
        for (let dz = 0; dz <= 6; dz += 1) {
          const x = c.x + c.sx * dx;
          const z = c.z + c.sz * dz;
          const once = singlePass(x, z);
          const steepOnce = terrainSteepnessAt(once.x, once.z, SEED);
          const iterated = terrainWallStandoff(x, z, SEED, R, SLOPE);
          const steepIterated = terrainSteepnessAt(iterated.x, iterated.z, SEED);
          expect(steepIterated, `(${x},${z})`).toBeLessThanOrEqual(steepOnce + 1e-9);
        }
      }
    }
  });

  it('is idempotent once converged (re-running standoff on the resolved point is a no-op)', () => {
    const once = terrainWallStandoff(PIN.x, PIN.z, SEED, R, SLOPE);
    const twice = terrainWallStandoff(once.x, once.z, SEED, R, SLOPE);
    expect(twice.x).toBeCloseTo(once.x, 6);
    expect(twice.z).toBeCloseTo(once.z, 6);
  });

  it('is a no-op on open, walkable ground', () => {
    const open = terrainWallStandoff(0, 0, SEED, R, SLOPE);
    expect(open.x).toBe(0);
    expect(open.z).toBe(0);
  });
});
