export const CHARACTER_EFFECT_SOUL_REND = 1 << 0;
export const CHARACTER_EFFECT_SANGUINE = 1 << 1;
export const CHARACTER_EFFECT_RECKLESSNESS = 1 << 2;

export interface CharacterEffectAura {
  id: string;
  kind: string;
}

export function addCharacterEffectAura(flags: number, aura: CharacterEffectAura): number {
  let next = flags;
  if (aura.id === 'nythraxis_soul_rend') next |= CHARACTER_EFFECT_SOUL_REND;
  if (aura.id === 'sanguine_aura') next |= CHARACTER_EFFECT_SANGUINE;
  if (aura.kind === 'buff_reckless') next |= CHARACTER_EFFECT_RECKLESSNESS;
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
