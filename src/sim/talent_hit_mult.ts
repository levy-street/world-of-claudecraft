// The one place that resolves a talent/mastery percent bonus (global
// meleeDmgPct / spellDmgPct / healPct, plus a per-ability dmgPct like Frost's
// +25%) into the multiplier that applies to ONE ability's whole hit.
//
// `content/classes.ts` (`applyTalentMods`) calls this to bake the multiplier
// into an ability's authored base magnitudes at precompute time, same as
// before. Combat sites (`combat/effect_dispatch.ts`, `combat/casting_lifecycle.ts`,
// `combat/auto_attack.ts`) call the SAME function to scale the runtime SP/AP/
// weapon rider a resolved ability adds on top (`spell_scaling.ts`,
// `effectiveAttackPower`, `meleeSwing`'s weapon+AP roll) by the identical
// number, so the advertised percentage reaches the whole hit instead of only
// the authored base (issue: mastery/talent damage percent under-delivered at
// high gear because the SP/AP portion of a hit was never multiplied).
//
// Pure: reads only an AbilityDef and the player's precomputed TalentModifiers,
// no Sim/SimContext/rng. A Vitest imports it directly.

import type { TalentModifiers } from './content/talents';
import type { AbilityDef } from './types';

export interface TalentHitMult {
  // The base multiplier for one-shot damage (directDamage/aoeDamage/
  // chainDamage/weaponDamage/finisherDamage/aoeRoot/consumeAura's deal).
  dmgMult: number;
  // The base multiplier for healing (heal/chainHeal/aoeHeal/consumeAura's heal).
  healMult: number;
}

// Mirrors the physical/ranged school split `applyTalentMods` uses to pick
// between the melee and spell global buckets: hunter ranged shots
// (`scalesWith: 'ranged'`) always take the melee bucket regardless of school,
// so Marksmanship's Iron Aim ("ranged ability damage") reaches Arcane Shot.
export function resolveTalentHitMult(ability: AbilityDef, mods: TalentModifiers): TalentHitMult {
  const am = mods.abilities[ability.id];
  const physical = ability.school === 'physical' || ability.scalesWith === 'ranged';
  const globalDmg = physical ? mods.global.meleeDmgPct : mods.global.spellDmgPct;
  return {
    dmgMult: 1 + globalDmg + (am?.dmgPct ?? 0),
    healMult: 1 + mods.global.healPct + (am?.dmgPct ?? 0),
  };
}
