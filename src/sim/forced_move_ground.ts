// The ground a body rests on while a FORCED move carries it (a warrior
// charge, /follow, a knockback shove). Those paths do not run the physics
// kernel, so they read the ground height directly at every step.
//
// On an authored map that is groundHeightNear: the cave tube or carve cavity
// sheet the body is on, plus any standable collider top within a step, so a
// charge along a tunnel stays in the tunnel and a shove across a deck stays on
// the deck. The built-in world (and any plain variant of it) keeps the height-blind groundHeight it has
// always used, so its forced movement (and every replay pinned on it) is
// unchanged by the Studio map runtime.

import { authoredMapActive } from './data';
import { groundHeight, groundHeightNear } from './world';

export function forcedMoveGroundHeight(x: number, z: number, seed: number, prevY: number): number {
  return authoredMapActive() ? groundHeightNear(x, z, seed, prevY) : groundHeight(x, z, seed);
}
