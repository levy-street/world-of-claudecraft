import { GOURDLIGHT_TRICKS } from '../sim/content/gourdlight_eve';
import { NYTHRAXIS_IMPALED_AURA_ID } from '../sim/nythraxis_bone_spike';

export const CHARACTER_EFFECT_SOUL_REND = 1 << 0;
export const CHARACTER_EFFECT_SANGUINE = 1 << 1;
export const CHARACTER_EFFECT_RECKLESSNESS = 1 << 2;
/** Pinned to a Nythraxis Bone Spike: the living body drapes the death pose
 *  (plays its death clip and holds the last frame) until the aura clears. */
export const CHARACTER_EFFECT_IMPALED = 1 << 3;
/** A Gourdlight Eve trick (seasonal/): wreathed in green fumes for a few seconds. */
export const CHARACTER_EFFECT_SEASONAL_FUMES = 1 << 4;
const SEASONAL_FUMES_AURA_ID: string = GOURDLIGHT_TRICKS[2].id;

export interface CharacterEffectAura {
  id: string;
  kind: string;
}

export function addCharacterEffectAura(flags: number, aura: CharacterEffectAura): number {
  let next = flags;
  if (aura.id === 'nythraxis_soul_rend') next |= CHARACTER_EFFECT_SOUL_REND;
  if (aura.id === NYTHRAXIS_IMPALED_AURA_ID) next |= CHARACTER_EFFECT_IMPALED;
  if (aura.id === 'sanguine_aura') next |= CHARACTER_EFFECT_SANGUINE;
  if (aura.kind === 'buff_reckless') next |= CHARACTER_EFFECT_RECKLESSNESS;
  if (aura.kind === 'seasonal_cosmetic' && aura.id === SEASONAL_FUMES_AURA_ID)
    next |= CHARACTER_EFFECT_SEASONAL_FUMES;
  return next;
}

export function characterEffectFlags(auras: readonly CharacterEffectAura[]): number {
  let flags = 0;
  for (const aura of auras) flags = addCharacterEffectAura(flags, aura);
  return flags;
}

export function hasCharacterEffect(flags: number, effect: number): boolean {
  return (flags & effect) !== 0;
}
