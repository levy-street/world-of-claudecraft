import { setBonusFlag, ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC } from '../content/ignivar_set_bonuses';
import type { TalentModifiers } from '../content/talents';
import type { Entity } from '../types';

export const DAWN_RHYTHM_COOLDOWN_REDUCTION = 2;

const PAIRED_COOLDOWN: Readonly<Record<string, string>> = {
  final_edict: 'dawnfall',
  dawnfall: 'final_edict',
};

/** Zealfire 2pc: the paired cut deepens to 3 sec for wearers; everyone else
 *  keeps the base DAWN_RHYTHM_COOLDOWN_REDUCTION. Deterministic, no rng. */
export function dawnRhythmCutSec(mods: TalentModifiers | null | undefined): number {
  return mods?.selected[setBonusFlag('zealfire', 2)] === true
    ? ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC
    : DAWN_RHYTHM_COOLDOWN_REDUCTION;
}

/**
 * Reduces the running cooldown paired with a successful Retribution builder.
 * The reduction is never banked: a ready ability stays ready.
 */
export function triggerPaladinDawnRhythm(
  player: Entity,
  abilityId: string,
  reductionSec: number = DAWN_RHYTHM_COOLDOWN_REDUCTION,
): number {
  const pairedAbilityId = PAIRED_COOLDOWN[abilityId];
  if (!pairedAbilityId) return 0;
  const remaining = player.cooldowns.get(pairedAbilityId);
  if (remaining === undefined || remaining <= 0) return 0;
  const reduction = Math.min(remaining, reductionSec);
  const next = remaining - reduction;
  if (next <= 0) player.cooldowns.delete(pairedAbilityId);
  else player.cooldowns.set(pairedAbilityId, next);
  return reduction;
}
