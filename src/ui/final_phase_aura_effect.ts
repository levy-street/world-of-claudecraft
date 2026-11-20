// What the Masterless Strength's part-2 auras DO, for their buff/debuff hover
// tooltip (docs/design/tooltip-writing.md): the intermission's call and the
// final phase on the boss, its shield, its poured elements and its Masterless
// Fury; a rising Splinter's shield; and the players' marks (Bursting Coal,
// Wind-Tethered, a Quenching Ring's chill, Mounting Weight). A pure
// descriptor like final_aura_effect.ts (which calls this first): a
// hudChrome.auraEffect.finalBoss.* key plus the raw numbers, every number
// from the fight's one tuning table (src/sim/encounters/smith_heart/
// final_phase_ids.ts FINAL_PHASES, Normal's damage), the stage, the seconds,
// the stacks and the poured count off the aura itself. Pinned by
// tests/smith_heart_final_phase_ui.test.ts.

import { FINAL_DIFFICULTY, FINAL_TUNING as T } from '../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS as A,
  FINAL_PHASE_DIFFICULTY,
  finalStageOf,
  furyScale,
  MOUNTING_WEIGHT_AURA,
  FINAL_PHASES as P,
  pouredAuraId,
} from '../sim/encounters/smith_heart/final_phase_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';
import { tierRange, tierValue } from './heart_tier_damage';

const KEY = 'hudChrome.auraEffect.finalBoss';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);
/** Normal's damage factor (x1.15 since the parse-calibrated pass of 2026-11-16). */
const NM = FINAL_DIFFICULTY.normal.damageMult;
/** One tuned range's Heroic and Mythic resolved values under `<h>`/`<m>`. */
const tiers = (min: number, max: number, h = 'heroic', m = 'mythic'): Record<string, number> => ({
  ...tierRange(h, min, max, FINAL_DIFFICULTY.heroic.damageMult),
  ...tierRange(m, min, max, FINAL_DIFFICULTY.mythic.damageMult),
});

/** The part-2 aura's descriptor, or null when `a` is not one of them. */
export function finalPhaseAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case A.phase: {
      const stage = finalStageOf(a.value);
      if (stage === 'call' || stage === 'leap')
        return {
          key: `${KEY}.phaseCall`,
          nums: {
            seconds: P.callSeconds,
            every: P.splinterEvery,
            min: tierValue(P.splinterMin, NM),
            max: tierValue(P.splinterMax, NM),
            ...tiers(P.splinterMin, P.splinterMax),
            rise: pct(P.splinterRise),
          },
        };
      if (stage === 'kneel') return { key: `${KEY}.phaseKneel`, nums: {} };
      if (stage === 'rebirth')
        return { key: `${KEY}.phaseRebirth`, nums: { percent: pct(P.rebirthTo) } };
      if (stage === 'collapse')
        return {
          key: `${KEY}.unmade`,
          nums: { every: P.fallEvery, warn: P.fallWarn, ring: P.ringWarn },
        };
      if (stage === 'final' || stage === 'finalLeap')
        return {
          key: `${KEY}.phaseFinal`,
          nums: { pace: Math.round(T.finalPace * 100), enrage: P.enrageAfter },
        };
      return {
        key: `${KEY}.phaseFight`,
        nums: {
          first: pct(P.intermissionAt[0]),
          second: pct(P.intermissionAt[1]),
          final: pct(P.finalAt),
        },
      };
    }
    case A.hidden:
      return {
        key: `${KEY}.unmade`,
        nums: { every: P.fallEvery, warn: P.fallWarn, ring: P.ringWarn },
      };
    case A.shield:
    case A.rising:
      return { key: `${KEY}.shield`, nums: {} };
    case pouredAuraId('heat'):
      return { key: `${KEY}.pouredHeat`, nums: { every: T.whirlEvery } };
    case pouredAuraId('quench'):
      return { key: `${KEY}.pouredQuench`, nums: { every: T.bladeEvery } };
    case pouredAuraId('breath'):
      return { key: `${KEY}.pouredBreath`, nums: { every: T.skyEvery } };
    case pouredAuraId('hammer'):
      return { key: `${KEY}.pouredHammer`, nums: { every: T.pillarEvery } };
    case A.fury: {
      const stacks = Math.max(1, Math.round(a.value || a.stacks || 1));
      return {
        key: `${KEY}.fury`,
        nums: {
          every: P.furyEvery,
          min: tierValue(P.furyMin * furyScale(stacks), NM),
          max: tierValue(P.furyMax * furyScale(stacks), NM),
          ...tiers(P.furyMin * furyScale(stacks), P.furyMax * furyScale(stacks)),
          rise: pct(P.furyRise),
        },
      };
    }
    case A.coal:
      return {
        key: `${KEY}.coal`,
        nums: {
          seconds: P.coalSeconds,
          reach: P.coalReach,
          // On the others: a punishment, at the tier's punishMult (final_adds.ts).
          min: tierValue(P.coalMin, FINAL_DIFFICULTY.normal.punishMult),
          max: tierValue(P.coalMax, FINAL_DIFFICULTY.normal.punishMult),
          selfMin: tierValue(P.coalSelfMin, NM),
          selfMax: tierValue(P.coalSelfMax, NM),
          ...tierRange('heroic', P.coalMin, P.coalMax, FINAL_DIFFICULTY.heroic.punishMult),
          ...tierRange('mythic', P.coalMin, P.coalMax, FINAL_DIFFICULTY.mythic.punishMult),
          ...tiers(P.coalSelfMin, P.coalSelfMax, 'heroicSelf', 'mythicSelf'),
        },
      };
    case A.tether:
      return {
        key: `${KEY}.tether`,
        nums: {
          seconds: P.tetherSeconds,
          reach: P.buffetReach,
          min: tierValue(P.buffetMin, NM),
          max: tierValue(P.buffetMax, NM),
          ...tiers(P.buffetMin, P.buffetMax),
        },
      };
    case A.chill:
      return { key: `${KEY}.chill`, nums: { pct: pct(1 - P.chillSlow), seconds: P.chillSeconds } };
    case MOUNTING_WEIGHT_AURA: {
      const stacks = Math.max(1, Math.round(a.stacks ?? 1));
      return {
        key: `${KEY}.weight`,
        nums: {
          per: P.weightPerTick,
          total: P.weightPerTick * stacks,
          step: pct(FINAL_PHASE_DIFFICULTY.normal.weightStep),
          heroicStep: pct(FINAL_PHASE_DIFFICULTY.heroic.weightStep),
          mythicStep: pct(FINAL_PHASE_DIFFICULTY.mythic.weightStep),
          harder: pct(FINAL_PHASE_DIFFICULTY.normal.weightStep * stacks),
          swap: P.weightSwap,
          seconds: P.weightSeconds,
        },
      };
    }
    default:
      return null;
  }
}
