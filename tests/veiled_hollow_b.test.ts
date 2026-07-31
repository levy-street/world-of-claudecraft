// The Veiled Hollow, shard b: the sealed border ridge walked southward (the
// way back out without the portal). See tests/veiled_hollow_shared.ts; the
// northward scan lives in veiled_hollow_a, the live-sim movement wall and
// coastline in veiled_hollow.test.ts.

import { describe, expect, it } from 'vitest';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { terrainHeight } from '../src/sim/world';
import { SEED } from './veiled_hollow_shared';

describe('the sealed border wall', () => {
  // Same, walking south (the way back out without the portal).
  function maxSouthGradient(x: number, seed: number): number {
    const step = 0.5;
    let steepest = 0;
    // terrainHeight is pure and seeded, so the sample at z - step is carried
    // into the next iteration instead of being recomputed: bit-identical rises
    // at half the terrain calls.
    let prev = terrainHeight(x, 955, seed);
    for (let z = 955; z > 880; z -= step) {
      const next = terrainHeight(x, z - step, seed);
      const rise = next - prev;
      prev = next;
      if (rise / step > steepest) steepest = rise / step;
    }
    return steepest;
  }

  it('blocks a straight walk back out at every x (several seeds)', () => {
    for (const seed of [SEED, 1, 42, 99999]) {
      for (let x = -170; x <= 170; x += 1) {
        expect(maxSouthGradient(x, seed), `x=${x} seed=${seed}`).toBeGreaterThan(
          PLAYER_MAX_CLIMB_SLOPE,
        );
      }
    }
  });
});
