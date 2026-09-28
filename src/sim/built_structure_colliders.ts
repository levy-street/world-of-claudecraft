// The built-in world's authored structures that carry their own colliders, in one list for
// colliders.ts (built-in world only): the built ferry harbors (harbor_structures.ts), then
// the Mirefen tavern (mirefen_tavern.ts). Pure leaf, no SimContext, no rng.

import type { Collider } from './colliders';
import { harborStructureColliders } from './harbor_structures';
import { mirefenTavernColliders } from './mirefen_tavern';

export function builtStructureColliders(seed: number): Collider[] {
  return [...harborStructureColliders(seed), ...mirefenTavernColliders(seed)];
}
