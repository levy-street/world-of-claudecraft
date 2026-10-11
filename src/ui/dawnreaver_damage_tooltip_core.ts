import type { ResolvedAbility } from '../sim/sim';
import type { AbilityEffect } from '../sim/types';
import { type AbilityScaling, abilityDamageBonus } from './ability_damage';

const ZERO_POWER: AbilityScaling = {
  spellPower: 0,
  healPower: 0,
  rangedPower: 0,
  attackPower: 0,
};

/** Complete noncritical hit before target mitigation, matching combat's last factor.
 * Authored/rank/talent damage and power are resolved before this multiplier. */
export function primaryDamageTooltipRange(
  res: ResolvedAbility,
  effect: AbilityEffect,
  scaling: AbilityScaling = ZERO_POWER,
): { min: number; max: number } | null {
  const factor = res.outputScaling?.primaryDamage ?? 1;
  if (effect.type !== 'directDamage' && effect.type !== 'aoeDamage') return null;
  const effectMult = effect.type === 'directDamage' ? (effect.damageMult ?? 1) : 1;
  const bonus = abilityDamageBonus(res, effect, scaling);
  return {
    min: Math.round((effect.min + bonus) * effectMult * factor),
    max: Math.round((effect.max + bonus) * effectMult * factor),
  };
}

/** Weapon power already rides the swing. Show a percentage and flat bonus so
 * the UI does not add Attack Power a second time or pretend to know mitigation. */
export function dawnreaverTooltipValues(res: ResolvedAbility, scaling?: AbilityScaling) {
  const factor = res.outputScaling?.primaryDamage ?? 1;
  const weapon = res.effects.find((effect) => effect.type === 'weaponStrike');
  const explosion =
    res.def.id === 'final_edict'
      ? res.effects.find((effect) => effect.type === 'aoeDamage')
      : undefined;
  const verdict = res.effects.find((effect) => effect.type === 'sunGodVerdict');
  return {
    weaponPercent: weapon ? (weapon.weaponMult ?? 1) * factor * 100 : undefined,
    explosion: explosion ? primaryDamageTooltipRange(res, explosion, scaling) : null,
    explosionRadius: explosion?.radius,
    explosionCap: explosion?.softCap,
    verdict: verdict
      ? {
          singleMin: Math.round(verdict.singleTargetMin * factor),
          singleMax: Math.round(verdict.singleTargetMax * factor),
          areaMin: Math.round(verdict.areaMin * factor),
          areaMax: Math.round(verdict.areaMax * factor),
          radius: verdict.areaRadius,
          cap: verdict.areaSoftCap,
        }
      : null,
  };
}
