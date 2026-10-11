// The built ferry harbors' static colliders, in one list for colliders.ts (built-in world
// only): the Wyrmwatch cliff harbor at the Drakelands berth (wyrmwatch_harbor.ts), then
// the Wickharbor ferry wharf (wickharbor_wharf.ts), then the rest of Wickharbor's wooden
// harbor (wickharbor_harbor.ts). Pure leaf, no SimContext, no rng.

import type { Collider } from './colliders';
import { wickharborHarborColliders } from './wickharbor_harbor';
import { wickharborWharfColliders } from './wickharbor_wharf';
import { wyrmwatchHarborColliders } from './wyrmwatch_harbor';

export function harborStructureColliders(seed: number): Collider[] {
  return [
    ...wyrmwatchHarborColliders(seed),
    ...wickharborWharfColliders(seed),
    ...wickharborHarborColliders(seed),
  ];
}
