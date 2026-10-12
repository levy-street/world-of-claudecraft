import { NYTHRAXIS_IMPALED_AURA_ID } from '../sim/nythraxis_bone_spike';

export const CHARACTER_EFFECT_SOUL_REND = 1 << 0;
export const CHARACTER_EFFECT_SANGUINE = 1 << 1;
export const CHARACTER_EFFECT_RECKLESSNESS = 1 << 2;
/** Pinned to a Nythraxis Bone Spike: the living body drapes the death pose
 *  (plays its death clip and holds the last frame) until the aura clears. */
export const CHARACTER_EFFECT_IMPALED = 1 << 3;
/** Rising spores, worn by a druid in Sporemender Form. */
export const CHARACTER_EFFECT_SPORE_FORM = 1 << 4;
/** Rising spores, worn by anyone carrying the Sporemending (`rejuvenation`)
 *  heal-over-time, so the healed target reads the healer's mushroom motif. */
export const CHARACTER_EFFECT_SPORE_HOT = 1 << 5;

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
  if (aura.kind === 'form_sporemender') next |= CHARACTER_EFFECT_SPORE_FORM;
  if (aura.id === 'rejuvenation' && aura.kind === 'hot') next |= CHARACTER_EFFECT_SPORE_HOT;
  return next;
}

/** Which spore aura a body wears, if any: the full Sporemender Form drift, or
 *  the sparser Sporemending drift on a healed target. Both are cosmetic: the
 *  HoT arm can sit on every member of a raid at once, so it emits at a lower
 *  rate and is dropped entirely under reduced motion (the form arm keeps its
 *  identity there, like Moonwing's star motes). Neither ever stands for
 *  information a player acts on: the HoT itself is on the buff frames. */
export function characterSporeAura(
  flags: number,
  reducedMotion: boolean,
): 'sporemender' | 'sporemending' | null {
  if ((flags & CHARACTER_EFFECT_SPORE_FORM) !== 0) return 'sporemender';
  if (!reducedMotion && (flags & CHARACTER_EFFECT_SPORE_HOT) !== 0) return 'sporemending';
  return null;
}

export function characterEffectFlags(auras: readonly CharacterEffectAura[]): number {
  let flags = 0;
  for (const aura of auras) flags = addCharacterEffectAura(flags, aura);
  return flags;
}

export function hasCharacterEffect(flags: number, effect: number): boolean {
  return (flags & effect) !== 0;
}
