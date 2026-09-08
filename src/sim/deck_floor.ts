// The floor an authored body rests on in the open world: the terrain (stair
// ramps already folded in) or a walkable deck close above it, such as the
// Forgefather's Isle fortress floor plates that stand DECK_FLOOR_REACH or less
// over their court ground. groundHeight alone seats a body on such a court a
// hand's width inside the plate, where the collider query reads it as trapped
// in a prop; the deck top is where feet actually ride.
//
// placementFloorHeight (colliders.ts) is the same idea scoped to the
// battleground band; this helper is for a spawn that KNOWS it stands on a
// deck, so the general placement path keeps its terrain-only contract.
import { DECK_FLOOR_REACH, supportHeightAt } from './colliders';
import { groundHeight } from './world';

const DECK_BODY_RADIUS = 0.5;

export function deckFloorHeight(seed: number, x: number, z: number): number {
  const ground = groundHeight(x, z, seed);
  return Math.max(ground, supportHeightAt(seed, x, z, DECK_BODY_RADIUS, ground + DECK_FLOOR_REACH));
}
