export interface SupportAura {
  id: string;
  kind: string;
  value: number;
  remaining: number;
  sourceId: number;
}

export const RUNE_RECIPIENT = 1;
export const AEGIS_RECIPIENT = 2;
export const DAWN_SPEED_RECIPIENT = 4;

/** Actual mirrored buffs are the proof of benefit; proximity is not. */
export function supportRecipientBits(
  auras: readonly SupportAura[],
  dead: boolean,
  kind: string,
): number {
  if (dead) return 0;
  let bits = 0;
  for (const aura of auras) {
    if (!(aura.remaining > 0) || !(aura.value > 0)) continue;
    if (aura.id === 'rune_of_power' && aura.kind === 'buff_dmg_done') bits |= RUNE_RECIPIENT;
    if (kind !== 'player') continue;
    if (
      Number.isInteger(aura.sourceId) &&
      aura.id === `aegis_first_dawn_dr:${aura.sourceId}` &&
      aura.kind === 'shield_wall'
    )
      bits |= AEGIS_RECIPIENT;
    if (aura.id === 'aegis_first_dawn_speed' && aura.kind === 'buff_speed' && aura.value > 1)
      bits |= DAWN_SPEED_RECIPIENT;
  }
  return bits;
}
