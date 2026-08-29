// The foliage passes' shore skip, gated on water actually being there.
//
// The grass, flower, meadow, and parterre passes all refuse anchors inside the
// beach band, and that refusal was a pure HEIGHT test (h < WATER_LEVEL +
// SHORE_BAND_HEIGHT), the same rule that painted the Wolf Run basin as sand:
// dry inland ground at beach elevation lost its cover along with its color.
// This core asks shore_water_gate_core the question both terrain tiers ask:
// underwater anchors always skip; band-height anchors skip only where the
// gate says water is actually near, so real strands stay bare and the dry
// basin grows over.
//
// PURE and deterministic (no Three, no DOM), like the gate it wraps. The
// probe samples raw terrainHeight because that is the surface foliage seats
// anchors on (foliage.ts samples the same function for every anchor height).

import { terrainHeight, WATER_LEVEL } from '../sim/world';
import {
  makeShoreProbe,
  SHORE_BAND_HEIGHT,
  type ShoreProbe,
  shoreWaterGate,
} from './shore_water_gate_core';

// One shore-band probe per seed, reused across chunk builds (both terrain
// tiers keep the same pair): its memo is what keeps the ring sampling
// affordable. Reset on a seed change because the memo is keyed on position
// alone.
let shoreProbeSeed = Number.NaN;
let shoreProbe = makeShoreProbe(() => 0);
function shoreProbeFor(seed: number): ShoreProbe {
  if (seed !== shoreProbeSeed) {
    shoreProbeSeed = seed;
    shoreProbe = makeShoreProbe((x, z) => terrainHeight(x, z, seed));
  }
  return shoreProbe;
}

/** Whether a foliage anchor at (x, z) with sampled height `h` sits on ground
 *  the shore owns: underwater always, band-height ground only where the gate
 *  finds water nearby. */
export function foliageShoreSkip(x: number, z: number, h: number, seed: number): boolean {
  if (h < WATER_LEVEL) return true;
  if (h >= WATER_LEVEL + SHORE_BAND_HEIGHT) return false;
  return shoreWaterGate(x, z, h, WATER_LEVEL, shoreProbeFor(seed)) > 0;
}
