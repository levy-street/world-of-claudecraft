// What the Smith's Heart's Masterless Strength's auras DO, for their
// buff/debuff hover tooltip (docs/design/tooltip-writing.md). A pure
// descriptor like the rest of aura_effect.ts (which calls this before the
// guardians'): it returns a hudChrome.auraEffect.finalBoss.* key plus the raw
// numbers, and the HUD formats them and renders t(key, values). The fight's
// state and marks ride quiet `internal_cd` markers (no stat at all), so each
// says its rule instead. Every number comes from the fight's tuning
// (src/sim/encounters/smith_heart/final_ids.ts), the same constants the sim
// reads (Normal's numbers, but the Overload burst's, which names all three
// tiers: survivable, heavy, lethal); the bar's fill, a stack count and the zone come
// off the aura itself. Pinned by tests/smith_heart_final_ui.test.ts.

import type { SmithHeartVein } from '../sim/content/smith_heart_layout';
import { HEART_FINAL_PHASE_SHARE } from '../sim/content/smith_heart_quarters';
import {
  FINAL_AURAS,
  FINAL_DIFFICULTY,
  finalZoneOf,
  FINAL_OVERLOAD as O,
  overloadAuraId,
  pulseScale,
  FINAL_TUNING as T,
} from '../sim/encounters/smith_heart/final_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';
import { finalPhaseAuraEffectDescriptor } from './final_phase_aura_effect';
import { tierRange, tierValue } from './heart_tier_damage';

const KEY = 'hudChrome.auraEffect.finalBoss';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);
/** Normal's damage factor (x1.15 since the parse-calibrated pass of 2026-11-16). */
const NM = FINAL_DIFFICULTY.normal.damageMult;
/** Heroic's and Mythic's damage factors (they differ on this fight). */
const HM = FINAL_DIFFICULTY.heroic.damageMult;
const MM = FINAL_DIFFICULTY.mythic.damageMult;
/** One tuned range's Heroic and Mythic resolved values (heroicMin..mythicMax). */
const tiers = (min: number, max: number): Record<string, number> => ({
  ...tierRange('heroic', min, max, HM),
  ...tierRange('mythic', min, max, MM),
});

const OVERLOAD_KEYS: Readonly<Record<string, string>> = {
  [overloadAuraId('heat')]: 'overloadHeat',
  [overloadAuraId('quench')]: 'overloadQuench',
  [overloadAuraId('breath')]: 'overloadBreath',
  [overloadAuraId('hammer')]: 'overloadHammer',
};

const STATE_KEYS: Readonly<Record<SmithHeartVein | 'ring', string>> = {
  heat: 'stateHeat',
  quench: 'stateQuench',
  breath: 'stateBreath',
  hammer: 'stateHammer',
  ring: 'stateRing',
};

function stateDescriptor(a: AuraEffectInput): AuraEffectDescriptor {
  const zone = finalZoneOf(a.value);
  return {
    key: `${KEY}.${STATE_KEYS[zone]}`,
    nums: {
      slow: pct(1 - T.numbingSlow),
      pace: pct(T.reducedPace),
      jump: T.boltJump,
      pct: pct(HEART_FINAL_PHASE_SHARE),
    },
  };
}

/** A full bar's pulse at the top of its roll on `tier` (before the tier's
 *  damage factor): the live pulseScale, the tier's own rise. */
function fullPulse(tier: keyof typeof FINAL_DIFFICULTY): number {
  return Math.round(O.pulseMax * pulseScale(1, FINAL_DIFFICULTY[tier].pulseRise));
}

/** The fight's aura's descriptor, or null when `a` is not one of them. */
export function finalAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  // Part 2 (the intermissions, the poured elements, the final phase).
  const phase = finalPhaseAuraEffectDescriptor(a);
  if (phase) return phase;
  const overload = a.id ? OVERLOAD_KEYS[a.id] : undefined;
  if (overload)
    return {
      key: `${KEY}.${overload}`,
      nums: {
        value: Math.max(0, Math.min(100, Math.round(a.value ?? 0))),
        fill: O.fillSeconds,
        every: O.pulseEvery,
        min: tierValue(O.pulseMin, NM),
        max: tierValue(fullPulse('normal'), NM),
        normalMin: O.burst.normal.min,
        normalMax: O.burst.normal.max,
        heroicMin: O.burst.heroic.min,
        heroicMax: O.burst.heroic.max,
        mythicMin: O.burst.mythic.min,
        mythicMax: O.burst.mythic.max,
        ...tierRange('heroicPulse', O.pulseMin, fullPulse('heroic'), HM),
        ...tierRange('mythicPulse', O.pulseMin, fullPulse('mythic'), MM),
      },
    };
  switch (a.id) {
    case FINAL_AURAS.state:
      return stateDescriptor(a);
    case FINAL_AURAS.unbound: {
      const stacks = Math.max(1, Math.round(a.stacks ?? a.value ?? 1));
      return {
        key: `${KEY}.unbound`,
        nums: {
          per: tierValue(T.unboundPerStack, NM),
          total: tierValue(T.unboundPerStack, NM) * stacks,
          heroicPer: tierValue(T.unboundPerStack, HM),
          mythicPer: tierValue(T.unboundPerStack, MM),
        },
      };
    }
    case FINAL_AURAS.shaken:
      return {
        key: `${KEY}.shaken`,
        nums: {
          mult: T.shakenMult,
          min: T.shockMin * T.shakenMult,
          max: T.shockMax * T.shakenMult,
          baseMin: T.shockMin,
          baseMax: T.shockMax,
          seconds: T.shakenSeconds,
          ...tiers(T.shockMin * T.shakenMult, T.shockMax * T.shakenMult),
        },
      };
    case FINAL_AURAS.underIce:
      return { key: `${KEY}.underIce`, nums: {} };
    case FINAL_AURAS.numbing:
      return {
        key: `${KEY}.numbing`,
        nums: { pct: pct(1 - T.numbingSlow), seconds: T.numbingSeconds },
      };
    case FINAL_AURAS.ember:
      return {
        key: `${KEY}.ember`,
        nums: {
          seconds: T.emberSeconds,
          life: T.emberLife,
          radius: T.emberR,
          min: T.emberMin,
          max: T.emberMax,
          ...tiers(T.emberMin, T.emberMax),
        },
      };
    case FINAL_AURAS.drawn:
      return {
        key: `${KEY}.drawn`,
        nums: {
          seconds: T.drawnSeconds,
          reach: T.drawnReach,
          min: T.drawnMin,
          max: T.drawnMax,
          ...tiers(T.drawnMin, T.drawnMax),
        },
      };
    case FINAL_AURAS.shell:
      return { key: `${KEY}.shell`, nums: { value: Math.round(a.value ?? T.shellAbsorb) } };
    case FINAL_AURAS.crushed:
      return { key: `${KEY}.crushed`, nums: { seconds: T.crushedSeconds, mult: T.crushedMult } };
    case FINAL_AURAS.skyMark:
      return {
        key: `${KEY}.skyMark`,
        nums: {
          radius: T.skyR,
          seconds: T.skyWarn,
          min: tierValue(T.skyMin, NM),
          max: tierValue(T.skyMax, NM),
          arcReach: T.arcReach,
          ...tiers(T.skyMin, T.skyMax),
        },
      };
    case FINAL_AURAS.anvilMark: {
      const total = (t: 'normal' | 'heroic' | 'mythic') =>
        Math.round(FINAL_DIFFICULTY[t].anvilTotal * FINAL_DIFFICULTY[t].punishMult);
      return {
        key: `${KEY}.anvilMark`,
        nums: {
          radius: T.anvilR,
          lock: T.anvilLock,
          total: total('normal'),
          fewer: T.anvilMinSoakers,
          heroicTotal: total('heroic'),
          mythicTotal: total('mythic'),
        },
      };
    }
    case FINAL_AURAS.bladeMark:
      return {
        key: `${KEY}.bladeMark`,
        nums: {
          lock: T.bladeLock,
          min: tierValue(T.bladeMin, NM),
          max: tierValue(T.bladeMax, NM),
          ...tiers(T.bladeMin, T.bladeMax),
        },
      };
    default:
      return null;
  }
}
