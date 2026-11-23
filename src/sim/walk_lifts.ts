// The overworld's walkable lift fields, summed in one place: raised
// WALKABLE ground (stair flights, wall walks, plank helixes) that lives in
// groundHeight, NOT terrainHeight, so the render's terrain baseline is
// unchanged and the authored geometry (the Beacon's planks, Dawnhold's
// walls, the Forgefather staircase props) is what the eye sees while the
// lift is what the feet climb. The additive fields raise the local
// terrain by their own delta; the Forgefather stair ramps carry an
// ABSOLUTE surface (the ramp under each placed staircase), so they fold
// in as a max rather than an addition; so does the Moon Stair at the Drowned
// Temple's door (drowned_temple_stair.ts), a built flight over a gully, and so
// does the Mirefen tavern's floor (its ground floor, hearth pit, bar platform,
// stair and upper floor, mirefen_tavern_floor.ts).
// Extracted from groundHeight under the world.ts monolith ratchet. Pure
// leaf: deterministic, no rng.
import { beaconSpiralLift } from './beacon_spiral';
import { forgefatherStairSurface } from './content/ember_coast';
import { overworldTerrainPadsActive } from './data';
import { dawnholdLift } from './dawnhold_layout';
import { drownedTempleStairSurface } from './drowned_temple_stair';
import { mirefenTavernSurface } from './mirefen_tavern_floor';

// (The glider flight tower's deck used to fold in here as an absolute surface;
// the launch now uses the existing mountain and a plank wharf on the
// deck_surfaces.ts arm, like the harbor piers.)
export function overworldWalkSurface(x: number, z: number, terrain: number, seed: number): number {
  // The lifts stand at shipped-world coordinates: on an authored map they would
  // be invisible walls and stairs over the maker's own ground.
  if (!overworldTerrainPadsActive()) return terrain;
  const lifted = terrain + beaconSpiralLift(x, z) + dawnholdLift(x, z);
  return Math.max(
    lifted,
    forgefatherStairSurface(x, z),
    drownedTempleStairSurface(x, z, seed),
    mirefenTavernSurface(x, z),
  );
}
