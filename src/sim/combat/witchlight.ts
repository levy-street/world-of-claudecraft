// Witchlight (druid ability id `faerie_fire`, aura kind 'faerie_fire'): the
// ranged-and-spell mirror of Sunder Armor. Sunder Armor cuts the armor every
// physical hit reads; Witchlight leaves melee alone and instead:
//   - RANGED physical attacks (Auto Shot, and Hunter shots that scale with
//     Ranged Attack Power from range) treat the target's armor as
//     FAERIE_FIRE_ARMOR_PCT lower, on top of any Sunder Armor already applied;
//   - hits with NO armor step of their own (every non-physical school, plus
//     ranged physical channel bolts such as Fevered Draw) deal the extra damage
//     that same cut would give a physical hit on this target, read from its
//     base armor.
// So a target carrying both debuffs is softened for every attacker, and the
// two never cancel each other. Pure reads: no rng, no mutation; the armor read
// goes through ctx.effectiveArmor so ranged and melee can never split.

import type { SimContext } from '../sim_context';
import {
  type AbilityDef,
  armorReduction,
  type Entity,
  FAERIE_FIRE_ARMOR_PCT,
  MELEE_RANGE,
} from '../types';

export function hasWitchlight(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'faerie_fire');
}

// A Hunter shot fired from range: physical, scaled by Ranged Attack Power, and
// usable beyond melee range (point-blank Hunter tools such as Shrapnel Charge
// stay melee for Witchlight's purposes).
export function isRangedPhysicalAbility(def: AbilityDef | null | undefined): boolean {
  return (
    !!def && def.school === 'physical' && def.scalesWith === 'ranged' && def.range > MELEE_RANGE
  );
}

// The armor a ranged physical hit is mitigated by.
export function rangedArmorOf(ctx: Pick<SimContext, 'effectiveArmor'>, target: Entity): number {
  const armor = ctx.effectiveArmor(target);
  return hasWitchlight(target) ? armor * (1 - FAERIE_FIRE_ARMOR_PCT) : armor;
}

// The armor a physical ability hit reads: the ranged view for a ranged Hunter
// shot, the shared effective armor for everything else.
export function physicalHitArmor(
  ctx: SimContext,
  target: Entity,
  def: AbilityDef | null | undefined,
): number {
  return isRangedPhysicalAbility(def) ? rangedArmorOf(ctx, target) : ctx.effectiveArmor(target);
}

// Damage multiplier for a hit with no armor step (a spell, an armor-free ranged
// channel bolt) landing on a Witchlit target: the ratio a FAERIE_FIRE_ARMOR_PCT
// cut of the target's base armor makes in a physical hit's armor mitigation at
// the attacker's level. 1 without Witchlight or armor.
export function witchlightArmorlessDamageMult(attackerLevel: number, target: Entity): number {
  if (!hasWitchlight(target)) return 1;
  const armor = Math.max(0, target.stats.armor);
  if (armor <= 0) return 1;
  const before = 1 - armorReduction(armor, attackerLevel);
  const after = 1 - armorReduction(armor * (1 - FAERIE_FIRE_ARMOR_PCT), attackerLevel);
  return after / before;
}
