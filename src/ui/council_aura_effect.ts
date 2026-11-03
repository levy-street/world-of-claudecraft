// What the Smith's Heart's Hammer Council auras DO, for their buff/debuff hover
// tooltip (docs/design/tooltip-writing.md). A pure descriptor like the rest of
// aura_effect.ts (which calls this before the generic kind line): it returns a
// hudChrome.auraEffect.council.* key plus the raw numbers, and the HUD formats
// the numbers and renders t(key, values). The three player marks ride a
// zero-value marker kind whose generic line would say nothing true, so each
// says its rule instead; Memory of Stone says its per-fallen share. Every
// number comes from the council's tuning (src/sim/encounters/smith_heart/
// council_ids.ts), the same constants the fight reads; Hammer's Weight keeps
// the generic physical-damage-taken line, which is exactly what it does.
// Pinned by tests/smith_heart_council_ui.test.ts.

import {
  COUNCIL_AURAS,
  COUNCIL_DIFFICULTY,
  COUNCIL_TUNING as T,
} from '../sim/encounters/smith_heart/council_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.council';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** The council aura's descriptor, or null when `a` is not one of them. */
export function councilAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case COUNCIL_AURAS.wakeMark:
      return {
        key: `${KEY}.wakeMark`,
        nums: {
          radius: T.riseKnockRadius,
          min: T.riseMin,
          max: T.riseMax,
          heroic: pct(COUNCIL_DIFFICULTY.heroic.damageMult - 1),
        },
      };
    case COUNCIL_AURAS.rockMark:
      return {
        key: `${KEY}.rockMark`,
        nums: {
          total: T.rockTotal,
          radius: T.rockRadius,
          soakers: T.rockMinSoakers,
          penalty: pct(T.rockPenaltyMult - 1),
          tremorMin: T.rockTremorMin,
          tremorMax: T.rockTremorMax,
          soulReach: T.soulRockReach,
          heroic: pct(COUNCIL_DIFFICULTY.heroic.damageMult - 1),
        },
      };
    case COUNCIL_AURAS.resonance:
      return {
        key: `${KEY}.resonance`,
        nums: {
          every: T.resonanceEvery,
          min: T.resonanceMin,
          max: T.resonanceMax,
          radius: a.value2 && a.value2 > 0 ? a.value2 : T.resonanceRadius,
          heroic: pct(COUNCIL_DIFFICULTY.heroic.damageMult - 1),
        },
      };
    case COUNCIL_AURAS.rushMark:
      return {
        key: `${KEY}.rushMark`,
        nums: {
          windup: T.rushWindup,
          stun: T.rushStunSeconds,
          exposed: pct(T.rushExposed),
          exposedSeconds: T.rushExposedSeconds,
          min: T.rushMin,
          max: T.rushMax,
        },
      };
    case COUNCIL_AURAS.rushExposed:
      return { key: `${KEY}.rushExposed`, nums: { pct: pct(a.value) } };
    case COUNCIL_AURAS.bond:
      return {
        key: `${KEY}.bond`,
        nums: {
          pct: pct(T.bondWard),
          reach: T.bondReach,
          every: T.bondPulseEvery,
          min: T.bondPulseMin,
          max: T.bondPulseMax,
          growth: pct(T.bondPulseGrowth),
        },
      };
    case COUNCIL_AURAS.collapse:
      return {
        key: `${KEY}.collapse`,
        nums: { every: T.collapseEvery, min: T.collapseMin, max: T.collapseMax },
      };
    case COUNCIL_AURAS.memory:
      return {
        key: `${KEY}.memory`,
        nums: { pct: pct(a.value), per: pct(T.memoryPerFallen) },
      };
    case COUNCIL_AURAS.pillarLimit:
      return {
        key: `${KEY}.pillarLimit`,
        nums: { limit: a.value2 ?? 0, share: pct(T.crowdShare) },
      };
    default:
      return null;
  }
}
