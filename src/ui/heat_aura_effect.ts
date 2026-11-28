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
import { tierRange, tierValue } from './heart_tier_damage';

const KEY = 'hudChrome.auraEffect.heatGuardian';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);
/** Normal's damage factor (x1.15 since the parse-calibrated pass of 2026-11-16). */
const NM = HEAT_DIFFICULTY.normal.damageMult;
/** Heroic's extra damage over Normal's, as a percent. */
const HEROIC_PCT = pct(HEAT_DIFFICULTY.heroic.damageMult / NM - 1);

/** The guardian's state aura's line: its stage, else its phase. */
function stateDescriptor(a: AuraEffectInput): AuraEffectDescriptor {
  const stage = a.value2 ?? HEAT_STAGES.fight;
  if (stage === HEAT_STAGES.sinking || stage === HEAT_STAGES.under || stage === HEAT_STAGES.rising)
    return {
      key: `${KEY}.stateUnder`,
      nums: {
        min: tierValue(T.ringMin, NM),
        max: tierValue(T.ringMax, NM),
        ...tierRange('heroic', T.ringMin, T.ringMax, HEAT_DIFFICULTY.heroic.damageMult),
      },
    };
  const phase = Math.max(1, Math.min(3, Math.round(a.value ?? 1)));
  return {
    key: `${KEY}.statePhase${phase}`,
    nums: {
      reach: T.flareReach,
      heroicPct: HEROIC_PCT,
      warn: HEAT_DIFFICULTY.normal.wheel.warn,
      heroicWarn: HEAT_DIFFICULTY.heroic.wheel.warn,
    },
  };
}

/** The fight's aura's descriptor, or null when `a` is not one of them. */
export function heatAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case HEAT_AURAS.state:
      return stateDescriptor(a);
    // Its entrance's marker (cold, or waking): out of reach until it burns.
    case HEAT_AURAS.intro:
      return { key: `${KEY}.intro`, nums: {} };
    case HEAT_AURAS.scorched:
      return {
        key: `${KEY}.scorched`,
        nums: { pct: pct(T.scorchedPct), reach: T.flareReach, every: T.flareEvery },
      };
    case HEAT_AURAS.grip: {
      const stacks = Math.max(1, a.stacks ?? 1);
      // The tier's burn rides the aura (heat_grip.ts): its per-stack share.
      const total = Math.round(a.value ?? T.gripPerTick * stacks);
      return {
        key: `${KEY}.grip`,
        nums: {
          total,
          per: Math.round(total / stacks),
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
    // Wellspring Brand (heat_brand.ts): the mark's share and length ride the
    // aura, the tier's gap between brands its `value2`; the hit is Normal's
    // with Heroic's (Mythic's damage factor is Heroic's) beside it.
    case HEAT_AURAS.brand: {
      const N = HEAT_DIFFICULTY.normal.brand;
      return {
        key: `${KEY}.brand`,
        nums: {
          pct: pct(a.value ?? N.taken),
          seconds: N.seconds,
          every: Math.round(a.value2 ?? N.every),
          min: tierValue(T.brandMin, NM),
          max: tierValue(T.brandMax, NM),
          ...tierRange('heroic', T.brandMin, T.brandMax, HEAT_DIFFICULTY.heroic.damageMult),
        },
      };
    }
    // Heroic and Mythic only (heat_coal.ts), so their resolved numbers; the
    // absorb is what is left on the aura now.
    case HEAT_AURAS.coal: {
      const H = HEAT_DIFFICULTY.heroic;
      return {
        key: `${KEY}.coal`,
        nums: {
          absorb: Math.max(0, Math.round(a.value ?? tierValue(T.coalAbsorb, H.damageMult))),
          ...tierRange('burn', T.coalBurnMin, T.coalBurnMax, H.damageMult),
          leap: T.coalLeapR,
          grace: T.coalGrace,
          ...tierRange('leap', T.coalLeapMin, T.coalLeapMax, H.damageMult),
          seconds: T.coalSeconds,
          ...tierRange('burst', T.coalBurstMin, T.coalBurstMax, H.punishMult),
          radius: T.coalBurstR,
        },
      };
    }
    default:
      return null;
  }
}
