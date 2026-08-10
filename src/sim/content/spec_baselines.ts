// v0.28 hotfix: restore the passive power from the pre-v0.27 level-20 raid
// reference allocations as a full-strength specialization baseline. These
// effects are intentionally separate from mastery and choice rows so class
// owners can rebalance and redesign each spec without deleting the hotfix floor.
//
// Paladin, Warrior, and Mage are deliberately excluded. Paladin now owns a
// complete class-specific kit and mastery layer, so retaining its legacy floor
// would double-apply specialization power. Warrior and Mage remain excluded for
// the original hotfix balance reasons. Mage also has no Chronomancy baseline
// (new healer kit, no former baseline to restore).

import type { PlayerClass } from '../types';
import type { TalentEffect } from './talents';

export type SpecBaselineTable = Partial<Record<PlayerClass, Record<string, TalentEffect>>>;

export const SPEC_BASELINES: SpecBaselineTable = {
  // Paladin is absent by design, alongside Warrior and Mage: an overhauled class
  // carries its passive floor on its spec mastery, not here. Faithwarden's
  // Oathward owns the 2026-07 tank-parity stamina multiplier (see
  // talents_classic.ts); the threat and armor the old baseline granted are
  // already covered, and larger, by that mastery plus Burning Oath.
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
        { ability: 'aimed_shot', dmgPct: 0.5, castPct: -0.2 },
        { ability: 'concussive_shot', cooldownPct: -0.1 },
      ],
    },
    survival: {
      // 2026-08 120s band round: the raise rides apPct, not agiPct, on
      // purpose. apPct feeds only the two Attack Power lines (melee and
      // hunter ranged); agiPct would also lift the Agility-derived armor,
      // dodge, and crit on the spec that already dodges the most. The
      // deep-equal pin in spec_baselines.test.ts guards the damage-only
      // shape. Both arms are relatively level-invariant, an accepted
      // remainder for the hunter kit-item pass alongside Marksmanship.
      stats: { agi: 3, crit: 0.03, dodge: 0.12, apPct: 0.15 },
      global: { meleeDmgPct: 0.3 },
    },
  },
  // v0.34 rogue base re-band: with the Thronebane hand fix removing the legendary
  // the rogue kit was tuned around, all three specs collapsed to the bottom of the
  // zero-legendary balance table (Combat 132, Assassination 139, Subtlety 147 at
  // 60s, the class 45 DPS below the median: nythraxis-class-balance-monte-carlo.md).
  // This lifts the BiS-epic (no-legendary) floor of each spec to ~200 DPS. The kit
  // is auto-attack heavy (54 to 73% of damage on the competent rotation), so the
  // lift leans on Attack Power (apPct) and crit, which scale the white swings the
  // per-ability and meleeDmgPct rows never touch; meleeDmgPct tops up the builder
  // and finisher share. The legendary itself is not touched here (separate PR).
  rogue: {
    assassination: {
      stats: { crit: 0.12, apPct: 0.36 },
      global: { meleeDmgPct: 0.22 },
      ability: [
        { ability: 'sinister_strike', costPct: -0.16 },
        { ability: 'eviscerate', dmgPct: 0.32 },
      ],
    },
    combat: {
      stats: { ap: 24, crit: 0.14, apPct: 0.55 },
      global: { meleeDmgPct: 0.36 },
      ability: [{ ability: 'sinister_strike', dmgPct: 0.2, costPct: -0.16 }],
    },
    subtlety: {
      stats: { agi: 7, crit: 0.1, dodge: 0.05, apPct: 0.12 },
      global: { meleeDmgPct: 0.08 },
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
        { ability: 'heal', dmgPct: 0.18, costPct: -0.3, castPct: -0.2 },
        { ability: 'flash_heal', costPct: -0.16 },
        { ability: 'prayer_of_healing', costPct: -0.15 },
        { ability: 'smite', castPct: -0.1 },
      ],
    },
    shadow: {
      // v0.28.x stat-identity pass: shadow is a DPS caster, so its flat stat is
      // Int (spell power), not the combat-dead Spirit it inherited.
      // 2026-08-09 120s band round: the three ability rows step down again
      // (0.3/0.34/0.4 to 0.2/0.2/0.15, with the vespers.ts multipliers) so the
      // 120s BiS Monte Carlo lands inside the 150-200 band instead of 215.
      stats: { int: 6 },
      global: { spellDmgPct: 0.15 },
      ability: [
        { ability: 'shadow_word_pain', dmgPct: 0.2, costPct: -0.1 },
        { ability: 'mind_blast', dmgPct: 0.2, costPct: -0.1 },
        { ability: 'mind_flay', dmgPct: 0.15 },
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
      stats: { int: 2, ap: 24, apPct: 0.22 },
      ability: [
        { ability: 'lightning_bolt', costPct: -0.2 },
        { ability: 'earth_shock', costPct: -0.2 },
        { ability: 'flame_shock', costPct: -0.2 },
        { ability: 'rockbiter_weapon', dmgPct: 0.4 },
        { ability: 'stormstrike', dmgPct: 0.8 },
      ],
    },
    restoration: {
      stats: { int: 6 },
      ability: [{ ability: 'healing_wave', dmgPct: 0.1, costPct: -0.46, castPct: -0.1 }],
    },
  },
  warlock: {
    affliction: {
      stats: { int: 6 },
      ability: [
        { ability: 'needle_of_fate', dmgPct: 0.08, costPct: -0.08 },
        { ability: 'drain_life', costPct: -0.08 },
      ],
    },
    demonology: {
      // v0.28.x stat-identity pass: trimmed the oversized self-stamina (was Sta
      // +15, Sta +8%, Armor +6%). Demonology stays bulky but gains its damage
      // stat. Pet armour/health is not a modifier the engine exposes (only pet
      // damage), so that direction would be a separate feature, not this pass.
      stats: { sta: 8, armorPct: 0.06, int: 6 },
      ability: [
        { ability: 'soul_harvest', costPct: -0.08, dmgPct: 0.08 },
        { ability: 'bone_armor', costPct: -0.08 },
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
      // staPct 0.25 (2026-07 tank parity, with Sloth Form armor 1.9 -> 2.3):
      // leather has no plate tier to grow into, so the form multiplier and
      // the baseline carry the difference (the Dire Bear logic).
      stats: { armorPct: 0.23, staPct: 0.25 },
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
