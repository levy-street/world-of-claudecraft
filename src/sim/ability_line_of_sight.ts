// Which abilities must respect line of sight, extracted from the Sim
// coordinator as a pure rule (no sim state: an ability record and the caster).
import { isArenaPos } from './data';
import { type AbilityDef, type Entity, MELEE_RANGE } from './types';

/** Does `ability` need a clear line to its target? Ranged and every non-physical
 *  school always do. Melee/auto-attack skips line of sight everywhere else (it is
 *  always at point-blank range), but the arena's thin enclosing walls sit well
 *  within MELEE_RANGE: without this, a combatant pressed against a wall can swing
 *  through it at an opponent on the far side. Ranked fairness requires every
 *  attack to respect the same walls movement does inside the pit. */
export function abilityNeedsLineOfSight(ability: AbilityDef, source?: Entity): boolean {
  if (!ability.requiresTarget) return false;
  if (ability.school !== 'physical' || ability.range > MELEE_RANGE) return true;
  return source !== undefined && isArenaPos(source.pos.x);
}
