// The authored structures that carry their own colliders, in one list for colliders.ts: the
// built ferry harbors (harbor_structures.ts, the built-in world or a copy of it), then the
// Mirefen tavern (mirefen_tavern.ts, the built-in world only). Pure leaf, no SimContext, no
// rng.

import type { Collider } from './colliders';
import { harborStructureColliders } from './harbor_structures';
import { mirefenTavernColliders } from './mirefen_tavern';

export function builtStructureColliders(seed: number, builtInWorld: boolean): Collider[] {
  const harbors = harborStructureColliders(seed);
  return builtInWorld ? [...harbors, ...mirefenTavernColliders(seed)] : harbors;
}
