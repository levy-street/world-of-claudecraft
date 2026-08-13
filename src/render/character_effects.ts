import { isBgPos } from '../sim/data';
import {
  BATTLE_RUNE_AURA_ID,
  RUNE_VISUALS,
  SPRINT_RUNE_AURA_ID,
  WARD_RUNE_AURA_ID,
} from '../sim/social/battleground';
import type { Aura, Entity } from '../sim/types';
import { abilityHexColor } from './ability_vfx_core';
import { ABILITY_VFX_FULL_SPECS } from './ability_vfx_full_specs';
import {
  CHARACTER_EFFECT_RECKLESSNESS,
  CHARACTER_EFFECT_SANGUINE,
  CHARACTER_EFFECT_SOUL_REND,
  characterEffectFlags,
  hasCharacterEffect,
} from './character_effects_core';

export function isAvengingWrathAura(aura: Pick<Aura, 'id' | 'kind'>): boolean {
  return aura.id === 'avenging_wrath' && aura.kind === 'buff_dmg_done';
}

export function isPaladinWingAura(aura: Pick<Aura, 'id' | 'kind'>): boolean {
  return (
    isAvengingWrathAura(aura) ||
    ((aura.id === 'guardian_covenant' || aura.id === 'life_covenant') && aura.kind === 'buff_dr')
  );
}

export function characterAvengingWrathActive(e: Entity): boolean {
  return !e.dead && e.templateId === 'paladin' && e.auras.some(isAvengingWrathAura);
}

export function characterPaladinWingsActive(e: Entity): boolean {
  return !e.dead && e.auras.some(isPaladinWingAura);
}

export function isOathChainAura(aura: Pick<Aura, 'id' | 'kind'>): boolean {
  return (
    (aura.id === 'oath_chain_pull' && aura.kind === 'forced_move') ||
    (aura.id === 'oath_chain_slow' && aura.kind === 'slow')
  );
}

export type CharacterWeaponAuraMode = 'none' | 'sanguine' | 'stonebound';

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

/** Stable structural weapon/body presentation. Stonebound wins if an unrelated
 * Sanguine effect overlaps, because its posture must remain readable. */
export function characterWeaponAuraMode(e: Entity): CharacterWeaponAuraMode {
  if (
    e.auras.some((aura) => aura.id === 'rockbiter_weapon' || aura.id === 'shaman_stonebound_armor')
  ) {
    return 'stonebound';
  }
  return characterSanguineAuraActive(e) ? 'sanguine' : 'none';
}

export function characterRecklessnessActive(e: Entity): boolean {
  return hasCharacterEffect(characterEffectFlags(e.auras), CHARACTER_EFFECT_RECKLESSNESS);
}

/**
 * Pack Ferocity is authoritative on the Hunter. The pet only derives a visual
 * stage from its current owner, so growth cannot alter collision or persistence.
 */
export function hunterPetFerocityStage(pet: Entity, owner: Entity | null): 0 | 1 | 2 | 3 {
  if (pet.dead || pet.ownerId === null || owner?.id !== pet.ownerId) return 0;
  const aura = owner.auras.find((candidate) => candidate.kind === 'hunter_ferocity');
  const raw = aura?.stacks ?? aura?.value ?? 0;
  return Math.min(3, Math.max(0, Math.trunc(raw))) as 0 | 1 | 2 | 3;
}

export function hunterPetFrenzyActive(pet: Entity, owner: Entity | null): boolean {
  return (
    !pet.dead &&
    pet.ownerId !== null &&
    owner?.id === pet.ownerId &&
    owner.auras.some((candidate) => candidate.kind === 'hunter_frenzy')
  );
}

export function hunterPetVisualScale(stage: number, frenzy: boolean): number {
  if (frenzy) return 1.1;
  if (stage >= 3) return 1.12;
  if (stage === 2) return 1.08;
  if (stage === 1) return 1.04;
  return 1;
}

/** A five-stack Tithefiend is authored above normal creature scale. */
export function tithefiendEmpoweredActive(entity: Entity): boolean {
  return !entity.dead && entity.templateId === 'guardian_tithefiend' && entity.scale > 1;
}

export type CharacterVeilboundState = 'none' | 'march' | 'mark';

export function characterVeilboundState(e: Entity): CharacterVeilboundState {
  if (e.auras.some((a) => a.id === 'veilbound_march')) return 'march';
  if (e.auras.some((a) => a.id === 'veilbound_mark')) return 'mark';
  return 'none';
}

/** The whole-body tint color for an active Thornhollow Fields rune buff (null = none). */
export function characterRuneTintColor(e: Entity): number | null {
  // Rune pads exist only on the Thornhollow field, so the open world (where
  // this runs for every character in view, every frame) settles on one band
  // check instead of walking each character's aura list.
  if (!isBgPos(e.pos.x)) return null;
  for (const a of e.auras) {
    if (a.id === SPRINT_RUNE_AURA_ID) return RUNE_VISUALS.sprint.color;
    if (a.id === BATTLE_RUNE_AURA_ID) return RUNE_VISUALS.damage.color;
    if (a.id === WARD_RUNE_AURA_ID) return RUNE_VISUALS.defense.color;
  }
  return null;
}
