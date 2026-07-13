// The 27 spec entries the balance simulator sweeps: one per SpecDef in the
// talent registry (9 classes x 3 specs). Data-as-code, adapted from the raid
// rotations proven in scripts/nythraxis_matrix.ts and extended with the PvP
// behaviors a duel needs (gap closers, interrupts, defensives, self healing).
// Talent BUILDS are not authored here: they are generated uniformly per spec by
// specBuild() (see builds.ts) so every spec gets the same methodology.
// tests/balance_sim_builds.test.ts pins every key, role, and ability id against
// the live content tables, so kit drift fails CI instead of silently skewing runs.

import type { PlayerClass } from '../../src/sim/types';

export type SpecKind = 'physical' | 'caster' | 'healer' | 'tank';

export interface BalanceSpec {
  key: string;
  cls: PlayerClass;
  // SpecDef id inside the class talent tree ('arms', 'fire', ...).
  specId: string;
  role: 'tank' | 'healer' | 'dps';
  kind: SpecKind;
  melee: boolean;
  // Self buffs cast once before the bout starts (resources are topped up after).
  prepull?: string[];
  // Gap closer tried while out of melee range but within its window.
  opener?: string;
  // Cast when the enemy is mid-cast.
  interrupt?: string;
  // Tried when own hp drops under half.
  defensives?: string[];
  // Damage priority, first castable wins the global.
  rotation: string[];
  // Healing priority; healers weave it on themselves in a duel and hybrids use
  // it as their emergency arm.
  healRotation?: string[];
  // Own-hp fraction under which healRotation takes priority over rotation.
  selfHealPct?: number;
}

export const SPEC_CATALOG: BalanceSpec[] = [
  // ===== WARRIOR =====
  {
    key: 'arms_warrior',
    cls: 'warrior',
    specId: 'arms',
    role: 'dps',
    kind: 'physical',
    melee: true,
    opener: 'charge',
    interrupt: 'pummel',
    rotation: [
      'battle_shout',
      'execute',
      'mortal_strike',
      'rend',
      'hamstring',
      'slam',
      'heroic_strike',
    ],
  },
  {
    key: 'fury_warrior',
    cls: 'warrior',
    specId: 'fury',
    role: 'dps',
    kind: 'physical',
    melee: true,
    opener: 'charge',
    interrupt: 'pummel',
    rotation: ['battle_shout', 'execute', 'bloodthirst', 'whirlwind', 'hamstring', 'heroic_strike'],
  },
  {
    key: 'protection_warrior',
    cls: 'warrior',
    specId: 'prot',
    role: 'tank',
    kind: 'tank',
    melee: true,
    opener: 'charge',
    interrupt: 'pummel',
    rotation: [
      'defensive_stance',
      'battle_shout',
      'shield_slam',
      'sunder_armor',
      'thunder_clap',
      'hamstring',
      'heroic_strike',
    ],
  },
  // ===== PALADIN =====
  {
    key: 'holy_paladin',
    cls: 'paladin',
    specId: 'holy',
    role: 'healer',
    kind: 'healer',
    melee: true,
    prepull: ['devotion_aura', 'blessing_of_might'],
    defensives: ['divine_protection'],
    rotation: ['seal_of_righteousness', 'judgement', 'exorcism', 'hammer_of_justice'],
    healRotation: ['flash_of_light', 'holy_light'],
    selfHealPct: 0.65,
  },
  {
    key: 'protection_paladin',
    cls: 'paladin',
    specId: 'protection',
    role: 'tank',
    kind: 'tank',
    melee: true,
    prepull: ['devotion_aura', 'righteous_fury'],
    defensives: ['divine_protection'],
    rotation: [
      'seal_of_righteousness',
      'judgement',
      'hammer_of_justice',
      'consecration',
      'exorcism',
    ],
    healRotation: ['holy_light'],
    selfHealPct: 0.45,
  },
  {
    key: 'retribution_paladin',
    cls: 'paladin',
    specId: 'retribution',
    role: 'dps',
    kind: 'physical',
    melee: true,
    prepull: ['retribution_aura', 'blessing_of_might'],
    defensives: ['divine_protection'],
    rotation: [
      'seal_of_righteousness',
      'judgement',
      'hammer_of_justice',
      'exorcism',
      'consecration',
    ],
    healRotation: ['flash_of_light', 'holy_light'],
    selfHealPct: 0.4,
  },
  // ===== HUNTER =====
  {
    key: 'marksmanship_hunter',
    cls: 'hunter',
    specId: 'marksmanship',
    role: 'dps',
    kind: 'physical',
    melee: false,
    interrupt: 'counter_shot',
    rotation: [
      'aspect_of_the_hawk',
      'rapid_fire',
      'concussive_shot',
      'serpent_sting',
      'aimed_shot',
      'arcane_shot',
    ],
  },
  {
    key: 'beast_mastery_hunter',
    cls: 'hunter',
    specId: 'beast_mastery',
    role: 'dps',
    kind: 'physical',
    melee: false,
    interrupt: 'counter_shot',
    rotation: [
      'aspect_of_the_hawk',
      'rapid_fire',
      'concussive_shot',
      'serpent_sting',
      'arcane_shot',
    ],
  },
  {
    key: 'survival_hunter',
    cls: 'hunter',
    specId: 'survival',
    role: 'dps',
    kind: 'physical',
    melee: false,
    interrupt: 'counter_shot',
    rotation: [
      'aspect_of_the_hawk',
      'rapid_fire',
      'concussive_shot',
      'serpent_sting',
      'arcane_shot',
    ],
  },
  // ===== ROGUE =====
  {
    key: 'combat_rogue',
    cls: 'rogue',
    specId: 'combat',
    role: 'dps',
    kind: 'physical',
    melee: true,
    opener: 'sprint',
    interrupt: 'kick',
    defensives: ['evasion'],
    rotation: ['instant_poison', 'adrenaline_rush', 'eviscerate', 'sinister_strike'],
  },
  {
    key: 'assassination_rogue',
    cls: 'rogue',
    specId: 'assassination',
    role: 'dps',
    kind: 'physical',
    melee: true,
    opener: 'sprint',
    interrupt: 'kick',
    defensives: ['evasion'],
    rotation: ['instant_poison', 'rupture', 'eviscerate', 'sinister_strike'],
  },
  {
    key: 'subtlety_rogue',
    cls: 'rogue',
    specId: 'subtlety',
    role: 'dps',
    kind: 'physical',
    melee: true,
    opener: 'sprint',
    interrupt: 'kick',
    defensives: ['evasion'],
    rotation: ['instant_poison', 'kidney_shot', 'eviscerate', 'sinister_strike'],
  },
  // ===== PRIEST =====
  {
    key: 'holy_priest',
    cls: 'priest',
    specId: 'holy',
    role: 'healer',
    kind: 'healer',
    melee: false,
    prepull: ['power_word_fortitude'],
    defensives: ['power_word_shield'],
    rotation: ['shadow_word_pain', 'smite'],
    healRotation: ['flash_heal', 'heal', 'renew', 'lesser_heal'],
    selfHealPct: 0.65,
  },
  {
    key: 'discipline_priest',
    cls: 'priest',
    specId: 'discipline',
    role: 'healer',
    kind: 'healer',
    melee: false,
    prepull: ['power_word_fortitude'],
    defensives: ['power_word_shield'],
    rotation: ['shadow_word_pain', 'smite'],
    healRotation: ['power_word_shield', 'flash_heal', 'heal', 'lesser_heal'],
    selfHealPct: 0.65,
  },
  {
    key: 'shadow_priest',
    cls: 'priest',
    specId: 'shadow',
    role: 'dps',
    kind: 'caster',
    melee: false,
    prepull: ['power_word_fortitude'],
    defensives: ['power_word_shield'],
    rotation: ['shadow_word_pain', 'mind_blast', 'mind_flay', 'smite'],
    healRotation: ['flash_heal', 'renew'],
    selfHealPct: 0.4,
  },
  // ===== SHAMAN =====
  {
    key: 'elemental_shaman',
    cls: 'shaman',
    specId: 'elemental',
    role: 'dps',
    kind: 'caster',
    melee: false,
    prepull: ['lightning_shield'],
    rotation: ['flame_shock', 'frost_shock', 'earth_shock', 'lightning_bolt'],
    healRotation: ['healing_wave'],
    selfHealPct: 0.4,
  },
  {
    key: 'enhancement_shaman',
    cls: 'shaman',
    specId: 'enhancement',
    role: 'dps',
    kind: 'physical',
    melee: true,
    prepull: ['rockbiter_weapon', 'lightning_shield'],
    rotation: ['stormstrike', 'flame_shock', 'frost_shock', 'earth_shock'],
    healRotation: ['healing_wave'],
    selfHealPct: 0.4,
  },
  {
    key: 'restoration_shaman',
    cls: 'shaman',
    specId: 'restoration',
    role: 'healer',
    kind: 'healer',
    melee: false,
    prepull: ['lightning_shield'],
    rotation: ['flame_shock', 'earth_shock', 'lightning_bolt'],
    healRotation: ['healing_wave'],
    selfHealPct: 0.65,
  },
  // ===== MAGE =====
  {
    key: 'fire_mage',
    cls: 'mage',
    specId: 'fire',
    role: 'dps',
    kind: 'caster',
    melee: false,
    prepull: ['arcane_intellect', 'frost_armor'],
    interrupt: 'counterspell',
    defensives: ['ice_barrier'],
    rotation: ['frost_nova', 'fire_blast', 'pyroblast', 'fireball', 'scorch'],
  },
  {
    key: 'frost_mage',
    cls: 'mage',
    specId: 'frost',
    role: 'dps',
    kind: 'caster',
    melee: false,
    prepull: ['arcane_intellect', 'frost_armor'],
    interrupt: 'counterspell',
    defensives: ['ice_barrier'],
    rotation: ['frost_nova', 'fire_blast', 'frostbolt'],
  },
  {
    key: 'arcane_mage',
    cls: 'mage',
    specId: 'arcane',
    role: 'dps',
    kind: 'caster',
    melee: false,
    prepull: ['arcane_intellect', 'frost_armor'],
    interrupt: 'counterspell',
    defensives: ['ice_barrier'],
    rotation: ['frost_nova', 'fire_blast', 'arcane_missiles'],
  },
  // ===== WARLOCK =====
  {
    key: 'destruction_warlock',
    cls: 'warlock',
    specId: 'destruction',
    role: 'dps',
    kind: 'caster',
    melee: false,
    prepull: ['demon_skin'],
    opener: 'fear',
    rotation: ['shadowburn', 'immolate', 'corruption', 'curse_of_agony', 'shadow_bolt'],
  },
  {
    key: 'affliction_warlock',
    cls: 'warlock',
    specId: 'affliction',
    role: 'dps',
    kind: 'caster',
    melee: false,
    prepull: ['demon_skin'],
    opener: 'fear',
    rotation: ['immolate', 'corruption', 'curse_of_agony', 'drain_life', 'shadow_bolt'],
  },
  {
    key: 'demonology_warlock',
    cls: 'warlock',
    specId: 'demonology',
    role: 'dps',
    kind: 'caster',
    melee: false,
    prepull: ['demon_skin'],
    opener: 'fear',
    rotation: ['immolate', 'corruption', 'curse_of_agony', 'shadow_bolt'],
  },
  // ===== DRUID =====
  {
    key: 'balance_druid',
    cls: 'druid',
    specId: 'balance',
    role: 'dps',
    kind: 'caster',
    melee: false,
    defensives: ['barkskin'],
    rotation: ['entangling_roots', 'moonfire', 'insect_swarm', 'starfire', 'wrath'],
    healRotation: ['regrowth', 'healing_touch'],
    selfHealPct: 0.4,
  },
  {
    // The feral SpecDef is the druid tank arm (bear), so the catalog plays it
    // as the raid matrix does: bear form, roar, maul, swipe.
    key: 'feral_druid',
    cls: 'druid',
    specId: 'feral',
    role: 'tank',
    kind: 'tank',
    melee: true,
    opener: 'feral_charge',
    defensives: ['barkskin'],
    rotation: ['bear_form', 'demoralizing_roar', 'maul', 'swipe'],
    healRotation: ['regrowth', 'healing_touch'],
    selfHealPct: 0.35,
  },
  {
    key: 'restoration_druid',
    cls: 'druid',
    specId: 'restoration',
    role: 'healer',
    kind: 'healer',
    melee: false,
    defensives: ['barkskin'],
    rotation: ['entangling_roots', 'moonfire', 'wrath'],
    healRotation: ['regrowth', 'rejuvenation', 'healing_touch'],
    selfHealPct: 0.65,
  },
];

export function specByKey(key: string): BalanceSpec | undefined {
  return SPEC_CATALOG.find((s) => s.key === key);
}
