// What the Drowned Temple's boss auras DO, for their buff/debuff hover tooltip.
// A pure descriptor like the rest of aura_effect.ts (which calls this): it
// returns a hudChrome.auraEffect.temple.* key plus the raw numbers, and the HUD
// formats the numbers and renders t(key, values). Choirmother Selthe's Score
// ward is a `buff_dr` of 0 riding a damage immunity, so the generic kind line
// would lie ("takes 0% less damage"); it says the rule instead. Numbers come
// from the encounter tuning (src/sim/encounters/drowned_temple/ids.ts) and the
// heroic mechanic factor (content/dungeon_difficulty.ts), the same constants
// combat reads. Pinned by tests/drowned_temple_alert.test.ts.

import { HEROIC_DUNGEON_TUNING } from '../sim/content/dungeon_difficulty';
import {
  SELTHE_BROKEN_VOICE_EXPOSED,
  SELTHE_ID,
  SELTHE_SCORE_WARD,
  SELTHE_SPENT_VOICE,
  SELTHE_TUNING,
} from '../sim/encounters/drowned_temple/ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.temple';

/** A Temple boss mechanic's heroic amount (its normal numbers are stated
 *  landed; heroic multiplies them by the mob's heroic mechanic factor). */
export function templeHeroicAmount(mobId: string, amount: number): number {
  const mult = HEROIC_DUNGEON_TUNING.drowned_temple?.mechanicDamageMultiplierByMob?.[mobId] ?? 1;
  return Math.round(amount * mult);
}

/** The Temple aura's descriptor, or null when `a` is not one of them. */
export function templeAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case SELTHE_SPENT_VOICE:
      return { key: `${KEY}.spentVoice` };
    case SELTHE_SCORE_WARD:
      return {
        key: `${KEY}.scoreWard`,
        nums: {
          min: SELTHE_TUNING.discordMin,
          max: SELTHE_TUNING.discordMax,
          heroicMin: templeHeroicAmount(SELTHE_ID, SELTHE_TUNING.discordMin),
          heroicMax: templeHeroicAmount(SELTHE_ID, SELTHE_TUNING.discordMax),
        },
      };
    case SELTHE_BROKEN_VOICE_EXPOSED:
      return {
        key: `${KEY}.brokenVoice`,
        nums: { pct: Math.round(SELTHE_TUNING.brokenVuln * 100) },
      };
    default:
      return null;
  }
}
