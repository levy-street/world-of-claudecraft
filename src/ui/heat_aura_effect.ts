// What the Smith's Heart's Guardian of the Heat auras DO, for their
// buff/debuff hover tooltip (docs/design/tooltip-writing.md). A pure
// descriptor like the rest of aura_effect.ts (which calls this before the
// generic kind line): it returns a hudChrome.auraEffect.heatGuardian.* key
// plus the raw numbers, and the HUD formats the numbers and renders
// t(key, values). The heat, the stoking and the overheating ride quiet
// `internal_cd` markers (no stat at all), and Crystal Burn is a spell
// vulnerability whose generic line would not say how it stacks and fades, so
// each says its rule instead. Every number comes from the fight's tuning
// (src/sim/encounters/smith_heart/heat_ids.ts), the same constants the sim
// reads; the heat and the stacks come off the aura itself. Pinned by
// tests/smith_heart_heat_ui.test.ts.

import {
  burnAmp,
  HEAT_AURAS,
  HEAT_DIFFICULTY,
  pulseDamage,
  stokeMult,
  HEAT_TUNING as T,
} from '../sim/encounters/smith_heart/heat_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.heatGuardian';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** The fight's aura's descriptor, or null when `a` is not one of them. */
export function heatAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case HEAT_AURAS.heat: {
      const heat = Math.max(0, Math.min(T.heatMax, Math.round(a.value ?? 0)));
      const mid = pulseDamage(heat);
      return {
        key: `${KEY}.heat`,
        nums: {
          heat,
          max: T.heatMax,
          rise: T.heatRise,
          every: T.pulseEvery,
          min: Math.round(mid * (1 - T.pulseSpread)),
          most: Math.round(mid * (1 + T.pulseSpread)),
          cool: T.rayCool,
          range: T.rayRange,
          back: T.rayBack,
        },
      };
    }
    case HEAT_AURAS.burn: {
      const stacks = Math.max(1, a.stacks ?? 1);
      return {
        key: `${KEY}.burn`,
        nums: {
          pct: pct(burnAmp(stacks)),
          stacks,
          per: pct(T.burnPct),
          most: T.burnMax,
          decay: HEAT_DIFFICULTY.normal.burnDecay,
          heroicDecay: HEAT_DIFFICULTY.heroic.burnDecay,
        },
      };
    }
    case HEAT_AURAS.stoked: {
      const stacks = a.stacks ?? 0;
      return {
        key: `${KEY}.stoked`,
        nums: {
          total: pct(stokeMult(stacks) - 1),
          step: pct(T.stokeStep),
          every: T.stokeEvery,
          stacks,
        },
      };
    }
    case HEAT_AURAS.overheating:
      return {
        key: `${KEY}.overheating`,
        nums: {
          at: T.windupAt,
          max: T.heatMax,
          min: HEAT_DIFFICULTY.normal.overheatMin,
          most: HEAT_DIFFICULTY.normal.overheatMax,
          heroicMin: HEAT_DIFFICULTY.heroic.overheatMin,
          heroicMost: HEAT_DIFFICULTY.heroic.overheatMax,
          vent: T.ventTo,
        },
      };
    default:
      return null;
  }
}
