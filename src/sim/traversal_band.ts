// The traversal band: the one height that is at once the grounded stride
// (physics/character.ts MAX_STEP_HEIGHT), the airborne mantle assist
// (colliders.ts MANTLE_REACH) and the lowest ledge grab (physics/ledge.ts
// LEDGE_GRAB_MIN). All three must move together or the ladder gaps.
//
// The built-in world (and any plain variant of it) keeps the release's 0.9. The Studio fork raised the band
// to 1.0 for its authored maps (a galleon deck fitting stood 0.93
// above the deck plane and became an unclimbable kerb), so an authored map
// gets 1.0 (data.ts authoredMapActive). Pure leaf: one flag read, no rng.

import { authoredMapActive } from './data';

/** The release band, and the value of the three exported constants. */
export const BUILTIN_TRAVERSAL_BAND = 0.9;
/** The Studio band, read while an authored map is the active content. */
export const AUTHORED_TRAVERSAL_BAND = 1.0;

/** The stride / mantle / ledge-grab height for the active content. */
export function traversalBand(): number {
  return authoredMapActive() ? AUTHORED_TRAVERSAL_BAND : BUILTIN_TRAVERSAL_BAND;
}
