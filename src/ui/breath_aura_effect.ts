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
  BREATH_KNOT,
  BREATH_TUNING as T,
} from '../sim/encounters/smith_heart/breath_ids';
import { ISLE_AURAS, ISLE_TUNING as IT } from '../sim/encounters/smith_heart/breath_isle_ids';
import { WIND_DRIFT_AURA, WIND_PULL_AURA } from '../sim/wind_drift';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';
import { tierRange, tierValue } from './heart_tier_damage';

const KEY = 'hudChrome.auraEffect.breathGuardian';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);
/** A load's walk with no tier on it (a stale mirror): Mythic's, the slower. */
const KNOT_WALK = BREATH_KNOT.mythic.walkMult;
/** Heroic's damage factor; Mythic shares it (pinned), so one range names both. */
const HM = BREATH_DIFFICULTY.heroic.damageMult;

/** The fight's aura's descriptor, or null when `a` is not one of them. */
export function breathAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    // The entrance's marker (gathered, or waking): out of reach until the
    // storm has set it down.
    case BREATH_AURAS.intro:
      return { key: `${KEY}.intro`, nums: {} };
    case WIND_DRIFT_AURA:
      return {
        key: `${KEY}.wind`,
        nums: {
          speed: a.value2 ?? BREATH_DIFFICULTY.normal.windSpeed,
          pinMin: T.pinMin,
          pinMax: T.pinMax,
          ...tierRange('heroic', T.pinMin, T.pinMax, HM),
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
          throw: BREATH_DIFFICULTY.normal.gustThrow,
          heroicThrow: BREATH_DIFFICULTY.heroic.gustThrow,
          ...tierRange('heroic', T.vortexMin, T.vortexMax, HM),
          ...tierRange('heroicGust', T.gustMin, T.gustMax, HM),
        },
      };
    case BREATH_AURAS.pinned:
      return {
        key: `${KEY}.pinned`,
        nums: { min: T.pinMin, max: T.pinMax, ...tierRange('heroic', T.pinMin, T.pinMax, HM) },
      };
    case BREATH_AURAS.portalA:
      return { key: `${KEY}.portalA` };
    case BREATH_AURAS.portalB:
      return { key: `${KEY}.portalB` };
    case BREATH_AURAS.portalC:
      return { key: `${KEY}.portalC` };
    case BREATH_AURAS.portalD:
      return { key: `${KEY}.portalD` };
    case BREATH_AURAS.laden:
      // The tier's walk rides the load's value2 (Heroic 70, Mythic 50); its
      // value is the pace of the moment, quicker with the wind at the back.
      return { key: `${KEY}.laden`, nums: { walk: pct(a.value2 ?? KNOT_WALK) } };
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
          ...tierRange('heroic', T.drawnMin, T.drawnMax, HM),
          ...tierRange('heroicC', T.chargedMin, T.chargedMax, HM),
        },
      };
    case BREATH_AURAS.cradled:
      return {
        key: `${KEY}.cradled`,
        nums: {
          hold: T.cradleHold,
          total: BREATH_DIFFICULTY.normal.cradleTotal,
          heroicTotal: tierValue(BREATH_DIFFICULTY.heroic.cradleTotal, HM),
          radius: T.cradleR,
          soakers: BREATH_DIFFICULTY.normal.cradleSoakers,
          heroicSoakers: BREATH_DIFFICULTY.heroic.cradleSoakers,
          heroicCount: BREATH_DIFFICULTY.heroic.cradleCount,
          penalty: pct(T.cradlePenaltyMult - 1),
          bmin: T.backlashMin,
          bmax: T.backlashMax,
          ...tierRange('heroicB', T.backlashMin, T.backlashMax, HM),
        },
      };
    case ISLE_AURAS.bulwark:
      return {
        key: `${KEY}.bulwark`,
        nums: {
          left: Math.max(0, Math.round(a.value ?? 0)),
          regrow: pct(IT.regrowShare),
          mend: pct(IT.mendShare),
          max: IT.bulwarkMax,
          bmin: IT.burstMin,
          bmax: IT.burstMax,
          ...tierRange('heroic', IT.burstMin, IT.burstMax, HM),
        },
      };
    case ISLE_AURAS.riding:
      return { key: `${KEY}.riding` };
    case ISLE_AURAS.windworn:
      return { key: `${KEY}.windworn` };
    case BREATH_AURAS.thrown:
      return { key: `${KEY}.thrown` };
    case BREATH_AURAS.tossed:
      return { key: `${KEY}.tossed` };
    case BREATH_AURAS.stormForm:
      return { key: `${KEY}.stormForm` };
    case BREATH_AURAS.swell:
      return {
        key: `${KEY}.swell`,
        nums: {
          every: T.swellEvery,
          min: T.swellMin,
          max: T.swellMax,
          ...tierRange('heroic', T.swellMin, T.swellMax, HM),
          growth: pct(T.swellGrowth),
          stacks: a.stacks ?? 0,
        },
      };
    default:
      return null;
  }
}
