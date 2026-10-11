// Wildfang reach: a feral druid's melee attacks land from one yard further out
// than everybody else's (v0.43 feral pass). The bonus is a property of the
// ATTACKER, not of the button, so it rides one pure predicate that the sim's
// range gates and the action bar's out-of-range tint both ask. Keeping the two
// on the same answer is the whole point: a slot the bar lights must be a slot
// the server will accept.
//
// Scope, stated literally: EVERY melee-reach attack a feral-spec druid makes,
// auto-attack and ability alike, in any form or none. "Melee reach" means an
// ability whose authored range is MELEE_RANGE or less (an authored 0 means
// "melee" and resolves to MELEE_RANGE). A ranged or gap-closing button keeps
// its authored range untouched: Lunge (25 yd) and Slinkstrike (8 yd) are
// deliberately NOT melee-reach attacks and gain nothing here.
import type { SimContext } from '../sim_context';
import type { Entity, PlayerClass } from '../types';
import { MELEE_RANGE } from '../types';

/** The extra melee reach a feral druid carries, in yards. */
export const FERAL_MELEE_REACH_BONUS = 1;

/** What the reach question needs to know about the attacker. Deliberately a
 *  plain pair rather than an Entity: the online action bar knows the committed
 *  class and spec without holding a sim entity. */
export interface MeleeReachActor {
  cls: PlayerClass | null;
  spec: string | null;
}

/** Is this attacker a committed feral druid? */
function isFeralDruid(actor: MeleeReachActor | null | undefined): boolean {
  return actor?.cls === 'druid' && actor.spec === 'feral';
}

/** Extra yards of reach for `actor` on an attack authored at `authoredRange`
 *  (0 meaning "melee"). Zero for everyone who is not a feral druid, and zero
 *  for any attack that is not melee-reach, so no other class or button moves. */
export function feralMeleeReachBonus(
  actor: MeleeReachActor | null | undefined,
  authoredRange: number,
): number {
  if (!isFeralDruid(actor)) return 0;
  const baseRange = authoredRange > 0 ? authoredRange : MELEE_RANGE;
  return baseRange <= MELEE_RANGE ? FERAL_MELEE_REACH_BONUS : 0;
}

/** The reach actor for a sim entity: the committed class and spec a player
 *  entity resolves to, or null for a mob (and for a player the context has no
 *  meta for). Type-only on SimContext, so the pure predicates above stay
 *  importable from the client bundle. */
export function meleeReachActor(ctx: SimContext, attacker: Entity): MeleeReachActor | null {
  if (attacker.kind !== 'player') return null;
  const meta = ctx.players.get(attacker.id);
  if (!meta) return null;
  return { cls: meta.cls, spec: ctx.playerMods(meta).spec };
}
