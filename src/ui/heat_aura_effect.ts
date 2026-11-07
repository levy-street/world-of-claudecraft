// What the Smith's Heart's Guardian of the Heat auras DO, for their
// buff/debuff hover tooltip (docs/design/tooltip-writing.md). A pure
// descriptor like the rest of aura_effect.ts (which calls this before the
// generic kind line): it returns a hudChrome.auraEffect.heatGuardian.* key
// plus the raw numbers, and the HUD formats the numbers and renders
// t(key, values). Most of the fight's marks ride quiet `internal_cd` markers
// (no stat at all), and Flare-Scorched and Cinder Grip are a vulnerability
// and a stacking burn whose generic lines would not say where they come from
// or what to do, so each says its rule instead. Every number comes from the fight's tuning
// (src/sim/encounters/smith_heart/heat_ids.ts), the same constants the sim
// reads (Normal's numbers, Heroic's damage a quarter higher); a stack count
// and the guardian's phase come off the aura itself. Pinned by
// tests/smith_heart_heat_ui.test.ts.

import {
  HEAT_AURAS,
  HEAT_DIFFICULTY,
  HEAT_STAGES,
  HEAT_TUNING as T,
} from '../sim/encounters/smith_heart/heat_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';
import { tierRange } from './heart_tier_damage';

const KEY = 'hudChrome.auraEffect.heatGuardian';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);
/** Heroic's extra damage, as a percent. */
const HEROIC_PCT = pct(HEAT_DIFFICULTY.heroic.damageMult - 1);

/** The guardian's state aura's line: its stage, else its phase. */
function stateDescriptor(a: AuraEffectInput): AuraEffectDescriptor {
  const stage = a.value2 ?? HEAT_STAGES.fight;
  if (stage === HEAT_STAGES.sinking || stage === HEAT_STAGES.under || stage === HEAT_STAGES.rising)
    return { key: `${KEY}.stateUnder`, nums: {} };
  const phase = Math.max(1, Math.min(3, Math.round(a.value ?? 1)));
  return {
    key: `${KEY}.statePhase${phase}`,
    nums: { reach: T.flareReach, heroicPct: HEROIC_PCT },
  };
}

/** The fight's aura's descriptor, or null when `a` is not one of them. */
export function heatAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case HEAT_AURAS.state:
      return stateDescriptor(a);
    case HEAT_AURAS.scorched:
      return {
        key: `${KEY}.scorched`,
        nums: { pct: pct(T.scorchedPct), reach: T.flareReach, every: T.flareEvery },
      };
    case HEAT_AURAS.grip: {
      const stacks = Math.max(1, a.stacks ?? 1);
      return {
        key: `${KEY}.grip`,
        nums: {
          total: Math.round(a.value ?? T.gripPerTick * stacks),
          per: T.gripPerTick,
          stacks,
          seconds: T.gripSeconds,
          most: T.gripMaxStacks,
        },
      };
    }
    case HEAT_AURAS.kindling:
      return {
        key: `${KEY}.kindling`,
        nums: {
          seconds: T.markSeconds,
          trail: T.trailSeconds,
          min: T.trailMin,
          max: T.trailMax,
          ...tierRange('heroic', T.trailMin, T.trailMax, HEAT_DIFFICULTY.heroic.damageMult),
          heal: pct(T.trailHealPct),
        },
      };
    case HEAT_AURAS.trail:
      return {
        key: `${KEY}.trail`,
        nums: {
          radius: T.trailR,
          life: T.trailLife,
          min: T.trailMin,
          max: T.trailMax,
          ...tierRange('heroic', T.trailMin, T.trailMax, HEAT_DIFFICULTY.heroic.damageMult),
          heal: pct(T.trailHealPct),
        },
      };
    case HEAT_AURAS.hunted:
      return {
        key: `${KEY}.hunted`,
        nums: { radius: T.cinderSplashR, knock: T.cinderKnock, crust: T.crustSeconds },
      };
    case HEAT_AURAS.crust:
      return { key: `${KEY}.crust`, nums: {} };
    default:
      return null;
  }
}
