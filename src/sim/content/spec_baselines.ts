// v0.28 hotfix: restore the passive power from the pre-v0.27 level-20 raid
// reference allocations as a full-strength specialization baseline. These
// effects are intentionally separate from mastery and choice rows so class
// owners can rebalance and redesign each spec without deleting the hotfix floor.
//
// Warrior and Mage are deliberately excluded. The floor exists to close the gap
// for the classes weakened by the Talents 2.0 transition; warrior and mage are
// already the two strongest classes, so restoring their pre-v0.27 passives would
// widen the gap this hotfix is meant to close. Their masteries, signatures, and
// ability kits are untouched, only the restored baseline is withheld. Mage also
// has no Chronomancy baseline (new healer kit, no former baseline to restore).

import type { PlayerClass } from '../types';
import type { TalentEffect } from './talents';

export type SpecBaselineTable = Partial<Record<PlayerClass, Record<string, TalentEffect>>>;

export const SPEC_BASELINES: SpecBaselineTable = {
  paladin: {
    holy: {
      // v0.28.x stat-identity pass: healer scales on Int, not Str.
      stats: { int: 6 },
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
      // v0.28.x stat-identity pass: de-overloaded. Was Sta +9, AP +32, Armor
      // +12%, Max HP +8% (top-of-table AP plus a redundant double-HP pile).
      stats: { ap: 24, armorPct: 0.08 },
      ability: [{ ability: 'aspect_of_the_hawk', buffPct: 0.4 }],
    },
    marksmanship: {
      // v0.28.x stat-identity pass: thin baseline; add the primary (Agi).
      stats: { crit: 0.03, agi: 6 },
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
      // v0.28.x stat-identity pass: shadow is a DPS caster, so its flat stat is
      // Int (spell power), not the combat-dead Spirit it inherited.
      stats: { int: 6 },
      ability: [
        { ability: 'shadow_word_pain', dmgPct: 0.24, costPct: -0.1 },
        { ability: 'mind_blast', dmgPct: 0.18, costPct: -0.1 },
      ],
    },
  },
  shaman: {
    elemental: {
      // v0.28.x stat-identity pass: Int is the caster primary and must exceed
      // the melee (Enhancement) and healer (Restoration) shaman specs.
      stats: { int: 8 },
      ability: [
        { ability: 'lightning_bolt', dmgPct: 0.18, costPct: -0.35, castPct: -0.2 },
        { ability: 'earth_shock', dmgPct: 0.18, costPct: -0.15 },
        { ability: 'flame_shock', costPct: -0.2 },
      ],
    },
    enhancement: {
      // v0.28.x stat-identity pass: Enhancement primary is Strength, so its Int
      // stays below Elemental's; melee AP is retained.
      stats: { int: 2, ap: 24 },
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
  warlock: {
    affliction: {
      // v0.28.x stat-identity pass: +2% was the lowest baseline on the table and
      // it carried no flat stat. Lift to peer level and add the primary (Int).
      stats: { int: 6 },
      global: { spellDmgPct: 0.06 },
      ability: [
        { ability: 'corruption', dmgPct: 0.16, costPct: -0.15, castPct: -0.7 },
        { ability: 'curse_of_agony', dmgPct: 0.09, costPct: -0.15 },
      ],
    },
    demonology: {
      // v0.28.x stat-identity pass: trimmed the oversized self-stamina (was Sta
      // +15, Sta +8%, Armor +6%). Demonology stays bulky but gains its damage
      // stat. Pet armour/health is not a modifier the engine exposes (only pet
      // damage), so that direction would be a separate feature, not this pass.
      stats: { sta: 8, armorPct: 0.06, int: 6 },
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
      // v0.28.x stat-identity pass: Spirit is out-of-combat regen only (dead in
      // combat); Int is the balance caster's throughput.
      stats: { int: 3 },
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
      // v0.28.x stat-identity pass: add Int for healing throughput; keep some
      // Spirit for mana longevity (acceptable on a healer, unlike a DPS).
      stats: { int: 3, spi: 3 },
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
