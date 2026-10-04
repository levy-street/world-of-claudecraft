// A player who takes over a creature's identity (the Graveyard Shift's Morthen)
// renders as that creature: its rig, its clips, its own colour, nothing of the
// player's authored body. The rule reads only the entity's auras, so it holds on
// every host that mirrors them (the Sim offline, the snapshot online).
//
// Precedence over the Combat Mech and the authored look: the identity is a whole
// replacement body, exactly like the mech, and it wins over the mech because the
// player is not themselves for the length of the run.

import { MOBS } from '../../sim/data';
import { hasMorthenIdentity } from '../../sim/graveyard_shift/morthen_identity';
import { MORTHEN_TEMPLATE_ID } from '../../sim/graveyard_shift/morthen_profile';
import type { Entity } from '../../sim/types';

type IdentityFacts = Pick<Entity, 'kind' | 'auras'>;

/** The mob template whose body this entity wears in place of its own, or null. */
export function identityBodyTemplateFor(e: IdentityFacts): string | null {
  if (e.kind !== 'player') return null;
  return hasMorthenIdentity(e) ? MORTHEN_TEMPLATE_ID : null;
}

/** The tint an identity body is drawn with: the creature template's own colour
 *  (the value a spawned copy of it carries), never the player's class colour. */
export function identityBodyColorFor(templateId: string, fallback: number): number {
  return MOBS[templateId]?.color ?? fallback;
}
