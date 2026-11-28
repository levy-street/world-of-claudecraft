// What the Masterless Strength's OWN elemental auras DO, for their buff/debuff
// hover tooltip (docs/design/tooltip-writing.md; Jose's brief of 2026-11-19
// (b)): Elemental Strike's four stacking tank debuffs and Frozen Solid, the
// boss's Elemental Fusion (one line per combo, read off the pair it carries),
// the Magma Rift mark and the four Opposing Elements marks. A pure descriptor
// like final_aura_effect.ts (which calls this first): a
// hudChrome.auraEffect.finalBoss.* key plus the raw numbers, every number from
// the fight's one table (src/sim/encounters/smith_heart/final_elements_ids.ts,
// Normal's numbers at Normal's damage factor, the harder tiers resolved
// beside them); the stacks and the live amounts come off the aura itself.
// Pinned by tests/smith_heart_final_elements_ui.test.ts.

import {
  ELEMENT_TUNING as E,
  ELEMENT_AURAS,
  ELEMENT_DIFFICULTY,
  type FusionCombo,
  fusionCombo,
  polarityOf,
  STRIKE_AURAS,
} from '../sim/encounters/smith_heart/final_elements_ids';
import { FINAL_DIFFICULTY, finalZoneOf } from '../sim/encounters/smith_heart/final_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';
import { tierRange, tierValue } from './heart_tier_damage';

const KEY = 'hudChrome.auraEffect.finalBoss';
const N = ELEMENT_DIFFICULTY.normal;
const H = ELEMENT_DIFFICULTY.heroic;
const M = ELEMENT_DIFFICULTY.mythic;
const NM = FINAL_DIFFICULTY.normal.damageMult;
const HM = FINAL_DIFFICULTY.heroic.damageMult;
const MM = FINAL_DIFFICULTY.mythic.damageMult;
const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** Elemental Strike's own hit at one stack on each tier, and its growth. */
function strikeNums(): Record<string, number> {
  return {
    every: E.strikeEvery,
    seconds: E.stackSeconds,
    swap: E.swapAt,
    min: tierValue(N.strikeMin, NM),
    max: tierValue(N.strikeMax, NM),
    growth: pct(N.strikeGrowth),
    heroicGrowth: pct(H.strikeGrowth),
    mythicGrowth: pct(M.strikeGrowth),
  };
}

const FUSION_KEYS: Readonly<Record<FusionCombo, string>> = {
  steam: 'fusionSteam',
  magma: 'fusionMagma',
  firestorm: 'fusionFirestorm',
  hail: 'fusionHail',
  avalanche: 'fusionAvalanche',
  spires: 'fusionSpires',
};

const POLARITY_KEYS = {
  fire: 'polarityFire',
  ice: 'polarityIce',
  earth: 'polarityEarth',
  lightning: 'polarityLightning',
} as const;

/** The elemental aura's descriptor, or null when `a` is not one of them. */
export function finalElementsAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  const stacks = Math.max(1, Math.round(a.stacks ?? 1));
  switch (a.id) {
    case STRIKE_AURAS.heat: {
      // The live burn rides the aura (its tier's factor in it); Normal's otherwise.
      const live = Math.round(a.value);
      const per = live > 0 ? Math.round(live / stacks) : tierValue(N.burnPerStack, NM);
      return {
        key: `${KEY}.strikeHeat`,
        nums: {
          ...strikeNums(),
          stacks,
          per,
          total: live > 0 ? live : per * stacks,
          heroicPer: tierValue(H.burnPerStack, HM),
          mythicPer: tierValue(M.burnPerStack, MM),
        },
      };
    }
    case STRIKE_AURAS.quench:
      return {
        key: `${KEY}.strikeQuench`,
        nums: {
          ...strikeNums(),
          stacks,
          pct: pct(1 - (a.value || 1 - N.frostSlowPerStack * stacks)),
          per: pct(N.frostSlowPerStack),
          cap: pct(E.frostSlowCap),
          freeze: E.freezeAt,
          frozen: E.freezeSeconds,
          radius: E.rimeR,
          warn: E.rimeWarn,
        },
      };
    case STRIKE_AURAS.breath:
      return {
        key: `${KEY}.strikeBreath`,
        nums: {
          ...strikeNums(),
          stacks,
          pct: pct(a.value || 0.03 * stacks),
          from: E.arcFrom,
          arcEvery: E.arcEvery,
          reach: E.arcReach,
          arcMin: tierValue(N.arcMin, NM),
          arcMax: tierValue(N.arcMax, NM),
          arcGrowth: pct(E.arcGrowth),
          ...tierRange('heroicArc', H.arcMin, H.arcMax, HM),
          ...tierRange('mythicArc', M.arcMin, M.arcMax, MM),
        },
      };
    case STRIKE_AURAS.hammer:
      return {
        key: `${KEY}.strikeHammer`,
        nums: {
          ...strikeNums(),
          stacks,
          pct: Math.min(pct(1 - E.armorFloor), pct(N.armorPerStack) * stacks),
          per: pct(N.armorPerStack),
          floor: pct(E.armorFloor),
          heroicPer: pct(H.armorPerStack),
          mythicPer: pct(M.armorPerStack),
        },
      };
    case ELEMENT_AURAS.frozen:
      return { key: `${KEY}.frozen`, nums: { seconds: E.freezeSeconds } };
    case ELEMENT_AURAS.rime:
      return {
        key: `${KEY}.rime`,
        nums: { seconds: E.rimeWarn, radius: E.rimeR, frozen: E.freezeSeconds },
      };
    case ELEMENT_AURAS.fusion: {
      const from = finalZoneOf(a.value);
      const to = finalZoneOf(a.value2 ?? 0);
      const combo = from !== 'ring' && to !== 'ring' ? fusionCombo(from, to) : null;
      return {
        key: `${KEY}.${combo ? FUSION_KEYS[combo] : 'fusionSteam'}`,
        nums: { seconds: E.fusionCast },
      };
    }
    case ELEMENT_AURAS.magmaMark:
      return {
        key: `${KEY}.magmaMark`,
        nums: {
          seconds: E.magmaMarkSeconds,
          radius: E.magmaR,
          life: E.lavaLife,
          min: tierValue(N.magmaMin, NM),
          max: tierValue(N.magmaMax, NM),
          poolMin: tierValue(N.lavaMin, NM),
          poolMax: tierValue(N.lavaMax, NM),
          ...tierRange('heroic', H.magmaMin, H.magmaMax, HM),
          ...tierRange('mythic', M.magmaMin, M.magmaMax, MM),
        },
      };
    case ELEMENT_AURAS.polarity:
      return {
        key: `${KEY}.${POLARITY_KEYS[polarityOf(a.value)]}`,
        nums: {
          meet: E.meetR,
          seconds: E.polaritySeconds,
          clash: E.clashR,
          min: tierValue(N.clashMin, NM),
          max: tierValue(N.clashMax, NM),
          lateMin: tierValue(N.unbalancedMin, NM),
          lateMax: tierValue(N.unbalancedMax, NM),
          ...tierRange('heroicLate', H.unbalancedMin, H.unbalancedMax, HM),
          ...tierRange('mythicLate', M.unbalancedMin, M.unbalancedMax, MM),
        },
      };
    default:
      return null;
  }
}
