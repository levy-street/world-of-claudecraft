// What the Smith's Heart's Guardian of the Quench auras DO, for their
// buff/debuff hover tooltip (docs/design/tooltip-writing.md). A pure
// descriptor like the rest of aura_effect.ts (which calls this before the
// generic kind line): it returns a hudChrome.auraEffect.quenchGuardian.* key
// plus the raw numbers, and the HUD formats the numbers and renders
// t(key, values). The cold bar and the huddle's warmth ride quiet
// `internal_cd` markers (no stat at all), and the freeze and the water are
// a stun and a root whose generic lines would not say what comes next, so
// each says its rule instead. Every number comes from the fight's tuning
// (src/sim/encounters/smith_heart/quench_ids.ts), the same constants the sim
// reads; the bar's value comes off the aura itself. Pinned by
// tests/smith_heart_quench_ui.test.ts.

import {
  QUENCH_AURAS,
  QUENCH_DIFFICULTY,
  QUENCH_TUNING as T,
} from '../sim/encounters/smith_heart/quench_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.quenchGuardian';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);
/** Seconds to fill the bar alone, whole. */
const FILL_SECONDS = Math.round(T.coldMax / T.coldRise);

/** The fight's aura's descriptor, or null when `a` is not one of them. */
export function quenchAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case QUENCH_AURAS.cold:
      return {
        key: `${KEY}.cold`,
        nums: {
          cold: Math.round(a.value ?? 0),
          max: T.coldMax,
          fill: FILL_SECONDS,
          radius: T.warmR,
          others: T.warmNeed,
          fall: T.coldFall,
          freeze: T.freezeSeconds,
        },
      };
    case QUENCH_AURAS.warmth:
      return {
        key: `${KEY}.warmth`,
        nums: { fall: T.coldFall, linger: T.strainLinger },
      };
    case QUENCH_AURAS.frozen:
      return {
        key: `${KEY}.frozen`,
        nums: {
          min: T.shatterMin,
          max: T.shatterMax,
          radius: QUENCH_DIFFICULTY.normal.splashR,
          cold: QUENCH_DIFFICULTY.normal.splashCold,
          heroicRadius: QUENCH_DIFFICULTY.heroic.splashR,
          heroicCold: QUENCH_DIFFICULTY.heroic.splashCold,
        },
      };
    case QUENCH_AURAS.brittle:
      return { key: `${KEY}.brittle`, nums: { pct: pct(a.value ?? T.brittlePct) } };
    case QUENCH_AURAS.trapped:
      return {
        key: `${KEY}.trapped`,
        nums: {
          min: T.trapMin,
          max: T.trapMax,
          seconds: T.trapSeconds,
        },
      };
    case QUENCH_AURAS.awake:
      return {
        key: `${KEY}.awake`,
        nums: { delay: T.echoDelay, low: T.echoDelayLow, lowPct: pct(T.lowAt) },
      };
    case QUENCH_AURAS.deepening:
      return {
        key: `${KEY}.deepening`,
        nums: {
          every: T.deepenEvery,
          step: pct(T.deepenStep),
          stacks: a.stacks ?? 0,
          total: pct(T.deepenStep * (a.stacks ?? 0)),
        },
      };
    default:
      return null;
  }
}
