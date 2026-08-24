// Player report: walking the Gardenwalk (from Thornpeak Heights toward the
// Evergarden at Hedgewick, EVERGARDEN_ZONE.westPassZ 800) got stuck fighting
// a small, too-steep hill around x=173, z=797, just west of the zone border
// (STRIP_MAX_X 180). Root cause: applyGardenCoast's own Gardenwalk pass floor
// (world.ts, "the Gardenwalk: a flat floor easing onto the heights across
// the border") only reaches the east-column (Evergarden) side: its blend
// rides "seam", the coastal cross-fade into the strip, which is close to
// zero west of the border. So the peaks biome's full hill/crag/fine-detail
// noise (baseHeight) ran right up to the crossing on the Thornpeak side,
// unsmoothed. applyGardenwalkWestPass mirrors the SAME pass floor onto that
// side; it is a pure function of (x, z), so it changes no content table and
// cannot move roadDistance-driven calming, mob spawn RNG draw order, or any
// other system that reads ZONES/ROADS/CAMPS.

import { describe, expect, it } from 'vitest';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { terrainHeight, terrainSteepnessAt, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('the Gardenwalk: Thornpeak Heights to the Evergarden', () => {
  it('the reported spot at x=173, z=797 is not a small unclimbable hill', () => {
    // The exact repro coordinate. terrainSteepnessAt is the same true-gradient
    // reading the movement gate refuses a step on (player_motion.ts checks it
    // against PLAYER_MAX_CLIMB_SLOPE both for the standing cell and the ride).
    const offenders: string[] = [];
    for (let dx = -4; dx <= 4; dx += 2) {
      for (let dz = -4; dz <= 4; dz += 2) {
        const x = 173 + dx,
          z = 797 + dz;
        const steep = terrainSteepnessAt(x, z, WORLD_SEED);
        if (steep > PLAYER_MAX_CLIMB_SLOPE) offenders.push(`(${x},${z}) steep=${steep.toFixed(2)}`);
      }
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });

  it('is walkable on foot along the pass centerline (westPassZ 800), Thornpeak to Hedgewick', () => {
    // Mirrors the Windway crossing test in galecrest.test.ts: a straight
    // footstep-scale sweep across the whole border, well into both zones.
    let prev = terrainHeight(100, 800, WORLD_SEED);
    let maxSlope = 0;
    for (let x = 101; x <= 260; x++) {
      const h = terrainHeight(x, 800, WORLD_SEED);
      expect(h, `crossing at x=${x}`).toBeGreaterThan(WATER_LEVEL);
      maxSlope = Math.max(maxSlope, Math.abs(h - prev));
      prev = h;
    }
    expect(maxSlope).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
  });

  it('stays local: Thornpeak terrain away from the crossing keeps its natural relief', () => {
    // Well outside applyGardenwalkWestPass's z-band (|z-800|>52) and x-reach
    // (x<122): a future widening of the window has a regression signal here.
    // At z=700 (100yd from the pass center) the peaks biome runs at full
    // hill/crag amplitude, so the ground reads genuinely mountainous, not
    // pass-flattened toward the ~6 to 8 floor the corridor itself settles to.
    expect(terrainHeight(173, 700, WORLD_SEED)).toBeGreaterThan(15);
    expect(terrainHeight(173, 650, WORLD_SEED)).toBeGreaterThan(15);
  });
});
