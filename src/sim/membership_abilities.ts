import type { KnownAbility } from './content/classes';
import { COURIER_ABILITY } from './content/courier';

/** One class-independent entitlement grant, shared by both ability presentations. */
export function membershipAbilities(known: KnownAbility[], active: boolean): KnownAbility[] {
  const result = known.filter((ability) => ability.def.id !== COURIER_ABILITY.id);
  if (active)
    result.push({
      def: COURIER_ABILITY,
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
      effects: [],
      threatFlat: 0,
      threatMult: 1,
    });
  return result;
}
