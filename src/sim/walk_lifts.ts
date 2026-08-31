// The overworld's walkable lift fields, summed in one place: raised
// WALKABLE ground (stair flights, wall walks, plank helixes) that lives in
// groundHeight, NOT terrainHeight, so the render's terrain baseline is
// unchanged and the authored geometry (the Beacon's planks, the Last
// Keep's walls, the Forgefather staircase props) is what the eye sees
// while the lift is what the feet climb. The additive fields raise the
// local terrain by their own delta; the Forgefather stair ramps carry an
// ABSOLUTE surface (the ramp under each placed staircase), so they fold
// in as a max rather than an addition. Extracted from groundHeight under
// the world.ts monolith ratchet. Pure leaf: deterministic, no rng.
import { beaconSpiralLift } from './beacon_spiral';
import { bulwarkLift } from './bulwark_layout';
import { castleLift } from './castle_layout';
import { forgefatherStairSurface } from './content/ember_coast';
import { dawnholdLift } from './dawnhold_layout';

export function overworldWalkSurface(x: number, z: number, terrain: number): number {
  const lifted =
    terrain + beaconSpiralLift(x, z) + castleLift(x, z) + dawnholdLift(x, z) + bulwarkLift(x, z);
  return Math.max(lifted, forgefatherStairSurface(x, z));
}
