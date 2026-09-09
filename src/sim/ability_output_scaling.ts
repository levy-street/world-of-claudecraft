// Presentation metadata for the same base-plus-power math combat uses.
import { DIRGE_ABILITY_ID } from './combat/priest/dirge_refresh';
import { VESPERS_DOT_DAMAGE_MULT } from './combat/priest/vespers';
import type { TalentModifiers } from './content/talents';
import { primaryHealingMultiplier } from './spec_output_tuning';
import { resolveTalentHitMult } from './talent_hit_mult';
import type { AbilityDef, PlayerClass } from './types';

export interface AbilityOutputScaling {
  /** Direct damage power rider. */
  damage: number;
  /** Direct healing power rider. */
  healing: number;
  /** Damage-over-time power rider, including the Vespers Dirge correction. */
  dot: number;
  /** Healing-over-time power rider. */
  hot: number;
  /** Shield power rider. */
  absorb: number;
  /** Complete primary-heal factor; excludes fixed-HP utility and shields. */
  primaryHealing: number;
}

export function buildAbilityOutputScaling(
  ability: AbilityDef,
  cls: PlayerClass | null,
  mods: TalentModifiers,
): AbilityOutputScaling {
  const hit = resolveTalentHitMult(ability, mods);
  const vespersDirgeSp =
    ability.id === DIRGE_ABILITY_ID && cls === 'priest' && mods.spec === 'shadow'
      ? VESPERS_DOT_DAMAGE_MULT
      : 1;
  return {
    damage: hit.dmgMult,
    healing: hit.healMult,
    dot: hit.dmgMult * (1 + mods.global.dotDmgPct) * vespersDirgeSp,
    hot: hit.healMult * (1 + mods.global.hotHealPct),
    absorb: hit.healMult * (1 + mods.global.absorbPct),
    primaryHealing: cls ? primaryHealingMultiplier(cls, mods.spec) : 1,
  };
}
