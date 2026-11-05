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
import { tierRange, tierValue } from './heart_tier_damage';

const KEY = 'hudChrome.auraEffect.council';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);
/** Heroic's damage factor; Mythic shares it (pinned), so one range names both. */
const HM = COUNCIL_DIFFICULTY.heroic.damageMult;
/** A tier's Wrath factor on top of its damage factor (council_wrath.ts). */
const wrathMult = (tier: 'heroic' | 'mythic'): number =>
  COUNCIL_DIFFICULTY[tier].damageMult * COUNCIL_DIFFICULTY[tier].wrathMult;

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
          ...tierRange('heroic', T.riseMin, T.riseMax, HM),
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
          heroicTotal: tierValue(T.rockTotal, HM),
          ...tierRange('heroicTremor', T.rockTremorMin, T.rockTremorMax, HM),
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
          ...tierRange('heroic', T.resonanceMin, T.resonanceMax, HM),
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
          ...tierRange('heroic', T.rushMin, T.rushMax, HM),
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
          ...tierRange('heroic', T.bondPulseMin, T.bondPulseMax, HM),
          growth: pct(T.bondPulseGrowth),
        },
      };
    case COUNCIL_AURAS.collapse:
      return {
        key: `${KEY}.collapse`,
        // A Mythic-only rule, so its range is Mythic's resolved one.
        nums: {
          every: T.collapseEvery,
          min: tierValue(T.collapseMin, COUNCIL_DIFFICULTY.mythic.damageMult),
          max: tierValue(T.collapseMax, COUNCIL_DIFFICULTY.mythic.damageMult),
        },
      };
    case COUNCIL_AURAS.memory:
      return {
        key: `${KEY}.memory`,
        nums: { pct: pct(a.value), per: pct(T.memoryPerFallen) },
      };
    case COUNCIL_AURAS.pillarLimit:
      return {
        key: `${KEY}.pillarLimit`,
        // The Guardian's Wrath on whoever no pillar hides: the tier's damage
        // factor times its own Wrath factor (Heroic's kills an unhidden cloth).
        nums: {
          limit: a.value2 ?? 0,
          share: pct(T.crowdShare),
          min: T.wrathMin,
          max: T.wrathMax,
          ...tierRange('heroic', T.wrathMin, T.wrathMax, wrathMult('heroic')),
          ...tierRange('mythic', T.wrathMin, T.wrathMax, wrathMult('mythic')),
        },
      };
    default:
      return null;
  }
}
