// Whether a spawn-placement probe (Sim.findSafePos) resolves as a body
// STANDING on the floor there instead of height-blind. A height-blind resolve
// walls every overhead slab (an upper storey, a roof, the eaves past a wall),
// so a spawn beside or inside such a building is shoved away from it. Authored
// maps stand every probe on its floor; the built-in world does so only where a
// walk-in town building stands its baked upper storeys and eaves
// (town_walk_in.ts), so every other built-in spawn resolves exactly as it
// always has. Pure leaf: no rng, no clock, no SimContext.

import { authoredMapActive } from './data';
import { nearTownWalkIn } from './town_walk_in';

export function spawnProbeStandsOnFloor(x: number, z: number): boolean {
  return authoredMapActive() || nearTownWalkIn(x, z);
}
