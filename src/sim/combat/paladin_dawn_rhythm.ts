import type { Entity } from '../types';

export const DAWN_RHYTHM_COOLDOWN_REDUCTION = 2;

const PAIRED_COOLDOWN: Readonly<Record<string, string>> = {
  final_edict: 'dawnfall',
  dawnfall: 'final_edict',
};

/**
 * Reduces the running cooldown paired with a successful Retribution builder.
 * The reduction is never banked: a ready ability stays ready.
 */
export function triggerPaladinDawnRhythm(player: Entity, abilityId: string): number {
  const pairedAbilityId = PAIRED_COOLDOWN[abilityId];
  if (!pairedAbilityId) return 0;
  const remaining = player.cooldowns.get(pairedAbilityId);
  if (remaining === undefined || remaining <= 0) return 0;
  const reduction = Math.min(remaining, DAWN_RHYTHM_COOLDOWN_REDUCTION);
  const next = remaining - reduction;
  if (next <= 0) player.cooldowns.delete(pairedAbilityId);
  else player.cooldowns.set(pairedAbilityId, next);
  return reduction;
}
