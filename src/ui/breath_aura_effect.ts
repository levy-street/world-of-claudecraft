// What the Smith's Heart's Guardian of the Breath auras DO, for their
// buff/debuff hover tooltip (docs/design/tooltip-writing.md). A pure
// descriptor like the rest of aura_effect.ts (which calls this before the
// generic kind line): it returns a hudChrome.auraEffect.breathGuardian.* key plus the
// raw numbers, and the HUD formats the numbers and renders t(key, values).
// The fight's marks ride a quiet `internal_cd` marker (no stat at all), and
// the lifted player's hold is a stun whose generic line would not say what
// comes next, so each says its rule instead. Every number comes from the
// fight's tuning (src/sim/encounters/smith_heart/breath_ids.ts), the same
// constants the sim reads; the wind's and the pull's speed come off the aura
// itself (the live value: heroic's wind blows harder). Pinned by
// tests/smith_heart_breath_ui.test.ts.

import {
  BREATH_AURAS,
  BREATH_DIFFICULTY,
  BREATH_TUNING as T,
} from '../sim/encounters/smith_heart/breath_ids';
import { WIND_DRIFT_AURA, WIND_PULL_AURA } from '../sim/wind_drift';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.breathGuardian';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** The fight's aura's descriptor, or null when `a` is not one of them. */
export function breathAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case WIND_DRIFT_AURA:
      return {
        key: `${KEY}.wind`,
        nums: {
          speed: a.value2 ?? BREATH_DIFFICULTY.normal.windSpeed,
          pinMin: T.pinMin,
          pinMax: T.pinMax,
        },
      };
    case WIND_PULL_AURA:
      return {
        key: `${KEY}.draw`,
        nums: {
          speed: a.value3 ?? T.pullSpeed,
          min: T.vortexMin,
          max: T.vortexMax,
          tick: T.vortexTick,
          gustMin: T.gustMin,
          gustMax: T.gustMax,
          throw: T.gustThrow,
        },
      };
    case BREATH_AURAS.pinned:
      return { key: `${KEY}.pinned`, nums: { min: T.pinMin, max: T.pinMax } };
    case BREATH_AURAS.anchor:
      return { key: `${KEY}.anchor` };
    case BREATH_AURAS.spent:
      return { key: `${KEY}.spent` };
    case BREATH_AURAS.drawn:
      return {
        key: `${KEY}.drawn`,
        nums: {
          every: T.drawnStrikeEvery,
          warn: T.drawnWarn,
          min: T.drawnMin,
          max: T.drawnMax,
          radius: T.drawnR,
          cmin: T.chargedMin,
          cmax: T.chargedMax,
          charged: T.chargedSeconds,
        },
      };
    case BREATH_AURAS.cradled:
      return {
        key: `${KEY}.cradled`,
        nums: {
          hold: T.cradleHold,
          total: T.cradleTotal,
          radius: T.cradleR,
          soakers: BREATH_DIFFICULTY.normal.cradleSoakers,
          heroicSoakers: BREATH_DIFFICULTY.heroic.cradleSoakers,
          penalty: pct(T.cradlePenaltyMult - 1),
          bmin: T.backlashMin,
          bmax: T.backlashMax,
        },
      };
    case BREATH_AURAS.stormForm:
      return { key: `${KEY}.stormForm` };
    case BREATH_AURAS.swell:
      return {
        key: `${KEY}.swell`,
        nums: {
          every: T.swellEvery,
          min: T.swellMin,
          max: T.swellMax,
          growth: pct(T.swellGrowth),
          stacks: a.stacks ?? 0,
        },
      };
    default:
      return null;
  }
}
