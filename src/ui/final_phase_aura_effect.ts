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

import { FINAL_TUNING as T } from '../sim/encounters/smith_heart/final_ids';
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

const KEY = 'hudChrome.auraEffect.finalBoss';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** The part-2 aura's descriptor, or null when `a` is not one of them. */
export function finalPhaseAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  const times = Math.max(1, Math.round(a.value || a.stacks || 1));
  switch (a.id) {
    case A.phase: {
      const stage = finalStageOf(a.value);
      if (stage === 'call' || stage === 'leap')
        return {
          key: `${KEY}.phaseCall`,
          nums: {
            seconds: P.callSeconds,
            every: P.splinterEvery,
            min: P.splinterMin,
            max: P.splinterMax,
            rise: pct(P.splinterRise),
          },
        };
      if (stage === 'final' || stage === 'finalLeap')
        return {
          key: `${KEY}.phaseFinal`,
          nums: { every: P.mixEvery, enrage: P.enrageAfter },
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
    case A.shield:
    case A.rising:
      return { key: `${KEY}.shield`, nums: {} };
    case pouredAuraId('heat'):
      return {
        key: `${KEY}.pouredHeat`,
        nums: { every: Math.round(P.pouredHeatEvery / times), times },
      };
    case pouredAuraId('quench'):
      return {
        key: `${KEY}.pouredQuench`,
        nums: {
          share: pct(Math.min(1, P.pouredColdShare * times)),
          allies: T.coldAllies,
          reach: T.coldReach,
          times,
        },
      };
    case pouredAuraId('breath'):
      return {
        key: `${KEY}.pouredBreath`,
        nums: { every: Math.round(P.pouredBreathEvery / times), jump: T.boltJump, times },
      };
    case pouredAuraId('hammer'):
      return {
        key: `${KEY}.pouredHammer`,
        nums: { every: Math.round(P.pouredHammerEvery / times), times },
      };
    case A.fury: {
      const stacks = Math.max(1, Math.round(a.value || a.stacks || 1));
      return {
        key: `${KEY}.fury`,
        nums: {
          every: P.furyEvery,
          min: Math.round(P.furyMin * furyScale(stacks)),
          max: Math.round(P.furyMax * furyScale(stacks)),
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
          min: P.coalMin,
          max: P.coalMax,
          selfMin: P.coalSelfMin,
          selfMax: P.coalSelfMax,
        },
      };
    case A.tether:
      return {
        key: `${KEY}.tether`,
        nums: {
          seconds: P.tetherSeconds,
          reach: P.buffetReach,
          min: P.buffetMin,
          max: P.buffetMax,
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
