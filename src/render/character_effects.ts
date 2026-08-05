import type { Entity } from '../sim/types';
import { abilityHexColor } from './ability_vfx_core';
import { ABILITY_VFX_FULL_SPECS } from './ability_vfx_full_specs';
import {
  CHARACTER_EFFECT_RECKLESSNESS,
  CHARACTER_EFFECT_SANGUINE,
  CHARACTER_EFFECT_SOUL_REND,
  characterEffectFlags,
  hasCharacterEffect,
} from './character_effects_core';

export function characterSoulRendActive(e: Entity): boolean {
  return hasCharacterEffect(characterEffectFlags(e.auras), CHARACTER_EFFECT_SOUL_REND);
}

export interface CharacterWeaponAura {
  color: number;
  /** true = the overlay scopes to the blade tip (buff.weaponAuraScope 'tip') */
  tip: boolean;
}

/** The held weapon's imbued-overlay color + scope, filled into the caller's
 *  scratch (allocation-free per frame), or null when no worn aura asks for
 *  one. Data-driven off the full spec's buff.weaponAura knob (aura id ==
 *  ability id, the painter's own matching rule): Sanguine Blade's blood soak,
 *  the shaman imbues (Pyrebrand/Rimebound), and the rogue poisons (Festering
 *  Venom's full-blade wash, Adder's Bite's green tip) all resolve here, and
 *  the overlay lives exactly as long as the aura - gained on cast, dropped
 *  with the buff. First worn match wins (weapon-imbue auras are exclusive in
 *  the sim, so concurrent winners cannot happen in practice). */
export function characterWeaponAuraInto(
  e: Entity,
  out: CharacterWeaponAura,
): CharacterWeaponAura | null {
  for (const a of e.auras) {
    const buff = ABILITY_VFX_FULL_SPECS[a.id]?.buff;
    const tint = buff?.weaponAura;
    if (tint !== undefined) {
      out.color = abilityHexColor(tint);
      out.tip = buff?.weaponAuraScope === 'tip';
      return out;
    }
  }
  return null;
}

/** Color-only projection of characterWeaponAuraInto (test/probe convenience). */
export function characterWeaponAuraColor(e: Entity): number | null {
  const scratch: CharacterWeaponAura = { color: 0, tip: false };
  return characterWeaponAuraInto(e, scratch)?.color ?? null;
}

export function characterSanguineAuraActive(e: Entity): boolean {
  return hasCharacterEffect(characterEffectFlags(e.auras), CHARACTER_EFFECT_SANGUINE);
}

export function characterRecklessnessActive(e: Entity): boolean {
  return hasCharacterEffect(characterEffectFlags(e.auras), CHARACTER_EFFECT_RECKLESSNESS);
}
