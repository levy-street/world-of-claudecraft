// What Forge-Fury, the Smith's Heart's hard enrage, DOES, for its buff hover
// tooltip on the boss frame (docs/design/tooltip-writing.md). A pure
// descriptor like the rest of aura_effect.ts: a hudChrome.auraEffect.forgeFury.*
// key plus the raw numbers. The boss's timer for its tier rides the aura's
// `value` (seconds from the pull); every other number is the sim's own
// (src/sim/encounters/smith_heart/hard_enrage_ids.ts). Pinned by
// tests/smith_heart_hard_enrage.test.ts.

import {
  HARD_ENRAGE_AURAS,
  HARD_ENRAGE_TUNING as T,
} from '../sim/encounters/smith_heart/hard_enrage_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.forgeFury';

function nums(a: AuraEffectInput): Record<string, number> {
  return {
    minutes: Math.round(((a.value ?? 0) / 60) * 10) / 10,
    share: Math.round(T.pulseShare * 100),
    share2: Math.round(T.pulseShare * 200),
    every: T.pulseEvery,
  };
}

/** Forge-Fury's aura's descriptor, or null when `a` is not one of them. */
export function hardEnrageAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  if (a.id === HARD_ENRAGE_AURAS.gathering) return { key: `${KEY}.gathering`, nums: nums(a) };
  if (a.id === HARD_ENRAGE_AURAS.fury) return { key: `${KEY}.fury`, nums: nums(a) };
  return null;
}
