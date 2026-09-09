// Which direct heal the hub's optional healing lesson points a player at, if
// any, on the model of tutorial/starting_attack.ts: DERIVED from the live
// class kit rather than written down and left to drift. A kit edit (a new
// level-1 heal, a learnLevel move) changes what the lesson offers in the
// same breath, and the ability it names is always one the player can press
// right now, never one that needs a respec to reach.
//
// Restricted to the four classes whose base kit carries a genuine direct
// heal: druid, shaman, paladin, priest (content/practice_dummies.ts
// HUB_HEALING_ELIGIBLE_CLASSES is the single source of truth for the list,
// imported from there since content/ is data and this is its consumer). A
// mage never qualifies, even a build leaning on a support tool: none of its
// kit is a friendly-target restore-health press, and the design intent is
// explicit that mage never teaches this lesson regardless of spec.
//
// Pure sim: no DOM, no Three, no rng, no wall clock.

import { abilitiesKnownAt } from '../content/classes';
import { HUB_HEALING_ELIGIBLE_CLASSES } from '../content/practice_dummies';
import type { PlayerClass } from '../types';

export { HUB_HEALING_ELIGIBLE_CLASSES };

/**
 * The direct heal a player of this class can actually press right now, or
 * null when the class does not teach this lesson (not one of the four
 * eligible classes) or has not learned a direct heal yet at this level.
 *
 * "Direct" means a friendly-target ability with an immediate `heal` effect:
 * a HoT-only spell (Renew, Rejuvenation) does not qualify, since the lesson
 * is about a press whose result reads on the meter as one cast, not a
 * ticking buff. When more than one qualifies (a class's kit gains a second
 * direct heal later), the earliest-learned one wins: the fundamental heal,
 * not whichever the kit array happens to list first.
 */
export function hubHealingAbilityId(playerClass: PlayerClass, level: number): string | null {
  if (!HUB_HEALING_ELIGIBLE_CLASSES.includes(playerClass)) return null;
  const heals = abilitiesKnownAt(playerClass, level).filter(
    (k) => k.def.targetType === 'friendly' && k.effects.some((e) => e.type === 'heal'),
  );
  if (heals.length === 0) return null;
  return heals.reduce((a, b) => (b.def.learnLevel < a.def.learnLevel ? b : a)).def.id;
}
