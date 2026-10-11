import type { PlayerClass } from './types';

/** Complete primary hits only. Echoes inherit the hit and must not apply this again. */
export function dawnreaverDamageMultiplier(
  cls: PlayerClass | null,
  spec: string | null,
  abilityId: string | null | undefined,
): number {
  if (cls !== 'paladin' || spec !== 'retribution') return 1;
  switch (abilityId) {
    case 'final_edict':
    case 'dawnfall':
      return 2;
    case 'hammer_of_wrath':
      return 1.75;
    case 'sun_gods_verdict':
      return 1.5;
    default:
      return 1;
  }
}
