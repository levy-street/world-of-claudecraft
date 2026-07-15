import type { AuraKind } from '../types';

// Flat stat magnitudes remain integer-valued after a talent strengthens them.
// Rate multipliers have a neutral value of 1, so their BONUS is scaled instead
// of the whole multiplier: improving 1.25 by 20% yields 1.30, not 1.50.
export const SCALABLE_FLAT_BUFF_KINDS: ReadonlySet<AuraKind> = new Set([
  'buff_ap',
  'buff_armor',
  'buff_int',
  'buff_agi',
  'buff_str_agi',
  'buff_spi',
  'buff_sta',
  'buff_spellpower',
  'thorns',
]);

const NEUTRAL_ONE_BUFF_KINDS: ReadonlySet<AuraKind> = new Set([
  'attackspeed',
  'buff_speed',
  'buff_haste',
  'tongues',
  'stealth',
  'form_travel',
  'buff_scale',
  'buff_jump',
]);

export function scaleTalentBuffValue(kind: AuraKind, value: number, buffPct: number): number {
  const multiplier = 1 + buffPct;
  if (SCALABLE_FLAT_BUFF_KINDS.has(kind)) return Math.round(value * multiplier);
  if (NEUTRAL_ONE_BUFF_KINDS.has(kind)) return 1 + (value - 1) * multiplier;
  return value * multiplier;
}
