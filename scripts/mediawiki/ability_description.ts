// A static wiki has no current character's Ranged Attack Power. Keep Bear Trap's
// live tooltip placeholder in game, but label its zero-power reference total in
// the article and explain the same per-tick rounding that combat uses.
import { hunterTrapBleedAmounts } from '../../src/sim/combat/hunter_trap_bleed';
import type { AbilityDef } from '../../src/sim/types';

export function mediawikiAbilityDescription(ability: AbilityDef): string {
  if (ability.id !== 'bear_trap') return ability.description;
  const effect = ability.effects.find((candidate) => candidate.type === 'hunterBearTrap');
  if (!effect) throw new Error('Bear Trap wiki description requires its bleed effect');
  const { total, ticks } = hunterTrapBleedAmounts({
    total: effect.bleedTotal,
    duration: effect.bleedDuration,
    interval: effect.bleedInterval,
  });
  return (
    ability.description.replace(
      'bleeds for $d Physical damage',
      `bleeds for ${total} Physical damage at zero Ranged Attack Power`,
    ) +
    ` The bleed deals damage ${ticks} times, once every ${effect.bleedInterval} sec; each tick is rounded to a whole number.`
  );
}
