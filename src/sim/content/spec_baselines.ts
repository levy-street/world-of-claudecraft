// v0.28 hotfix: restore the passive power from the pre-v0.27 level-20 raid
// reference allocations as a full-strength specialization baseline. These
// effects are intentionally separate from mastery and choice rows so class
// owners can rebalance and redesign each spec without deleting the hotfix floor.

import type { PlayerClass } from '../types';
import type { TalentEffect } from './talents';

export type SpecBaselineTable = Partial<Record<PlayerClass, Record<string, TalentEffect>>>;

export const SPEC_BASELINES: SpecBaselineTable = {
  warrior: {
    arms: {
      stats: { armorPct: 0.12, apPct: 0.12 },
      ability: [{ ability: 'overpower', dmgPct: 0.5 }],
    },
    fury: {
      stats: { ap: 10, crit: 0.03, apPct: 0.12, armorPct: 0.12 },
    },
    prot: {
      stats: { apPct: 0.12, armorPct: 0.27 },
      ability: [{ ability: 'thunder_clap', dmgPct: 0.3, costPct: -0.5 }],
    },
  },
  paladin: {
    holy: {
      stats: { str: 6 },
      global: { healPct: 0.06 },
      ability: [
        { ability: 'seal_of_righteousness', costPct: -0.16 },
        { ability: 'judgement', costPct: -0.16 },
        { ability: 'holy_light', dmgPct: 0.24 },
        { ability: 'flash_of_light', costPct: -0.16, castPct: -0.2 },
      ],
    },
    protection: {
      stats: { str: 6, dodge: 0.02, armorPct: 0.29 },
      global: { threatPct: 0.2 },
      ability: [
        { ability: 'devotion_aura', buffPct: 0.4 },
        { ability: 'righteous_fury', costPct: -0.5 },
      ],
    },
    retribution: {
      stats: { str: 6 },
      ability: [
        { ability: 'seal_of_righteousness', dmgPct: 0.2, costPct: -0.4 },
        { ability: 'judgement', dmgPct: 0.2, costPct: -0.4, cooldownPct: -0.3 },
      ],
    },
  },
  hunter: {
    beast_mastery: {
      stats: { sta: 9, ap: 32, armorPct: 0.12, maxHpPct: 0.08 },
      ability: [{ ability: 'aspect_of_the_hawk', buffPct: 0.4 }],
    },
    marksmanship: {
      stats: { crit: 0.03 },
      ability: [
        { ability: 'arcane_shot', dmgPct: 0.24, costPct: -0.16, cooldownPct: -0.1 },
        { ability: 'serpent_sting', costPct: -0.16 },
        { ability: 'aimed_shot', dmgPct: 0.16, castPct: -0.2 },
        { ability: 'concussive_shot', cooldownPct: -0.1 },
      ],
    },
    survival: {
      stats: { agi: 3, crit: 0.03, dodge: 0.12 },
      global: { meleeDmgPct: 0.06 },
    },
  },
  rogue: {
    assassination: {
      stats: { crit: 0.03 },
      global: { meleeDmgPct: 0.08 },
      ability: [
        { ability: 'sinister_strike', costPct: -0.16 },
        { ability: 'eviscerate', dmgPct: 0.32 },
      ],
    },
    combat: {
      stats: { ap: 24, crit: 0.03 },
      global: { meleeDmgPct: 0.08 },
      ability: [{ ability: 'sinister_strike', dmgPct: 0.2, costPct: -0.16 }],
    },
    subtlety: {
      stats: { agi: 7, crit: 0.03, dodge: 0.05 },
      ability: [
        { ability: 'stealth', cooldownPct: -0.7 },
        { ability: 'backstab', dmgPct: 0.16 },
        { ability: 'ambush', dmgPct: 0.16 },
      ],
    },
  },
  priest: {
    discipline: {
      stats: { sta: 6, int: 3, spi: 6 },
      ability: [
        { ability: 'lesser_heal', costPct: -0.16 },
        { ability: 'heal', costPct: -0.16 },
        { ability: 'flash_heal', costPct: -0.16 },
        { ability: 'power_word_shield', dmgPct: 0.18, costPct: -0.16, cooldownPct: -0.3 },
      ],
    },
    holy: {
      stats: { int: 3, spi: 3 },
      global: { healPct: 0.08 },
      ability: [
        { ability: 'lesser_heal', dmgPct: 0.18, costPct: -0.16 },
        { ability: 'heal', dmgPct: 0.18, costPct: -0.16, castPct: -0.2 },
        { ability: 'flash_heal', costPct: -0.16 },
        { ability: 'smite', castPct: -0.1 },
      ],
    },
    shadow: {
      stats: { spi: 9 },
      ability: [
        { ability: 'shadow_word_pain', dmgPct: 0.24, costPct: -0.1 },
        { ability: 'mind_blast', dmgPct: 0.18, costPct: -0.1 },
      ],
    },
  },
  shaman: {
    elemental: {
      stats: { int: 4 },
      ability: [
        { ability: 'lightning_bolt', dmgPct: 0.18, costPct: -0.35, castPct: -0.2 },
        { ability: 'earth_shock', dmgPct: 0.18, costPct: -0.15 },
        { ability: 'flame_shock', costPct: -0.2 },
      ],
    },
    enhancement: {
      stats: { int: 6, ap: 24 },
      ability: [
        { ability: 'lightning_bolt', costPct: -0.1 },
        { ability: 'earth_shock', costPct: -0.1 },
        { ability: 'rockbiter_weapon', dmgPct: 0.4 },
        { ability: 'stormstrike', dmgPct: 0.25 },
      ],
    },
    restoration: {
      stats: { int: 6 },
      ability: [{ ability: 'healing_wave', dmgPct: 0.1, costPct: -0.46, castPct: -0.1 }],
    },
  },
  mage: {
    fire: {
      global: { spellDmgPct: 0.06 },
      ability: [
        { ability: 'fireball', dmgPct: 0.15, costPct: -0.12, castPct: -0.12 },
        { ability: 'frostbolt', costPct: -0.12 },
        { ability: 'fire_blast', dmgPct: 0.24 },
        { ability: 'scorch', dmgPct: 0.54 },
      ],
    },
    frost: {
      stats: { int: 2, crit: 0.04, dodge: 0.02, armorPct: 0.1 },
      ability: [
        { ability: 'frostbolt', dmgPct: 0.15, costPct: -0.12, castPct: -0.12 },
        { ability: 'fireball', costPct: -0.12 },
      ],
    },
  },
  warlock: {
    affliction: {
      global: { spellDmgPct: 0.02 },
      ability: [
        { ability: 'corruption', dmgPct: 0.16, costPct: -0.15, castPct: -0.7 },
        { ability: 'curse_of_agony', dmgPct: 0.09, costPct: -0.15 },
      ],
    },
    demonology: {
      stats: { sta: 15, staPct: 0.08, armorPct: 0.06 },
      ability: [
        { ability: 'shadow_bolt', costPct: -0.08 },
        { ability: 'immolate', costPct: -0.08 },
        { ability: 'demon_skin', dmgPct: 0.3 },
      ],
    },
    destruction: {
      stats: { sta: 6 },
      ability: [
        { ability: 'shadow_bolt', costPct: -0.23, castPct: -0.03 },
        { ability: 'immolate', costPct: -0.23, castPct: -0.03 },
      ],
    },
  },
  druid: {
    balance: {
      stats: { spi: 3 },
      global: { spellDmgPct: 0.08 },
      ability: [
        { ability: 'entangling_roots', costPct: -0.18, castPct: -0.24 },
        { ability: 'healing_touch', castPct: -0.16 },
        { ability: 'wrath', dmgPct: 0.15, castPct: -0.2 },
        { ability: 'starfire', castPct: -0.16 },
      ],
    },
    feral: {
      stats: { armorPct: 0.23 },
      global: { threatPct: 0.2 },
      ability: [
        { ability: 'maul', dmgPct: 0.35 },
        { ability: 'claw', dmgPct: 0.15 },
        { ability: 'swipe', dmgPct: 0.2 },
      ],
    },
    restoration: {
      stats: { spi: 3 },
      global: { healPct: 0.08 },
      ability: [
        { ability: 'entangling_roots', costPct: -0.18 },
        { ability: 'healing_touch', costPct: -0.2, castPct: -0.16 },
        { ability: 'wrath', castPct: -0.08 },
        { ability: 'rejuvenation', dmgPct: 0.24, costPct: -0.2 },
      ],
    },
  },
};

export function specBaselineFor(cls: PlayerClass, specId: string): TalentEffect | undefined {
  return SPEC_BASELINES[cls]?.[specId];
}
