// Wickharbor's wooden harbor colliders (content/wickharbor_harbor.ts): the rails that
// line every drop off its boardwalk, piers, stairs and the Old Beacon dock, and the solid
// things standing on them (lantern posts, cargo). Its walkable decks are not here: they
// are ../gale_harbor.ts GALE_HARBOR_DECKS, which world.ts groundHeight walks.
//
// Built with the Wyrmwatch cliff harbor's own collider recipe (wyrmwatch_harbor.ts), like
// the ferry wharf beside it (wickharbor_wharf.ts): rails cut into short overlapping boxes
// that follow the planks under them, topped a rail height over their highest plank and seen
// through above the bottom rail; each prop seated on the planks under its centre.
//
// Pure leaf: deterministic, no SimContext, no rng. Joined to the static grid by
// colliders.ts through harbor_structures.ts (built-in world only), ungated.

import type { Collider } from './colliders';
import { WICKHARBOR_HARBOR_PROPS, WICKHARBOR_HARBOR_RAILS } from './content/wickharbor_harbor';
import { wyrmwatchPropCollider, wyrmwatchRailColliders } from './wyrmwatch_harbor';

/** Every collider of the harbor: the rails, then the props. */
export function wickharborHarborColliders(seed: number): Collider[] {
  const out: Collider[] = [];
  for (const rail of WICKHARBOR_HARBOR_RAILS) out.push(...wyrmwatchRailColliders(rail, seed));
  for (const prop of WICKHARBOR_HARBOR_PROPS) out.push(wyrmwatchPropCollider(prop, seed));
  return out;
}
