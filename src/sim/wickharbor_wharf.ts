// The Wickharbor ferry wharf's colliders (content/wickharbor_wharf.ts): the rails that
// line every drop off its pier, berth head, arm and flight, and the solid things standing
// on it (lantern posts, bollards, cargo). Its walkable decks are not here: they join the
// ferry pier surface query (ferry_piers.ts), so world.ts groundHeight walks them like any
// harbor planks.
//
// Built with the Wyrmwatch cliff harbor's own collider recipe (wyrmwatch_harbor.ts): rails
// cut into short overlapping boxes that follow the planks under them, topped a rail height
// over their highest plank and seen through above the bottom rail; each prop seated on the
// planks under its centre.
//
// Pure leaf: deterministic, no SimContext, no rng. Joined to the static grid by
// colliders.ts through harbor_structures.ts (built-in world only), ungated: the wharf
// stands whatever the ferry's timetable.

import type { Collider } from './colliders';
import { WICKHARBOR_WHARF_PROPS, WICKHARBOR_WHARF_RAILS } from './content/wickharbor_wharf';
import { wyrmwatchPropCollider, wyrmwatchRailColliders } from './wyrmwatch_harbor';

/** Every collider of the wharf: the rails, then the props. */
export function wickharborWharfColliders(seed: number): Collider[] {
  const out: Collider[] = [];
  for (const rail of WICKHARBOR_WHARF_RAILS) out.push(...wyrmwatchRailColliders(rail, seed));
  for (const prop of WICKHARBOR_WHARF_PROPS) out.push(wyrmwatchPropCollider(prop, seed));
  return out;
}
