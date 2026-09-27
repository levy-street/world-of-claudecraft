// The overworld's walkable lift fields, summed in one place: raised
// WALKABLE ground (stair flights, wall walks, plank helixes) that lives in
// groundHeight, NOT terrainHeight, so the render's terrain baseline is
// unchanged and the authored geometry (the Beacon's planks, Dawnhold's
// walls, the Forgefather staircase props) is what the eye sees while the
// lift is what the feet climb. The additive fields raise the local
// terrain by their own delta; the Forgefather stair ramps carry an
// ABSOLUTE surface (the ramp under each placed staircase), so they fold
// in as a max rather than an addition. Extracted from groundHeight under
// the world.ts monolith ratchet. Pure leaf: deterministic, no rng.
import { beaconSpiralLift } from './beacon_spiral';
import { forgefatherStairSurface } from './content/ember_coast';
import { dawnholdLift } from './dawnhold_layout';

// (The glider flight tower's deck used to fold in here as an absolute surface;
// the launch now uses the existing mountain and a plank wharf on the
// deck_surfaces.ts arm, like the harbor piers.)
export function overworldWalkSurface(x: number, z: number, terrain: number): number {
  const lifted = terrain + beaconSpiralLift(x, z) + dawnholdLift(x, z);
  return Math.max(lifted, forgefatherStairSurface(x, z));
}
