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
import { tierRange } from './heart_tier_damage';

const KEY = 'hudChrome.auraEffect.quenchGuardian';
const N = QUENCH_DIFFICULTY.normal;
const H = QUENCH_DIFFICULTY.heroic;
const M = QUENCH_DIFFICULTY.mythic;
/** Living Warmth as "1 cold per X% of health healed" (whole percent). */
const warmthPer = (rate: number): number => Math.round(1 / rate);

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);
/** Heroic's damage factor; Mythic shares it (pinned), so one range names both. */
const HM = QUENCH_DIFFICULTY.heroic.damageMult;
/** The shatter's factor per tier: damage times the tier's own shatter factor. */
const shatterMult = (tier: 'heroic' | 'mythic'): number =>
  QUENCH_DIFFICULTY[tier].damageMult * QUENCH_DIFFICULTY[tier].shatterMult;
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
          healPct: warmthPer(N.lifeWarmth),
          heroicHealPct: warmthPer(H.lifeWarmth),
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
          pct: pct(T.frozenPct),
          min: T.shatterMin,
          max: T.shatterMax,
          brittle: pct(T.brittlePct),
          seconds: T.brittleSeconds,
          radius: QUENCH_DIFFICULTY.normal.splashR,
          cold: QUENCH_DIFFICULTY.normal.splashCold,
          heroicRadius: QUENCH_DIFFICULTY.heroic.splashR,
          heroicCold: QUENCH_DIFFICULTY.heroic.splashCold,
          ...tierRange('heroic', T.shatterMin, T.shatterMax, shatterMult('heroic')),
          ...tierRange('mythic', T.shatterMin, T.shatterMax, shatterMult('mythic')),
        },
      };
    case QUENCH_AURAS.brittle:
      return {
        key: `${KEY}.brittle`,
        nums: { pct: pct(a.value ?? T.brittlePct), cap: T.brittleSplashCap },
      };
    case QUENCH_AURAS.splashed:
      return { key: `${KEY}.splashed`, nums: { cold: Math.round(a.value ?? 0) } };
    case QUENCH_AURAS.trapped:
      return {
        key: `${KEY}.trapped`,
        nums: {
          min: T.trapMin,
          max: T.trapMax,
          ...tierRange('heroic', T.trapMin, T.trapMax, HM),
          seconds: T.trapSeconds,
        },
      };
    case QUENCH_AURAS.awake:
      return {
        key: `${KEY}.awake`,
        nums: {
          lock: T.slashLock,
          min: T.crossMin,
          max: T.crossMax,
          cold: T.crossCold,
          ...tierRange('heroic', T.crossMin, T.crossMax, HM),
        },
      };
    case QUENCH_AURAS.marked:
      return {
        key: `${KEY}.marked`,
        nums: {
          order: a.value ?? 1,
          count: a.value2 ?? 1,
          lock: T.slashLock,
          min: T.crossMin,
          max: T.crossMax,
          cold: T.crossCold,
          ...tierRange('heroic', T.crossMin, T.crossMax, HM),
        },
      };
    case QUENCH_AURAS.rime:
      // On a raid frame the row carries no value, only the crust's left as a
      // percent of its carrier's health (party_frame_info.ts).
      if (a.poolPct !== undefined)
        return {
          key: `${KEY}.rimePool`,
          nums: { pct: Math.round(a.poolPct), seconds: T.rimeSeconds, radius: T.rimeBurstR },
        };
      // The crust's left rides `value`, its whole `value2`; the burst's cold
      // is the tier's splash, named per tier (Mythic shares Heroic's).
      return {
        key: `${KEY}.rime`,
        nums: {
          left: Math.max(0, Math.round(a.value ?? 0)),
          whole: Math.max(0, Math.round(a.value2 ?? a.value ?? 0)),
          seconds: T.rimeSeconds,
          slow: pct(1 - T.rimeSlow),
          mult: T.rimeColdMult,
          radius: T.rimeBurstR,
          cold: N.splashCold,
          heroicCold: H.splashCold,
          normalAbsorb: N.rimeAbsorb,
          heroicAbsorb: H.rimeAbsorb,
          heroicTargets: H.rimeTargets,
          mythicTargets: M.rimeTargets,
        },
      };
    case QUENCH_AURAS.rimeSlow:
      return {
        key: `${KEY}.rimeSlow`,
        nums: { slow: pct(1 - T.rimeSlow), mult: T.rimeColdMult },
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
