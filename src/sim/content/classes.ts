import { resolveTalentHitMult } from '../talent_hit_mult';
import {
  type AbilityDef,
  type AbilityEffect,
  type AuraKind,
  type CoreStats,
  type PlayerClass,
  TEMPORAL_HOURGLASS_ALLY_COOLDOWN_RATE,
  TEMPORAL_HOURGLASS_CAPTURE_RADIUS,
  TEMPORAL_HOURGLASS_DURATION,
  TEMPORAL_HOURGLASS_GROUND_DURATION,
  TEMPORAL_HOURGLASS_HEAL_FRACTION,
  TEMPORAL_HOURGLASS_HOSTILE_PVE_DURATION,
  TEMPORAL_HOURGLASS_HOSTILE_PVP_DURATION,
  TEMPORAL_HOURGLASS_SELF_COOLDOWN_RATE,
  TEMPORAL_HOURGLASS_SELF_RADIUS,
  type WeaponInfo,
} from '../types';
import { PALADIN_CORE_ABILITIES } from './paladin_core_abilities';
import { PRIEST_ABILITIES } from './priest';
import { MENDING_WATERS_MANA_COST, TIDECALL_MANA_COST } from './shaman_tuning';
import { TALENT_ABILITIES_V2 } from './talent_abilities_v2';
import type { TalentModifiers } from './talents';
import { SPORT_ABILITIES } from './vale_cup';

// ---------------------------------------------------------------------------
// Player classes — per-level base stats follow classic-era growth curves.
// HP/mana rules are the real ones: first 20 stamina gives 1 hp each, the rest
// 10 hp each; first 20 intellect gives 1 mana each, the rest 15 mana each.
// ---------------------------------------------------------------------------

export interface ClassDef {
  id: PlayerClass;
  name: string;
  baseStats: CoreStats;
  statsPerLevel: CoreStats;
  baseHp: number; // class hp before stamina at level 1
  hpPerLevel: number;
  baseMana: number;
  manaPerLevel: number;
  resourceType: 'rage' | 'mana' | 'energy' | 'focus';
  startWeapon: string;
  startOffhand?: string;
  startChest: string;
  // Consumables in a fresh character's bags: every class carries food; the
  // mana classes also carry water. Saved characters load their own bags.
  startItems: { itemId: string; count: number }[];
  // hunters: auto shot (8yd deadzone). casters: wand (wand:true → no deadzone,
  // fires a magic-school bolt so they don't run into melee to auto-attack, #94)
  ranged?: WeaponInfo & {
    maxRange: number;
    minRange: number;
    wand?: boolean;
    school?: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
  };
  abilities: string[]; // full kit, in learn order
  color: number;
}

// Starter rations (#food-and-drink): 5 loaves for everyone, plus 5 waters for
// the classes that drink to restore mana (rage/energy classes carry bread only).
const START_RATIONS = [{ itemId: 'baked_bread', count: 5 }];
const START_RATIONS_MANA = [
  { itemId: 'baked_bread', count: 5 },
  { itemId: 'spring_water', count: 5 },
];

export const CLASSES: Record<PlayerClass, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    baseStats: { str: 23, agi: 20, sta: 22, int: 10, spi: 11, armor: 50 },
    statsPerLevel: { str: 2, agi: 1, sta: 2, int: 0, spi: 0, armor: 12 },
    baseHp: 50,
    hpPerLevel: 18,
    baseMana: 100, // rage cap
    manaPerLevel: 0,
    resourceType: 'rage',
    startWeapon: 'worn_sword',
    startOffhand: 'eastbrook_buckler',
    startChest: 'recruit_tunic',
    startItems: START_RATIONS,
    abilities: [
      'heroic_strike',
      'revenge',
      'battle_shout',
      'charge',
      'thunder_clap',
      'hamstring',
      'bloodrage',
      'overpower',
      'raging_gale',
      'raised_guard',
      'pummel',
      // Seething Fury: authored as a plain L10 active (def below) but orphaned
      // when the v2 talent integration deleted the v1 class-tree grant
      // (war_berserker_rage) without re-homing it - abilitiesKnownAt could
      // never return it (owner report: unfindable on a live L20 warrior).
      'berserker_rage',
      'execute',
      'furious_mending',
      'iron_resolve',
      'slam',
      'red_harvest',
      'whirlwind',
      'faultline',
      'heroic_leap',
      'cleave',
      'rallying_cry',
      'emboldening_roar',
      'defiant_bellow',
      'battle_stance',
      'berserker_stance',
      'defensive_stance',
      'demoralizing_shout',
      'intimidating_shout',
      'sunder_armor',
      'taunt',
      'measured_fury',
      'seasoned_soldier',
      'sudden_death',
      'diabolical_twinstrike',
      'cleaving_blows',
      'breachmaker',
      // Arms restructure 2026-07-08: a cleave window and the Deep Wounds bleed
      // passive (replacing the retired Deep Gash). Die by the Sword is row-granted.
      'sweeping_strikes',
      'deep_wounds',
      'enrage_passive',
    ],
    color: 0xd67a54,
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    baseStats: { str: 10, agi: 12, sta: 14, int: 24, spi: 22, armor: 25 },
    statsPerLevel: { str: 0, agi: 0, sta: 1, int: 3, spi: 2, armor: 4 },
    baseHp: 40,
    hpPerLevel: 12,
    baseMana: 100,
    manaPerLevel: 24,
    resourceType: 'mana',
    startWeapon: 'gnarled_staff',
    startChest: 'apprentice_robe',
    startItems: START_RATIONS_MANA,
    ranged: {
      min: 3,
      max: 6,
      speed: 1.8,
      maxRange: 30,
      minRange: 0,
      wand: true,
      school: 'arcane',
    },
    abilities: [
      'fireball',
      'frost_armor',
      'arcane_intellect',
      'frostbolt',
      'conjure_water',
      // Blink joins the BASE kit at 5 (owner core-kit decision 2026-07-11):
      // two level-5 choice-row options modify it, so it can no longer live
      // behind a row grant of its own.
      'blink',
      // Ice Block joins the BASE kit (owner 2026-07-13): a key mage escape/immunity
      // every spec gets. No specs gate; Frost carries a second charge (resolvedAbility).
      'ice_block',
      // Fire spec kit (owner design 2026-07-11, `specs: ['fire']` gated):
      // the Ignition mastery + Hot Streak passives at the pick, Blazing
      // Barrier at 10, Meteor at 17. Phoenix Trance is the shared signature slot.
      'ignition',
      'hot_streak',
      'blazing_barrier',
      'meteor',
      'combustion',
      // Frost spec kit (owner design 2026-07-11, `specs: ['frost']` gated):
      // Ice Lance + its three spec passives at the spec pick, Winterlash at 8,
      // the Water Elemental at 12.
      'summon_water_elemental',
      'ice_lance',
      'fingers_of_frost',
      'brain_freeze',
      'shatter',
      'conjure_food',
      'counterspell',
      'fire_blast',
      'arcane_missiles',
      'flurry',
      'polymorph',
      'frost_nova',
      'frozen_orb',
      'blizzard',
      'icy_veins',
      'glacial_spike',
      'glacial_front',
      'dragons_breath',
      'arcane_explosion',
      'scorch',
      'ice_barrier',
      'pyroblast',
      'flamestrike',
      // Chronomancy healer kit (docs/prd/mage-chronomancy.md, `specs: ['arcane']`
      // gated): the single-target shield (Phase 1) and Temporal Echo (Phase 2, the
      // Arcane-damage-to-healing mark). Temporal Mend is the spec signature,
      // granted at the pick like Phoenix Trance.
      'temporal_barrier',
      'temporal_echo',
      // Phase 3: the single-target Arcane spender (charges) that drives the
      // offensive heal rotation (docs/prd/mage-chronomancy.md sections 13.4 / 14).
      'arcane_surge',
      // Phase 4: the group version of Temporal Echo (marks up to five allies with a
      // reduced group echo), docs/prd/mage-chronomancy.md Phase 4.
      'temporal_cascade',
      // Combat resurrection: rewind a dead group/raid member back to life.
      'temporal_reversal',
      // Out-of-combat mass resurrection for the whole group or raid.
      'collective_reversal',
      // "Correct" pillar raid cooldown: restore recent group/raid damage (Rewind).
      'temporal_rewind',
      'temporal_hourglass',
      // Group haste cooldown (the Chronomancer's Bloodlust): +30% full haste, shares
      // the Bloodlust exhaustion.
      'temporal_acceleration',
      'perfect_moment',
      'fireball_form',
    ],
    color: 0x33c1f1,
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    baseStats: { str: 17, agi: 25, sta: 17, int: 11, spi: 12, armor: 40 },
    statsPerLevel: { str: 1, agi: 3, sta: 1, int: 0, spi: 0, armor: 8 },
    baseHp: 45,
    hpPerLevel: 15,
    baseMana: 100, // energy cap
    manaPerLevel: 0,
    resourceType: 'energy',
    startWeapon: 'rusty_dagger',
    startOffhand: 'rusty_dagger',
    startChest: 'footpad_jerkin',
    startItems: START_RATIONS,
    abilities: [
      'sinister_strike',
      'eviscerate',
      'garrote',
      'backstab',
      'gouge',
      'cheap_shot',
      'evasion',
      'sap',
      'slice_and_dice',
      'sprint',
      'crippling_poison',
      'kidney_shot',
      'expose_armor',
      'ambush',
      'rupture',
      'vanish',
      'instant_poison',
      'adrenaline_rush',
      'deadly_poison',
      'blind',
      'stealth',
      'kick',
      'venom_dart',
    ],
    color: 0xfcee58,
  },
  paladin: {
    id: 'paladin',
    name: 'Paladin',
    baseStats: { str: 22, agi: 17, sta: 22, int: 13, spi: 14, armor: 45 },
    statsPerLevel: { str: 2, agi: 1, sta: 2, int: 1, spi: 1, armor: 12 },
    baseHp: 55,
    hpPerLevel: 17,
    baseMana: 80,
    manaPerLevel: 20,
    resourceType: 'mana',
    startWeapon: 'training_mace',
    startOffhand: 'eastbrook_buckler',
    startChest: 'recruit_tunic',
    startItems: START_RATIONS_MANA,
    abilities: [
      'seal_of_righteousness',
      'holy_light',
      'blessing_of_might',
      'divine_protection',
      'hammer_of_justice',
      'lay_on_hands',
      'flash_of_light',
      'exorcism',
      'consecration',
      'righteous_fury',
      'rebuke',
      'sacred_bulwark',
      'holy_shock',
      'holy_shield',
      'crusader_strike',
      'divine_ascension',
      'devotion_ward',
      'radiant_devotion',
      'dawn_devotion',
      'grace_devotion',
      'retribution_aura',
      'hammer_of_grace',
      'hushbrand',
      'solar_step',
      'solar_invocation',
      'recall_the_fallen',
      'beacon_of_light',
      'final_edict',
      'dawnfall',
      'faithforged_guard',
      'hammer_of_wrath',
      'guardian_covenant',
      'avenging_wrath',
      'sun_gods_verdict',
      'valkyrs_calling',
      'mercy_lance',
      'sacred_form',
      'dawns_embrace',
      'radiant_chorus',
      'life_covenant',
      'aegis_first_dawn',
      'vowkeeper_strike',
      'bastion_rite',
      'sunward_disc',
      'sacred_challenge',
      'bastion_sweep',
      'oath_chain',
      'veilbound_march',
    ],
    color: 0xf58ca0,
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    baseStats: { str: 14, agi: 25, sta: 19, int: 13, spi: 14, armor: 45 },
    statsPerLevel: { str: 1, agi: 3, sta: 2, int: 1, spi: 1, armor: 8 },
    baseHp: 50,
    hpPerLevel: 15,
    baseMana: 100,
    manaPerLevel: 0,
    resourceType: 'focus',
    startWeapon: 'rusty_hatchet',
    startChest: 'footpad_jerkin',
    startItems: START_RATIONS,
    ranged: { min: 5, max: 9, speed: 2.3, maxRange: 35, minRange: 8 },
    abilities: [
      'raptor_strike',
      'pack_command',
      'stampede',
      'measured_shot',
      'aspect_of_the_hawk',
      'serpent_sting',
      'arcane_shot',
      'concussive_shot',
      'mongoose_bite',
      'hunting_momentum',
      'fieldcraft_reentry',
      'wing_clip',
      'trailbreak',
      'wildheart',
      'shellskin',
      'frostjaw_trap',
      'tame_beast',
      'dismiss_pet',
      'revive_pet',
      'aspect_of_the_monkey',
      'aspect_of_the_cheetah',
      'aimed_shot',
      'rapid_fire',
      'shrapnel_charge',
      'bloodtrail_assault',
      'volley',
      'counter_shot',
    ],
    color: 0xa6d84f,
  },
  priest: {
    id: 'priest',
    name: 'Priest',
    baseStats: { str: 10, agi: 11, sta: 13, int: 22, spi: 24, armor: 20 },
    statsPerLevel: { str: 0, agi: 0, sta: 1, int: 2, spi: 3, armor: 4 },
    baseHp: 38,
    hpPerLevel: 11,
    baseMana: 110,
    manaPerLevel: 26,
    resourceType: 'mana',
    startWeapon: 'gnarled_staff',
    startChest: 'apprentice_robe',
    startItems: START_RATIONS_MANA,
    ranged: {
      min: 3,
      max: 6,
      speed: 1.8,
      maxRange: 30,
      minRange: 0,
      wand: true,
      school: 'holy',
    },
    abilities: [
      'smite',
      'lesser_heal',
      'power_word_fortitude',
      'shadow_word_pain',
      'power_word_shield',
      'renew',
      'mind_blast',
      'heal',
      'mind_flay',
      'flash_heal',
      'veilstep',
      'psychic_scream',
      'scouring_mercy',
      'prayer_of_healing',
      'holy_nova',
      'seraphic_vigil',
      'shadowform',
      'summon_tithefiend',
    ],
    color: 0xc6d4f0,
  },
  shaman: {
    id: 'shaman',
    name: 'Shaman',
    baseStats: { str: 18, agi: 16, sta: 20, int: 18, spi: 18, armor: 40 },
    statsPerLevel: { str: 1, agi: 1, sta: 2, int: 2, spi: 2, armor: 10 },
    baseHp: 48,
    hpPerLevel: 15,
    baseMana: 90,
    manaPerLevel: 22,
    resourceType: 'mana',
    startWeapon: 'training_mace',
    startChest: 'footpad_jerkin',
    startItems: START_RATIONS_MANA,
    abilities: [
      'lightning_bolt',
      'thunder_reservoir',
      'chain_lightning',
      'rockbiter_weapon',
      'galeheart_weapon',
      'warspirit_cadence',
      'stormsurge',
      'lifespring_weapon',
      'unleash_weapon',
      'elemental_trance',
      'healing_wave',
      'tidecall',
      'ancestor_return',
      'earth_shock',
      'lightning_shield',
      'flame_shock',
      'flametongue_weapon',
      'frost_shock',
      'ghost_wolf',
      'earthquake',
      'bloodlust',
    ],
    color: 0x4e8aea,
  },
  warlock: {
    id: 'warlock',
    name: 'Warlock',
    baseStats: { str: 11, agi: 12, sta: 15, int: 21, spi: 21, armor: 22 },
    statsPerLevel: { str: 0, agi: 0, sta: 1, int: 3, spi: 2, armor: 4 },
    baseHp: 42,
    hpPerLevel: 12,
    baseMana: 105,
    manaPerLevel: 25,
    resourceType: 'mana',
    startWeapon: 'gnarled_staff',
    startChest: 'apprentice_robe',
    startItems: START_RATIONS_MANA,
    ranged: {
      min: 3,
      max: 6,
      speed: 1.8,
      maxRange: 30,
      minRange: 0,
      wand: true,
      school: 'shadow',
    },
    abilities: [
      'shadow_bolt',
      'summon_imp',
      'demon_skin',
      'immolate',
      'corruption',
      'evil_eye',
      'maledict_gaze',
      'needle_of_fate',
      'sentence',
      'life_tap',
      'cursed_accomplice',
      'summon_voidwalker',
      'curse_of_agony',
      'drain_life',
      'searing_pain',
      'soul_lance',
      'litany_of_guilt',
      'umbral_anchor',
      'soulwell',
      'chaos_bolt',
      'hex_of_violence',
      'ossuary_mark',
      'fear',
      'cruel_pact',
      'shadowburn',
      'ruinous_brand',
      'cinderhide',
      'vicarious_suffering',
      'summon_infernal',
      'rain_of_fire',
      'spell_lock',
      'possess_evil_eye',
      'hour_of_judgment',
      'coven',
      'soul_harvest',
      'raise_graveguard',
      'raise_skeletal_warrior',
      'raise_bone_mage',
      'bone_armor',
      'corpse_explosion',
      'funeral_harvest',
      'unholy_command',
      'reaping_command',
      'sacrifice_undead',
      'raise_gravewing',
      'army_of_the_dead',
    ],
    color: 0xa785e6,
  },
  druid: {
    id: 'druid',
    name: 'Druid',
    baseStats: { str: 15, agi: 15, sta: 17, int: 19, spi: 20, armor: 30 },
    statsPerLevel: { str: 1, agi: 1, sta: 2, int: 2, spi: 2, armor: 6 },
    baseHp: 45,
    hpPerLevel: 13,
    baseMana: 95,
    manaPerLevel: 22,
    resourceType: 'mana',
    startWeapon: 'gnarled_staff',
    startChest: 'footpad_jerkin',
    startItems: START_RATIONS_MANA,
    // The same fixed class wand the other casters carry, in the druid's nature
    // school. Form-aware: available only in caster form and Moonwing Form; the
    // bear/cat/travel shapeshifts fight with claws (see combat/form_swing.ts
    // rangedAutoProfile, which the auto-attack loop resolves through).
    ranged: {
      min: 3,
      max: 6,
      speed: 1.8,
      maxRange: 30,
      minRange: 0,
      wand: true,
      school: 'nature',
    },
    abilities: [
      'wrath',
      'healing_touch',
      'mark_of_the_wild',
      'moonfire',
      'moonseed',
      'rejuvenation',
      'thorns',
      'entangling_roots',
      'bear_form',
      'bear_charge',
      'maul',
      'growl',
      'demoralizing_roar',
      'cat_form',
      'prowl',
      'rake',
      'claw',
      'regrowth',
      'ferocious_bite',
      'barkskin',
      'swipe',
      'starfire',
      'travel_form',
      'enrage',
      'bash',
      'faerie_fire',
      'hibernate',
      'dash',
      'pounce',
      'insect_swarm',
      'tigers_fury',
      'rip',
      'hurricane',
      'skull_bash',
      'primal_reflexes',
    ],
    color: 0xff8c1a,
  },
};

// ---------------------------------------------------------------------------
// Abilities — classic-era rank values and learn levels (levels 1-10)
// ---------------------------------------------------------------------------

const MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF = 0.5;
const MAGE_TEMPORAL_BARRIER_SPELL_POWER_COEFF = 0.25;

export const ABILITIES: Record<string, AbilityDef> = {
  ...PALADIN_CORE_ABILITIES,
  // ====================== WARRIOR ======================
  heroic_strike: {
    id: 'heroic_strike',
    name: 'Reaver Strike',
    class: 'warrior',
    learnLevel: 1,
    cost: 15,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    onNextSwing: true,
    offGcd: true,
    // Reaver Strike is the NO-SPEC (pre-specialization) filler only: Protection
    // replaces it with Revenge, Arms (owner restructure 2026-07-08) leans on
    // Maiming Strike + Brute Swing, and Fury (owner 2026-07-08) dropped it too
    // in favour of Bloodletting / Twinstrike. All three committed specs exclude it.
    excludeSpecs: ['prot', 'arms', 'fury'],
    threat: { flat: 20 }, // classic per-rank values: 20/39/59/78
    effects: [{ type: 'weaponDamage', bonus: 11 }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 15,
        threatFlat: 39,
        effects: [{ type: 'weaponDamage', bonus: 21 }],
      },
      {
        rank: 3,
        level: 14,
        cost: 15,
        threatFlat: 59,
        effects: [{ type: 'weaponDamage', bonus: 32 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 15,
        threatFlat: 78,
        effects: [{ type: 'weaponDamage', bonus: 44 }],
      },
    ],
    description: 'A strong attack that increases melee damage by $d. Activates on your next swing.',
  },
  battle_shout: {
    id: 'battle_shout',
    castFx: 'shout',
    name: 'Iron Bellow',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    exclusiveGroup: 'warrior_shout',
    // 1800s matches the other five standardized class raid buffs (int, armor,
    // AP, stamina, stats all run 30 min); 120s was the odd one out.
    effects: [
      {
        type: 'buffTarget',
        kind: 'buff_ap_pct',
        value: 10,
        duration: 1800,
        party: true,
      },
    ],
    description: 'A shout that increases the attack power of all party members by $b% for 30 min.',
  },
  demoralizing_shout: {
    id: 'demoralizing_shout',
    castFx: 'shout',
    name: 'Direhowl',
    class: 'warrior',
    learnLevel: 12,
    specs: ['prot'],
    cost: 10,
    castTime: 0,
    // Owner rework: a real defensive cooldown instead of a spammable flat AP
    // drain (which barely dented mobs, whose damage rides the weapon roll):
    // 45s cd, every nearby enemy deals 20% less damage for 20s (pct form).
    cooldown: 45,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'aoeAttackPower', amount: 0, pct: 0.2, duration: 20, radius: 10 }],
    description:
      'Lets out a fearsome shout, reducing the damage dealt by all nearby enemies by 20% for 20 sec.',
  },
  charge: {
    id: 'charge',
    name: 'Onrush',
    class: 'warrior',
    learnLevel: 3,
    cost: 0,
    castTime: 0,
    cooldown: 15,
    range: 25,
    minRange: 8,
    school: 'physical',
    requiresTarget: true,
    offGcd: true,
    effects: [{ type: 'charge' }, { type: 'stun', duration: 1 }],
    description: 'Rushes an enemy, generating 9 rage and stunning it for 1 sec. 8-25 yd range.',
  },
  thunder_clap: {
    id: 'thunder_clap',
    name: 'Quaking Blow',
    class: 'warrior',
    learnLevel: 5,
    // Protection-only now (owner restructure 2026-07-08): the seismic AoE belongs
    // to the tank; Arms dropped it to declutter its bar.
    specs: ['prot'],
    cost: 20,
    castTime: 0,
    cooldown: 4,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    threat: { mult: 2.5 }, // classic: thunder clap damage causes 2.5x threat
    effects: [
      { type: 'aoeDamage', min: 12, max: 14, radius: 8 },
      { type: 'aoeAttackSpeed', mult: 1.1, duration: 10, radius: 8 },
    ],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 20,
        effects: [
          { type: 'aoeDamage', min: 23, max: 27, radius: 8 },
          { type: 'aoeAttackSpeed', mult: 1.1, duration: 10, radius: 8 },
        ],
      },
      {
        rank: 3,
        level: 20,
        cost: 20,
        effects: [
          { type: 'aoeDamage', min: 37, max: 43, radius: 8 },
          { type: 'aoeAttackSpeed', mult: 1.1, duration: 10, radius: 8 },
        ],
      },
    ],
    description: 'Blasts nearby enemies for $d damage and slows their attacks by 10% for 10 sec.',
  },
  hamstring: {
    id: 'hamstring',
    name: 'Hobbling Cut',
    class: 'warrior',
    learnLevel: 5,
    cost: 10,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 5, max: 5 },
      { type: 'slow', mult: 0.5, duration: 15 },
    ],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 10,
        effects: [
          { type: 'directDamage', min: 12, max: 12 },
          { type: 'slow', mult: 0.5, duration: 15 },
        ],
      },
    ],
    description: 'Maims the enemy for $d damage, slowing its movement by 50% for 15 sec.',
  },
  bloodrage: {
    id: 'bloodrage',
    name: 'Blood Toll',
    class: 'warrior',
    learnLevel: 6,
    specs: ['arms', 'prot'],
    cost: 0,
    castTime: 0,
    cooldown: 60,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [
      { type: 'selfDamagePctMax', pct: 0.08 },
      { type: 'gainResource', amount: 10 },
    ],
    // The sim-source fallback hardcodes the base gainResource amount (10); the
    // translated catalog uses the {rage} splice so the Blood Offering talent's
    // upgraded amount shows live in the rendered tooltip.
    description: 'Generates 10 rage at the cost of health.',
  },
  overpower: {
    id: 'overpower',
    name: 'Redhand',
    class: 'warrior',
    learnLevel: 2,
    cost: 15,
    castTime: 0,
    cooldown: 5,
    // Two charges (owner 2026-07-08, like Twinstrike): usable twice back to back,
    // each charge recharging on the cooldown, and each use stacking its empower.
    maxCharges: 2,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    // Owner decision 2026-07-09: baseline early rage SPENDER (learned at level 2),
    // costing 15 rage per use. The classic dodge-proc gate stays gone (too RNG);
    // the requiresDodgeProc machinery itself remains for hunter mongoose_bite.
    // Fury AND Prot hand it off at 10 (owner 2026-07-10): it stays the early
    // rage spender through 5-9, then retires when each spec's own kit fills
    // out (Fury: Red Harvest takes the rage-dump role at 10; Prot: its empower
    // rider feeds the Arms-granted Maiming Strike, a dead rider beside
    // Shieldcrack/Revenge, review round 2 item on Prot coherence). Arms keeps
    // it: the Maiming Strike empower is its whole point.
    excludeSpecs: ['fury', 'prot'],
    excludeSpecsAtLevel: 10,
    effects: [
      { type: 'weaponStrike', bonus: 5, cannotBeDodged: true },
      // Empowers the next Maiming Strike (+20% per stack, up to 2), consumed in
      // effect_dispatch's weaponStrike case. Only Arms owns Maiming Strike, so the
      // stack is a no-op for other specs (harmless).
      { type: 'selfBuff', kind: 'overpower_charge', value: 0.2, duration: 15 },
    ],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 15,
        effects: [
          { type: 'weaponStrike', bonus: 15, cannotBeDodged: true },
          {
            type: 'selfBuff',
            kind: 'overpower_charge',
            value: 0.2,
            duration: 15,
          },
        ],
      },
    ],
    description:
      'Instant attack (2 charges) for weapon damage plus $d that empowers your next Maiming Strike by 20% (stacks twice). Cannot be dodged.',
  },
  // Fury's active rage builder (operator design, Arremetida Enfurecida): two
  // 60%-weapon hits so the pair lands slightly more than one signature
  // Bloodletting swing, plus a rage kick. First BASE-KIT user of the
  // multi-charge cooldown flow (maxCharges; the Double Charge talent row
  // pioneered the Entity.charges machinery).
  raging_gale: {
    id: 'raging_gale',
    name: 'Twinstrike',
    class: 'warrior',
    learnLevel: 7,
    specs: ['fury'],
    cost: 0,
    castTime: 0,
    cooldown: 8,
    maxCharges: 2,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [
      // Balance pass 2026-07-10: was 0.6 weapon + 24 per hit (too efficient for a
      // free, rage-generating, 2-charge spell); retuned to 0.45 weapon + 16.
      { type: 'weaponStrike', bonus: 14, weaponMult: 0.4 },
      { type: 'weaponStrike', bonus: 14, weaponMult: 0.4 },
      // v0.27.1 rage fix: halved from 8. Bloodletting is Fury's generating
      // builder; Twinstrike keeps a taste of rage but no longer co-funds a
      // Red Harvest every ~6 seconds.
      { type: 'gainResource', amount: 4 },
    ],
    description:
      'Instantly strike with your weapon twice, each hit dealing 40% weapon damage plus $d, and generate 4 rage. Stores up to 2 charges. (Fury)',
  },
  execute: {
    id: 'execute',
    name: 'Early Grave',
    class: 'warrior',
    learnLevel: 12,
    cost: 15,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    requiresTargetHpBelow: 0.2,
    effects: [{ type: 'directDamage', min: 60, max: 75 }],
    description:
      'Attempt to finish off a wounded foe, causing $d damage. Only usable on enemies below 20% health.',
  },
  slam: {
    id: 'slam',
    name: 'Brute Swing',
    class: 'warrior',
    learnLevel: 5,
    // Arms-only (owner 2026-07-08): Protection dropped Brute Swing since Revenge
    // is already its filler; a generic mandoble adds nothing for a tank.
    specs: ['arms'],
    // Redesigned 2026-07-10 (owner): from a 15-rage spender into the Arms rage
    // BUILDER (free, generates 8 rage, 4s cooldown, stays on the GCD). Dropped
    // from Battle Trance's free-cost scope in the same change: a 0-cost ability
    // can never spend a free-cost proc (see empower_next.ts).
    cost: 0,
    // Instant by owner decision (MoP-era Slam): a timed cast on a rage melee
    // felt wrong in play. Deliberate divergence from the classic 1.5s cast.
    castTime: 0,
    cooldown: 4,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [
      { type: 'weaponStrike', bonus: 15, weaponMult: 0.5 },
      { type: 'gainResource', amount: 8 },
    ],
    description:
      'Swings brutally at the opponent for 50% weapon damage plus $d, generating 8 rage.',
  },
  // Fury's dump-everything spender (operator design, Desenfreno): three full
  // weapon hits, each carrying a Maiming Strike-scale bonus (era table:
  // docs/design/spell-ranks.md), for the whole 80-rage bar. GCD only.
  red_harvest: {
    id: 'red_harvest',
    name: 'Red Harvest',
    class: 'warrior',
    learnLevel: 10,
    specs: ['fury'],
    cost: 80,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [
      // Balance pass 2026-07-10: was 3x full-weapon + 55 each (=165 bonus), far
      // too much for a 5x/min spender; retuned to 0.65 weapon + 25 each.
      { type: 'weaponStrike', bonus: 25, weaponMult: 0.65 },
      { type: 'weaponStrike', bonus: 25, weaponMult: 0.65 },
      { type: 'weaponStrike', bonus: 25, weaponMult: 0.65 },
      // Always Enrages for 4 sec (Rampage / Desenfreno, the guaranteed proc).
      { type: 'enrageChance', chance: 1, duration: 4 },
    ],
    description:
      'Spend everything: strike three times in a frenzy for 65% weapon damage plus $d each, always Enraging you. (Fury)',
  },
  // Spellbook-only passive trait (owner 2026-07-08): documents the Enrage buff
  // that Bloodletting / Red Harvest apply (the actual mechanic is the enrageChance
  // effect + the 'enrage' aura). No effects of its own; never castable.
  enrage_passive: {
    id: 'enrage_passive',
    name: 'Mayhem',
    class: 'warrior',
    learnLevel: 5,
    specs: ['fury'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: while Enraged you deal 7% more damage, attack 25% faster and move 10% faster for 4 sec. Bloodletting has a 30% chance to Enrage you; Red Harvest always does. (Fury)',
  },
  // Fury's defensive cooldown (operator correction 2026-07-07, Regeneracion
  // Enfurecida): a 10s / 20% damage-taken cut (the buff_dr aura read by
  // combat/damage.ts), NOT a flat heal-over-time. The healing is delivered
  // through Bloodletting: while this aura (detectable id 'furious_mending') is
  // up, bloodthirst's selfHealPctMax jumps from 3% to 20% of max health
  // (combat/effect_dispatch.ts).
  furious_mending: {
    id: 'furious_mending',
    name: 'Furious Mending',
    class: 'warrior',
    learnLevel: 10,
    specs: ['fury'],
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [
      {
        type: 'selfBuff',
        kind: 'buff_dr',
        value: 0.2,
        duration: 10,
        auraId: 'furious_mending',
        auraName: 'Furious Mending',
      },
    ],
    description:
      'For 10 sec you take 20% reduced damage, and while it lasts your Bloodletting heals you for 20% of your maximum health. (Fury)',
  },
  // Fury's support offensive cooldown (operator design, Grito Alentador): the
  // caster and friendly players within 40 yd are Emboldened, their next 3
  // damaging ability CASTS guaranteed critical strikes (aura kind 'sure_crit',
  // overridden-not-skipped crit rolls; combat/sure_crit.ts).
  emboldening_roar: {
    id: 'emboldening_roar',
    castFx: 'shout',
    name: 'Emboldening Roar',
    class: 'warrior',
    learnLevel: 16,
    specs: ['fury'],
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'aoeAllySureCrit', charges: 3, duration: 20, radius: 40 }],
    description:
      'Lets loose an emboldening roar: you and friendly players within 40 yards are Emboldened, and your next 3 abilities are guaranteed critical strikes. (Fury)',
  },
  // Protection's active shield block (operator design, Bloquear con Escudo):
  // an off-GCD 6 sec self buff cutting PHYSICAL damage taken in half (the
  // 'buff_dr_phys' sibling of Furious Mending's buff_dr, read at the same
  // combat/damage.ts fold but gated on the school being physical).
  raised_guard: {
    id: 'raised_guard',
    castFx: 'flourish',
    name: 'Raised Guard',
    class: 'warrior',
    learnLevel: 8,
    specs: ['prot'],
    requiresShield: true,
    cost: 15,
    castTime: 0,
    cooldown: 12,
    maxCharges: 2,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [
      {
        type: 'selfBuff',
        kind: 'buff_dr_phys',
        value: 0.5,
        duration: 6,
        auraId: 'raised_guard_dr',
        auraName: 'Raised Guard',
      },
    ],
    description:
      'Brace behind your shield: you take 50% reduced Physical damage for 6 sec. Stores up to 2 charges. (Protection)',
  },
  // Protection's rage-dump survival wall (operator design, Ignorar Dolor): the
  // FIRST spendsAllResource ability. `cost` is the 20-rage minimum gate; casting
  // spends up to spendResourceCap (40) rage from the bar and grants a damage-absorb
  // shield (the priest-style 'absorb' aura kind, drained by dealDamage and read by
  // the HUD absorb bar) soaking 4 damage per rage actually spent, up to 10 sec.
  iron_resolve: {
    id: 'iron_resolve',
    name: 'Iron Resolve',
    class: 'warrior',
    learnLevel: 14,
    specs: ['prot'],
    cost: 20,
    spendsAllResource: true,
    spendResourceCap: 40,
    castTime: 0,
    cooldown: 15,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'absorbSpentResource', mult: 4, duration: 10 }],
    description:
      'Grit your teeth and ignore the pain: spends up to 40 rage (20 minimum) to absorb 4 damage per rage spent, lasting up to 10 sec. (Protection)',
  },
  // Protection's frontal control slam (operator design, Ola de Choque): modest
  // aoe damage plus a 3 sec stun, restricted to enemies in the MELEE_ARC
  // frontal arc (the aoeDamage `frontal` flag) within 8 yd.
  faultline: {
    id: 'faultline',
    name: 'Faultline',
    class: 'warrior',
    learnLevel: 14,
    specs: ['prot'],
    cost: 15,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [
      {
        type: 'aoeDamage',
        min: 15,
        max: 20,
        radius: 8,
        frontal: true,
        stunSec: 3,
      },
    ],
    description:
      'Send a shockwave through the ground: enemies in front of you within 8 yards take $d damage and are stunned for 3 sec. (Protection)',
  },
  // Protection's aoe taunt (operator design, Grito Desafiante): every hostile
  // mob within 10 yd goes through the SHARED applyTaunt entry (threat lifted
  // to the top of its table + forced onto the caster), the fan-out of Goad.
  defiant_bellow: {
    id: 'defiant_bellow',
    castFx: 'shout',
    name: 'Defiant Bellow',
    class: 'warrior',
    learnLevel: 12,
    specs: ['prot'],
    cost: 0,
    castTime: 0,
    cooldown: 60,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'aoeTaunt', radius: 10 }],
    description:
      'A defiant bellow: every enemy within 10 yards is taunted, compelled to attack you for 3 sec. (Protection)',
  },
  // Arms's damage-amplifier (operator design, Aplastar Coloso): a modest weapon
  // strike that also stamps a SOURCE-SCOPED vulnerability (vuln_source) on the
  // target, so only YOUR hits on that target land 20% harder for 8 sec. The aura
  // carries the caster's id (debuffTargetSource), so it never buffs other
  // attackers, unlike the raid-wide 'vulnerability' curse.
  breachmaker: {
    id: 'breachmaker',
    name: 'Breachmaker',
    class: 'warrior',
    learnLevel: 12,
    specs: ['arms'],
    cost: 10,
    castTime: 0,
    cooldown: 45,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [
      { type: 'weaponStrike', bonus: 15 },
      {
        type: 'debuffTargetSource',
        kind: 'vuln_source',
        value: 0.2,
        duration: 8,
        auraId: 'breachmaker_vuln',
        auraName: 'Breachmaker',
      },
    ],
    description:
      'Batter the target for weapon damage plus $d and crack its guard: your own attacks against it deal 20% more damage for 8 sec. (Arms)',
  },
  // Arms's rage-economy passive (operator design, Intrepidez): a calm, measured
  // fury makes every one of your abilities cost 10% less rage. Never castable and
  // never on the action bar; the discount folds at the resolvedAbility cost choke
  // point while the passive is in the known list (spec-gated to arms).
  measured_fury: {
    id: 'measured_fury',
    name: 'Measured Fury',
    class: 'warrior',
    learnLevel: 5,
    specs: ['arms'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description:
      'Your measured fury sharpens your economy: your abilities cost 10% less rage. (Arms)',
  },
  // Seasoned Soldier (Arms passive, owner 2026-07-09): critical auto-attacks mint
  // 10% more rage. Wired in combat/damage.ts's auto-attack rage block, gated on the
  // passive being known AND committed arms (mirrors Measured Fury's cost hook).
  seasoned_soldier: {
    id: 'seasoned_soldier',
    name: 'Seasoned Soldier',
    class: 'warrior',
    learnLevel: 5,
    specs: ['arms'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description: 'Your critical auto-attacks generate 10% more rage. (Arms)',
  },
  // Diabolical Twinstrike (Fury passive, owner 2026-07-09): Twinstrike hits 15%
  // harder while Enraged. Wired in effect_dispatch's weaponStrike case.
  diabolical_twinstrike: {
    id: 'diabolical_twinstrike',
    name: 'Diabolical Twinstrike',
    class: 'warrior',
    learnLevel: 5,
    specs: ['fury'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description: 'While Enraged, your Twinstrike deals 15% more damage. (Fury)',
  },
  // Cleaving Blows (Fury passive, owner 2026-07-09): Red Harvest always refunds a
  // charge of Twinstrike. Wired in effect_dispatch's runEffects red_harvest path.
  cleaving_blows: {
    id: 'cleaving_blows',
    name: 'Cleaving Blows',
    class: 'warrior',
    learnLevel: 5,
    specs: ['fury'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description: 'Red Harvest always refunds a charge of Twinstrike. (Fury)',
  },
  // Sudden Death (Arms passive, owner 2026-07-09): a connected auto swing has a
  // chance to let you cast Early Grave on a target at ANY health, for no rage.
  // Proc in auto_attack.ts; the free cost + HP-gate bypass ride the 'sudden_death'
  // aura (empower_next.ts + casting_lifecycle).
  sudden_death: {
    id: 'sudden_death',
    name: 'Sudden Death',
    class: 'warrior',
    learnLevel: 5,
    specs: ['arms'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description:
      'Your auto-attacks have a chance to let you cast Early Grave on a target at any health, costing no rage. (Arms)',
  },
  // Arms restructure 2026-07-08. Sweeping Strikes: a 12s window where your
  // single-target strikes also clip one nearby enemy at full damage. Deep Wounds: a
  // passive marker; the bleed itself rides Maiming Strike's effects.
  sweeping_strikes: {
    id: 'sweeping_strikes',
    name: 'Widening Arc',
    class: 'warrior',
    learnLevel: 18,
    specs: ['arms'],
    cost: 0,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'sweeping_strikes', value: 1, duration: 12 }],
    description:
      'For 12 sec your single-target attacks also strike 1 nearby enemy for full damage. (Arms)',
  },
  deep_wounds: {
    id: 'deep_wounds',
    name: 'Gaping Wounds',
    class: 'warrior',
    learnLevel: 9,
    specs: ['arms'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: your Maiming Strike leaves the target bleeding for Physical damage over 6 sec. (Arms)',
  },
  cleave: {
    id: 'cleave',
    name: 'Reaping Arc',
    class: 'warrior',
    learnLevel: 14,
    specs: ['arms'],
    // Balance pass 2026-07-10 (Arms buff round): 20 rage / 20-26 -> 15 rage /
    // 30-38, soft-capped at 5 targets (the Revenge mechanism: above 5 the
    // total holds at 5x per-target, scaling already-rolled hits, no rng moved).
    cost: 15,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    threat: { flat: 30 }, // classic 100 at rank 5/level 58, scaled to the 1-20 band
    effects: [{ type: 'aoeDamage', min: 30, max: 38, radius: 5, softCap: 5 }],
    description: 'A sweeping strike that hits all enemies in front of you for $d damage.',
  },
  // Protection's frontal-arc filler, replacing Reaver Strike for committed prot
  // (heroic_strike excludeSpecs ['prot'] + this specs ['prot']). Hits every enemy
  // in the melee facing arc; a soft cap (softCap 5) holds the TOTAL to 5x per-
  // target above 5 enemies. A dodge or parry against the warrior has a chance to
  // make the next cast free (the revenge_free proc, applied in mobSwing).
  revenge: {
    id: 'revenge',
    name: 'Revenge',
    class: 'warrior',
    learnLevel: 7,
    specs: ['prot'],
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    threat: { flat: 30 },
    effects: [
      {
        type: 'aoeDamage',
        min: 18,
        max: 24,
        radius: 8,
        frontal: true,
        softCap: 5,
      },
    ],
    description:
      'Attack in a wide arc, dealing 18 to 24 Physical damage to all enemies in front of you. Above 5 targets the damage is reduced. When you dodge or parry, your next Revenge may cost no rage. (Protection)',
  },
  // Warrior combat stances. All three share exclusiveGroup 'warrior_stance', so
  // casting one swaps the sibling and a warrior is never stanceless (the default
  // for the spec is also auto-applied by combat/warrior_stances.ts). Gating:
  // Battle is for Arms/Prot/no-spec (excludeSpecs Fury), Guarded for Arms/Prot,
  // Berserker for Fury only.
  battle_stance: {
    id: 'battle_stance',
    name: 'Battle Stance',
    class: 'warrior',
    learnLevel: 1,
    excludeSpecs: ['fury'],
    cost: 0,
    castTime: 0,
    cooldown: 1,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    exclusiveGroup: 'warrior_stance',
    effects: [{ type: 'selfBuff', kind: 'battle_stance', value: 0, duration: 3600 }],
    description:
      'An aggressive combat stance: you generate 10% more rage. The default stance for Arms and Protection.',
  },
  berserker_stance: {
    id: 'berserker_stance',
    name: 'Berserker Stance',
    class: 'warrior',
    learnLevel: 5,
    specs: ['fury'],
    cost: 0,
    castTime: 0,
    cooldown: 1,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    exclusiveGroup: 'warrior_stance',
    effects: [{ type: 'selfBuff', kind: 'berserker_stance', value: 0, duration: 3600 }],
    description:
      'A reckless combat stance: your critical strikes land 3% more often and hit for 3% more. The Fury warrior always fights in this stance.',
  },
  defensive_stance: {
    id: 'defensive_stance',
    name: 'Guarded Stance',
    class: 'warrior',
    learnLevel: 5,
    specs: ['arms', 'prot'],
    cost: 0,
    castTime: 0,
    cooldown: 1,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    exclusiveGroup: 'warrior_stance',
    effects: [
      {
        type: 'selfBuff',
        kind: 'defensive_stance',
        value: 0.9,
        duration: 3600,
      },
    ],
    description:
      'A defensive combat stance: you generate 30% more threat but deal and take 10% less damage. Cast Battle Stance to return to the offensive.',
  },
  sunder_armor: {
    id: 'sunder_armor',
    name: 'Armor Shear',
    class: 'warrior',
    learnLevel: 5,
    // Protection-only now (owner restructure 2026-07-08): Arms dropped armor
    // shred to declutter its bar.
    specs: ['prot'],
    cost: 15,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    threat: { flat: 100 }, // classic rank-1 value (260 by rank 5 at 58)
    effects: [{ type: 'sunder', armor: 25, maxStacks: 5 }],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 15,
        threatFlat: 130,
        effects: [{ type: 'sunder', armor: 40, maxStacks: 5 }],
      },
    ],
    description:
      "Sunders the target's armor, reducing it by $d% per application. Stacks up to 5 times. Generates a high amount of threat.",
  },
  taunt: {
    id: 'taunt',
    name: 'Goad',
    class: 'warrior',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 8,
    school: 'physical',
    requiresTarget: true,
    offGcd: true,
    effects: [{ type: 'taunt' }],
    description:
      'Goads the target: your threat rises to match its most hated enemy and it is compelled to attack you for 3 sec.',
  },

  // ====================== MAGE ======================
  fireball: {
    id: 'fireball',
    name: 'Cinderbolt',
    class: 'mage',
    learnLevel: 1,
    cost: 30,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 16, max: 25 },
      { type: 'dot', total: 2, duration: 4, interval: 2 },
    ],
    ranks: [
      {
        rank: 2,
        level: 6,
        cost: 45,
        castTime: 2.0,
        effects: [
          { type: 'directDamage', min: 22, max: 31 },
          { type: 'dot', total: 3, duration: 6, interval: 2 },
        ],
      },
      {
        rank: 3,
        level: 12,
        cost: 65,
        castTime: 2.5,
        effects: [
          { type: 'directDamage', min: 36, max: 48 },
          { type: 'dot', total: 6, duration: 6, interval: 2 },
        ],
      },
      {
        rank: 4,
        level: 18,
        cost: 95,
        castTime: 3.0,
        effects: [
          { type: 'directDamage', min: 58, max: 78 },
          { type: 'dot', total: 12, duration: 8, interval: 2 },
        ],
      },
    ],
    description: 'Hurls a fiery ball that causes $d Fire damage plus additional damage over time.',
  },
  fireball_form: {
    id: 'fireball_form',
    name: 'Ember Form',
    class: 'mage',
    learnLevel: 11,
    cost: 50,
    castTime: 2,
    cooldown: 10,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    requiresOutOfCombat: true,
    requiresOutsideInstance: true,
    effects: [{ type: 'selfBuff', kind: 'form_fireball', value: 1.4, duration: 3600 }],
    description:
      'Transform into a blazing ember, increasing movement speed by $b%. You cannot attack or cast spells while transformed. Recast to return to your normal form.',
  },
  frost_armor: {
    id: 'frost_armor',
    name: 'Hoarfrost Mantle',
    class: 'mage',
    learnLevel: 1,
    // Frost identity (owner 2026-07-14 spec split): committing to Fire or
    // Chronomancy hands the armor off (excludeSpecs, the Reaver Strike idiom),
    // while the level 1-4 pre-spec mage keeps its starter armor.
    excludeSpecs: ['fire', 'arcane'],
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 30, duration: 1800 }],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 30,
        effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 50, duration: 1800 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 45,
        effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 70, duration: 1800 }],
      },
    ],
    description: 'Encases you in frost, increasing armor by $b for 30 min.',
  },
  arcane_intellect: {
    id: 'arcane_intellect',
    name: 'Aether Insight',
    class: 'mage',
    learnLevel: 3,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [
      {
        type: 'buffTarget',
        kind: 'buff_int_pct',
        value: 5,
        duration: 1800,
        party: true,
      },
    ],
    description: 'Increases the Intellect of all party members by $b% for 30 min.',
  },
  frostbolt: {
    id: 'frostbolt',
    name: 'Rimelance',
    class: 'mage',
    learnLevel: 4,
    cost: 25,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'frost',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 18, max: 20 },
      { type: 'slow', mult: 0.6, duration: 5 },
    ],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 35,
        castTime: 2.0,
        effects: [
          { type: 'directDamage', min: 31, max: 35 },
          { type: 'slow', mult: 0.6, duration: 6 },
        ],
      },
      {
        rank: 3,
        level: 14,
        cost: 50,
        castTime: 2.5,
        effects: [
          { type: 'directDamage', min: 44, max: 50 },
          { type: 'slow', mult: 0.6, duration: 7 },
        ],
      },
      {
        rank: 4,
        level: 20,
        cost: 70,
        castTime: 2.5,
        effects: [
          { type: 'directDamage', min: 66, max: 74 },
          { type: 'slow', mult: 0.6, duration: 9 },
        ],
      },
    ],
    description: 'Launches a bolt of frost, causing $d Frost damage and slowing movement by 40%.',
  },
  // Frost mage spec kit (owner design 2026-07-11; combat/frost_mage.ts owns
  // the proc engine these feed). Ice Lance: the instant proc spender. Its 3x
  // against frozen-counting targets lives in the per-cast frozen resolution
  // (effect_dispatch reads FrozenCastState), not here in the data.
  ice_lance: {
    id: 'ice_lance',
    name: 'Ice Lance',
    class: 'mage',
    learnLevel: 5,
    specs: ['frost'],
    cost: 10,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'frost',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 10, max: 12 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 15,
        effects: [{ type: 'directDamage', min: 20, max: 24 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 20,
        effects: [{ type: 'directDamage', min: 30, max: 35 }],
      },
    ],
    description:
      "Hurl a shard of ice, dealing $d Frost damage, tripled against a frozen target. Spends Fingers of Frost, or a charge of Winter's Chill, to treat the target as frozen. (Frost)",
  },
  // Winterlash: the Winter's Chill planter. Its three bolts resolve on one
  // projectile arrival; the debuff rider lands in frostMageAfterCast so the
  // bolts themselves can never eat the charges they just applied. Brain
  // Freeze's instant/no-cooldown override is applyBrainFreezeOverride.
  flurry: {
    id: 'flurry',
    name: 'Winterlash',
    class: 'mage',
    learnLevel: 8,
    specs: ['frost'],
    cost: 30,
    castTime: 1.5,
    cooldown: 10,
    range: 30,
    school: 'frost',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 7, max: 9 },
      { type: 'directDamage', min: 7, max: 9 },
      { type: 'directDamage', min: 7, max: 9 },
    ],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 45,
        effects: [
          { type: 'directDamage', min: 14, max: 17 },
          { type: 'directDamage', min: 14, max: 17 },
          { type: 'directDamage', min: 14, max: 17 },
        ],
      },
    ],
    description:
      "Loose three icy bolts for $d Frost damage each and plant Winter's Chill on the target: its next 2 incoming compatible spells treat it as frozen. Brain Freeze makes Winterlash instant and skips its cooldown. (Frost)",
  },
  // Frostglobe: the roaming Icicle generator (combat/frozen_orb.ts). Instant,
  // 45s cooldown; the orb drifts forward pulsing frost damage + a 30% snare
  // once per second for 8s. Each striking pulse banks one Icicle. Blizzard
  // shortens its cooldown (below).
  frozen_orb: {
    id: 'frozen_orb',
    name: 'Frostglobe',
    class: 'mage',
    learnLevel: 15,
    specs: ['frost'],
    cost: 50,
    castTime: 0,
    cooldown: 45,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [
      {
        type: 'frozenOrb',
        min: 8,
        max: 11,
        radius: 6,
        duration: 8,
        interval: 1,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 18,
        cost: 70,
        effects: [
          {
            type: 'frozenOrb',
            min: 14,
            max: 18,
            radius: 6,
            duration: 8,
            interval: 1,
          },
        ],
      },
    ],
    description:
      'Release an orb of swirling frost that drifts forward for 8 sec, dealing $d Frost damage each second to nearby enemies and slowing them by 30%. Each striking pulse generates one Icicle. (Frost)',
  },
  // Rimeneedle: the frost spec's slow, heavy spender. Gated on a FULL Icicles
  // stack (requiresAuraStacks 5), which the cast consumes; it lands a big frost
  // hit and freezes the target with a short root, so the follow-up Ice Lance and
  // spells Brittle Ruin even where the target was not already frozen. The Icicles
  // build-up lives in combat/frost_mage.ts (fed by Rimelance impacts + Frostglobe
  // pulses); the freeze reuses the shared root effect so isRooted counts it.
  glacial_spike: {
    id: 'glacial_spike',
    name: 'Rimeneedle',
    class: 'mage',
    learnLevel: 16,
    specs: ['frost'],
    cost: 50,
    castTime: 2.7,
    cooldown: 0,
    range: 30,
    school: 'frost',
    requiresTarget: true,
    requiresAuraKind: 'icicles',
    requiresAuraStacks: 5,
    effects: [
      { type: 'directDamage', min: 90, max: 105 },
      { type: 'root', duration: 4 },
    ],
    ranks: [
      {
        rank: 2,
        level: 20,
        cost: 65,
        effects: [
          { type: 'directDamage', min: 140, max: 160 },
          { type: 'root', duration: 4 },
        ],
      },
    ],
    description:
      'Conjure a massive spike of ice, consuming 5 Icicles to deal $d Frost damage and freeze the target in place for 4 sec. (Frost)',
  },
  // Blizzard: the frost AoE workhorse, a ground-aimed channel on the
  // rain_of_fire template plus a snare rider (the position-channel aoeSlow
  // pulse) and the Frostglobe refund (frostMageChannelPulse, 0.5s per enemy
  // struck, at most 3s per cast).
  blizzard: {
    id: 'blizzard',
    name: 'Blizzard',
    class: 'mage',
    learnLevel: 10,
    specs: ['frost'],
    cost: 70,
    cooldown: 8,
    range: 30,
    school: 'frost',
    requiresTarget: false,
    targetMode: 'position',
    // Owner playtest 2026-07-11: no longer a channel. A 2 sec cast places the
    // storm, which then pulses on its own for 6 sec (a groundAoE with the
    // snare + Frostglobe refund riders; delayed skips the on-cast pulse so
    // the first wave lands as the storm visibly forms).
    castTime: 2,
    effects: [
      {
        type: 'groundAoE',
        min: 12,
        max: 16,
        radius: 7,
        // 6 one-second waves; the extra half second keeps the LAST wave from
        // dying on the zone clock's exact edge (delayed drops the on-cast one).
        duration: 6.5,
        interval: 1,
        delayed: true,
        slowMult: 0.6,
        slowDuration: 2,
        orbCdr: true,
      },
    ],
    description:
      'Conjures an ice storm at the target area: after a 2 sec cast it rages for 6 sec, dealing 12 to 16 Frost damage each second and slowing enemies by 40%. Each enemy struck shaves 0.5 sec off Frostglobe, up to 3 sec per cast. (Frost)',
  },
  // Frente Glacial: Frost's hold-to-charge cone. The 2.4 sec cast is the
  // authoritative maximum charge clock; releasing earlier selects one of the
  // four range/damage stages. The preview grows continuously, but gameplay
  // changes only at the deterministic quarter thresholds.
  glacial_front: {
    id: 'glacial_front',
    name: 'Glacial Front',
    class: 'mage',
    learnLevel: 17,
    specs: ['frost'],
    cost: 80,
    castTime: 2.4,
    empowerStages: 4,
    cooldown: 12,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    projectile: false,
    effects: [
      {
        type: 'empoweredCone',
        angle: 70,
        slowMult: 0.5,
        slowDuration: 4,
        stages: [
          { range: 7, min: 35, max: 42 },
          { range: 10, min: 50, max: 60 },
          { range: 13, min: 68, max: 80 },
          { range: 16, min: 88, max: 104, rootDuration: 1 },
        ],
      },
    ],
    description:
      'Hold to gather a widening front of frost, then release it in a cone. Longer charges reach farther and deal more damage. All enemies hit are slowed by 50% for 4 sec; maximum charge also roots them for 1 sec. (Frost)',
  },
  // Aliento de dragón: Fire's hold-to-charge frontal breath. The server owns
  // the live 2.4 second clock; each release resolves one deterministic range,
  // angle, damage, and breakable disorientation stage.
  dragons_breath: {
    id: 'dragons_breath',
    name: "Dragon's Breath",
    class: 'mage',
    learnLevel: 14,
    specs: ['fire'],
    cost: 90,
    castTime: 2.4,
    empowerStages: 4,
    cooldown: 20,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    projectile: false,
    effects: [
      {
        type: 'empoweredCone',
        angle: 90,
        fx: 'fireCone',
        guaranteedCritLevel: 4,
        hotStreakOnce: true,
        stages: [
          { range: 6, angle: 55, min: 32, max: 40, incapacitateDuration: 1 },
          { range: 8, angle: 65, min: 48, max: 60, incapacitateDuration: 1.5 },
          { range: 10, angle: 78, min: 68, max: 82, incapacitateDuration: 2 },
          { range: 12, angle: 90, min: 90, max: 110, incapacitateDuration: 3 },
        ],
      },
    ],
    description:
      'Hold to gather a widening breath of flame, then release it in a cone. Longer charges reach farther and deal more damage. Enemies hit are disoriented and damage breaks the effect; maximum charge always critically strikes and counts once toward Hot Streak. (Fire)',
  },
  // The three frost spec passives: spellbook/spec-screen documentation of the
  // proc engine (combat/frost_mage.ts owns the mechanics; these carry no
  // effects, the seasoned_soldier idiom).
  fingers_of_frost: {
    id: 'fingers_of_frost',
    name: 'Fingers of Frost',
    class: 'mage',
    learnLevel: 5,
    specs: ['frost'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [],
    description:
      'Rimelance has a 15% chance to grant Fingers of Frost, up to 2 charges: your next Ice Lance treats its target as frozen. (Frost)',
  },
  brain_freeze: {
    id: 'brain_freeze',
    name: 'Brain Freeze',
    class: 'mage',
    learnLevel: 5,
    specs: ['frost'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [],
    description:
      'Rimelance has a 20% chance to make your next Winterlash instant and free of its cooldown. (Frost)',
  },
  shatter: {
    id: 'shatter',
    name: 'Brittle Ruin',
    class: 'mage',
    learnLevel: 10,
    specs: ['frost'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [],
    description:
      "Your spells gain 50% critical strike chance against frozen targets. Fingers of Frost and Winter's Chill count as frozen. (Frost)",
  },
  conjure_water: {
    id: 'conjure_water',
    name: 'Waterbind',
    class: 'mage',
    learnLevel: 4,
    cost: 40,
    castTime: 3,
    cooldown: 0,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [], // special-cased: creates conjured_water{rank} in bags
    // Rank ladder per the owner's leveling pass (2026-07-14): 4 / 8 / 12 / 16.
    ranks: [
      { rank: 2, level: 8, cost: 70, effects: [] },
      { rank: 3, level: 12, cost: 110, effects: [] },
      { rank: 4, level: 16, cost: 150, effects: [] },
    ],
    description:
      'Conjures 2 bottles of water, restoring mana when drunk. Higher ranks conjure purer water.',
  },
  conjure_food: {
    id: 'conjure_food',
    name: 'Breadbind',
    class: 'mage',
    learnLevel: 5,
    cost: 45,
    castTime: 3,
    cooldown: 0,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [], // special-cased: creates conjured_bread{rank} in bags
    // Rank ladder per the owner's leveling pass (2026-07-14): 5 / 10 / 15 / 20.
    ranks: [
      { rank: 2, level: 10, cost: 75, effects: [] },
      { rank: 3, level: 15, cost: 115, effects: [] },
      { rank: 4, level: 20, cost: 155, effects: [] },
    ],
    description:
      'Conjures 2 servings of bread, restoring health when eaten. Higher ranks conjure heartier fare.',
  },
  fire_blast: {
    id: 'fire_blast',
    // DPS-spec kit (Chronomancy gating, docs/prd/mage-chronomancy.md Phase 1):
    // both damage specs keep it exactly as before; the healer does not.
    specs: ['fire'],
    name: 'Cinderfall',
    class: 'mage',
    learnLevel: 5,
    cost: 40,
    castTime: 0,
    // Balance 2026-07-25 (live raid parses + class designer round): the full
    // three-charge bank STAYS (dumping it inside Phoenix Trance for the free
    // Pyrelance chain is the fire fantasy, designer call), but each charge
    // recharges in 30s (was 8s, playtest 2026-07-13). The burst window keeps
    // its whole payoff; the slow refill is what makes fire fall off after the
    // window and come back for the next Trance (~110s), so FIGHT-LONG damage
    // lands at parity: with the Ignite fold fix this measures 1.03x-1.17x the
    // talented frost comparator at 60s/120s/300s (was 2.2x-2.9x live). Pinned
    // by tests/fire_short_fight_tuning.test.ts.
    cooldown: 30,
    range: 20,
    school: 'fire',
    requiresTarget: true,
    // Owner playtest 2026-07-11: pressable in the middle of another cast.
    usableWhileCasting: true,
    // Owner rule (round five): fully off the GCD, like Phoenix Trance: castable
    // during one and it never arms one for the other abilities.
    offGcd: true,
    // Owner playtest 2026-07-13: three stored charges, back to back if banked.
    maxCharges: 3,
    // Owner playtest round four: no bolt, the embers bite the moment you press.
    projectile: false,
    effects: [{ type: 'directDamage', min: 27, max: 35 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 60,
        effects: [{ type: 'directDamage', min: 44, max: 54 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 85,
        effects: [{ type: 'directDamage', min: 68, max: 82 }],
      },
    ],
    description: 'Blasts the enemy for $d Fire damage. Instant.',
  },
  arcane_missiles: {
    id: 'arcane_missiles',
    name: 'Aether Darts',
    class: 'mage',
    learnLevel: 5,
    specs: ['arcane'],
    cost: 50,
    castTime: 0,
    channel: { duration: 3, ticks: 3 },
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 8, max: 8 }], // per missile
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 75,
        effects: [{ type: 'directDamage', min: 14, max: 14 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 90,
        effects: [{ type: 'directDamage', min: 18, max: 18 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 105,
        effects: [{ type: 'directDamage', min: 22, max: 22 }],
      },
    ],
    description:
      'Launches Aether Darts at the enemy, causing $d Arcane damage each second for 3 sec.',
  },
  polymorph: {
    id: 'polymorph',
    name: 'Bewitch',
    class: 'mage',
    learnLevel: 7,
    cost: 50,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'polymorph', duration: 15 }],
    ranks: [
      {
        rank: 2,
        level: 18,
        cost: 70,
        effects: [{ type: 'polymorph', duration: 20 }],
      },
    ],
    description:
      'Transforms the enemy into a toad for up to $t sec. The toad wanders and heals rapidly. Any damage breaks the effect. Beasts and humanoids only.',
  },
  // One meaningful follow-up breaks Icebind, while tiny incidental ticks do not.
  // The cap prevents high-health targets from gaining a stronger root.
  // Frost Nova deals its own damage before applying the root, so that packet is excluded.
  // Keep this data on every rank because resolved ranks replace the full effects array.
  // Values are cumulative post-mitigation damage.
  frost_nova: {
    id: 'frost_nova',
    name: 'Icebind',
    class: 'mage',
    learnLevel: 5,
    cost: 35,
    castTime: 0,
    cooldown: 22,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [
      {
        type: 'aoeRoot',
        duration: 8,
        radius: 10,
        min: 6,
        max: 7,
        breakOnDamage: { maxHpPct: 0.15, min: 20, max: 60 },
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 50,
        effects: [
          {
            type: 'aoeRoot',
            duration: 8,
            radius: 10,
            min: 12,
            max: 14,
            breakOnDamage: { maxHpPct: 0.15, min: 20, max: 60 },
          },
        ],
      },
    ],
    description:
      "Freezes all nearby enemies in place for up to 8 sec, dealing $d Frost damage. The root breaks after cumulative damage equal to 15% of the target's maximum health, with a minimum of 20 and a maximum of 60 damage.",
  },
  arcane_explosion: {
    id: 'arcane_explosion',
    name: 'Aetherburst',
    class: 'mage',
    learnLevel: 7,
    specs: ['arcane'],
    cost: 60,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [{ type: 'aoeDamage', min: 26, max: 31, radius: 10 }],
    description: 'A burst of Arcane energy hits all nearby enemies for $d Arcane damage.',
  },
  // Ground-targeted (targetMode 'position'): the mage aims a patch of roaring flame
  // at a chosen spot within range, which burns enemies standing in it. The first
  // spell built on the ground-target cast primitive (docs/design/arpg-spell-mechanics.md).
  flamestrike: {
    id: 'flamestrike',
    // DPS-spec kit (Chronomancy gating, docs/prd/mage-chronomancy.md Phase 1):
    // both damage specs keep it exactly as before; the healer does not.
    specs: ['fire'],
    name: 'Flamestrike',
    class: 'mage',
    learnLevel: 12,
    cost: 80,
    // Owner rule 2026-07-11: a real cast, EXCEPT under Hot Streak, whose
    // next_cast_instant makes it instant and free (the spender machinery).
    castTime: 2,
    // Owner release rule 2026-07-19: cast time and the GCD pace it, no cooldown.
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: false,
    targetMode: 'position',
    // canCrit: the initial blast rolls ONE crit for the whole cast (owner rule:
    // a Flamestrike is a single Hot Streak crit however many enemies it hits).
    effects: [{ type: 'aoeDamage', min: 34, max: 44, radius: 7, canCrit: true }],
    description:
      'Calls down a burst of flame at the target area, dealing $d Fire damage to enemies caught in the blast. Can critically strike (one strike for the whole blast).',
  },
  // Ground-targeted thematic spells (targetMode 'position'), one per caster/ranged
  // class, all built on the ground-target cast primitive (docs/design/arpg-spell-mechanics.md).
  rain_of_fire: {
    id: 'rain_of_fire',
    name: 'Rain of Fire',
    class: 'warlock',
    learnLevel: 8,
    cost: 45,
    ruinCost: 3,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: false,
    targetMode: 'position',
    specs: ['destruction'],
    effects: [
      {
        type: 'groundAoE',
        min: 5,
        max: 7,
        radius: 7,
        duration: 4,
        interval: 1,
        delayed: true,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 18,
        cost: 60,
        effects: [
          {
            type: 'groundAoE',
            min: 8,
            max: 11,
            radius: 7,
            duration: 6,
            interval: 1,
            delayed: true,
          },
        ],
      },
    ],
    description:
      'Spends 3 Wrack to rain fire over the target area for 4 sec, increasing to 6 sec at rank 2. Desolation calls down the first wave immediately.',
  },
  volley: {
    id: 'volley',
    name: 'Volley',
    class: 'hunter',
    learnLevel: 11,
    cost: 60,
    castTime: 0,
    cooldown: 8,
    range: 35,
    school: 'physical',
    scalesWith: 'ranged',
    requiresTarget: false,
    targetMode: 'position',
    channel: { duration: 3, ticks: 6 },
    effects: [{ type: 'aoeDamage', min: 12, max: 16, radius: 8 }],
    description:
      'Rain arrows over an 8-yard area for 3 sec. Enemies in the area take $d Physical damage every 0.5 sec. Damage increases with Ranged Attack Power.',
  },
  hurricane: {
    id: 'hurricane',
    name: 'Galeheart',
    class: 'druid',
    learnLevel: 18,
    cost: 90,
    castTime: 0,
    cooldown: 12,
    range: 30,
    school: 'nature',
    requiresTarget: false,
    targetMode: 'position',
    channel: { duration: 6, ticks: 6 },
    effects: [{ type: 'aoeDamage', min: 12, max: 16, radius: 8 }],
    description:
      'Calls a hurricane onto the target area for 6 sec, battering enemies for $d Nature damage each second.',
  },
  earthquake: {
    id: 'earthquake',
    name: 'Faultwake',
    class: 'shaman',
    specs: ['elemental'],
    learnLevel: 18,
    cost: 80,
    castTime: 0,
    cooldown: 12,
    range: 30,
    school: 'nature',
    requiresTarget: false,
    targetMode: 'position',
    effects: [
      {
        type: 'groundAoE',
        min: 13,
        max: 17,
        radius: 8,
        duration: 6,
        interval: 1.5,
      },
    ],
    description:
      'Shake an 8-yard area for 6 sec, dealing $d Nature damage every 1.5 sec. Damage increases with Spell Power. Thundercall: at 5 Thunder, deal 100% more damage and consume all Thunder.',
  },
  scorch: {
    id: 'scorch',
    // DPS-spec kit (Chronomancy gating, docs/prd/mage-chronomancy.md Phase 1):
    // both damage specs keep it exactly as before; the healer does not.
    specs: ['fire'],
    name: 'Scald',
    class: 'mage',
    learnLevel: 10,
    cost: 35,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    // Owner playtest 2026-07-13: Scald lands instantly, no traveling bolt (projectile
    // false), so the damage resolves the moment the cast finishes.
    projectile: false,
    // Owner playtest 2026-07-11: casting it also quickens your feet; round
    // four made the cast itself mobile (the fire mage's on-the-run filler).
    castWhileMoving: true,
    effects: [
      { type: 'directDamage', min: 32, max: 40 },
      { type: 'selfBuff', kind: 'buff_speed', value: 1.2, duration: 3 },
    ],
    description:
      'Scalds the enemy for $d Fire damage and quickens you by 20% for 3 sec. Quick to cast, and castable while moving.',
  },
  pyroblast: {
    id: 'pyroblast',
    // DPS-spec kit (Chronomancy gating, docs/prd/mage-chronomancy.md Phase 1):
    // both damage specs keep it exactly as before; the healer does not.
    specs: ['fire'],
    name: 'Pyrelance',
    class: 'mage',
    learnLevel: 5,
    cost: 125,
    castTime: 6.0,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    // The kit's hardest hit flies as the visibly heavier bolt (render-only).
    projectileFx: 'heavyBolt',
    effects: [
      // The first-ten-seed isolated combat sweep put 60s fire below frost.
      // A 5% Pyrelance lift restores sustained parity while keeping the 27s
      // burst beneath its 1.6x ceiling and leaving Ignite's contract intact.
      { type: 'directDamage', min: 179, max: 236 },
      { type: 'dot', total: 50, duration: 12, interval: 2 },
    ],
    description:
      'Hurls an immense fiery boulder that causes $d Fire damage plus additional damage over time.',
  },
  // ---- Chronomancy (healer) Phase 1 kit, docs/prd/mage-chronomancy.md ----
  temporal_mend: {
    id: 'temporal_mend',
    name: 'Temporal Mend',
    class: 'mage',
    learnLevel: 5,
    specs: ['arcane'],
    cost: 45,
    // The reliable efficient heal (owner spec: ~2s): quicker than the priest
    // and paladin big heals (2.5s), paying for the speed with a slightly
    // lower top-end roll. Values are PLAYTEST-provisional (PRD section 14).
    castTime: 2,
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 62, max: 74 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 70,
        effects: [{ type: 'heal', min: 105, max: 125 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 95,
        effects: [{ type: 'heal', min: 150, max: 178 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 110,
        effects: [{ type: 'heal', min: 218, max: 258 }],
      },
    ],
    description:
      'Draws an ally a moment forward in time, mending $d health as the body settles into its healthier future self. (Chronomancy signature)',
  },
  temporal_barrier: {
    id: 'temporal_barrier',
    name: 'Temporal Barrier',
    class: 'mage',
    learnLevel: 5,
    specs: ['arcane'],
    cost: 50,
    castTime: 0,
    // Instant, on the GCD, 12s cooldown (owner spec). Sized against the
    // priest Psalm of Warding (145 absorb, 6s cd, 30s window): a bigger chunk
    // on half the cadence and a much shorter 10s window. PLAYTEST values.
    cooldown: 12,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [
      {
        type: 'absorb',
        amount: 55,
        duration: 10,
        spellPowerCoeff: MAGE_TEMPORAL_BARRIER_SPELL_POWER_COEFF,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 75,
        effects: [
          {
            type: 'absorb',
            amount: 100,
            duration: 10,
            spellPowerCoeff: MAGE_TEMPORAL_BARRIER_SPELL_POWER_COEFF,
          },
        ],
      },
      {
        rank: 3,
        level: 18,
        cost: 105,
        effects: [
          {
            type: 'absorb',
            amount: 160,
            duration: 10,
            spellPowerCoeff: MAGE_TEMPORAL_BARRIER_SPELL_POWER_COEFF,
          },
        ],
      },
      {
        rank: 4,
        level: 20,
        cost: 120,
        effects: [
          {
            type: 'absorb',
            amount: 232,
            duration: 10,
            spellPowerCoeff: MAGE_TEMPORAL_BARRIER_SPELL_POWER_COEFF,
          },
        ],
      },
    ],
    description:
      'Shifts the target a heartbeat out of the present, a temporal shell absorbing $d damage for 10 sec before the timeline snaps back.',
  },
  // ---- Chronomancy (healer) Phase 2: Temporal Echo, docs/prd/mage-chronomancy.md
  // section 13. Instant, on the GCD, no cooldown. A small initial heal (the sibling
  // `heal` effect, feeds $d) plus the per-caster mark (the `temporalEcho` effect,
  // feeds $t). While marked, 40% of the mage's single-target Arcane damage and 15%
  // of area Arcane damage heals the ally (combat/chronomancy.ts). Re-casting MOVES
  // the mark. Values are PLAYTEST-provisional (PRD section 13.14 / 14).
  temporal_echo: {
    id: 'temporal_echo',
    name: 'Temporal Echo',
    class: 'mage',
    learnLevel: 8,
    specs: ['arcane'],
    cost: 40,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [
      { type: 'heal', min: 24, max: 30 },
      { type: 'temporalEcho', duration: 15 },
    ],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 60,
        effects: [
          { type: 'heal', min: 40, max: 50 },
          { type: 'temporalEcho', duration: 15 },
        ],
      },
      {
        rank: 3,
        level: 18,
        cost: 85,
        effects: [
          { type: 'heal', min: 58, max: 70 },
          { type: 'temporalEcho', duration: 15 },
        ],
      },
      {
        rank: 4,
        level: 20,
        cost: 90,
        effects: [
          { type: 'heal', min: 84, max: 102 },
          { type: 'temporalEcho', duration: 15 },
        ],
      },
    ],
    description:
      'Marks an ally with an echo of a healthier moment, mending $d health at once. For $t sec, part of the Arcane damage you deal is drawn back through the echo to heal them.',
  },
  // ---- Chronomancy (healer) Phase 4: Cascada temporal (Temporal Cascade),
  // docs/prd/mage-chronomancy.md Phase 4. The GROUP version of Temporal Echo: a 2s
  // cast that centers on the friendly target (which must be the caster or a living
  // group/raid member and is ALWAYS included) and marks the nearest allies within
  // 15 yd of it, up to five total. Each takes a small initial heal and a REDUCED
  // group echo (13% single / 6% area conversion, combat/chronomancy.ts) for 8 sec.
  // The 15s cooldown plus the 8s window keep five echoes from ever being sustained.
  // A pre-existing individual echo on a target is kept at 40% (never downgraded),
  // still initial-healed, and counts within the five. PLAYTEST-provisional values
  // (owner 2026-07-12), gated by tests/chronomancy_cascade_aoe.test.ts.
  temporal_cascade: {
    id: 'temporal_cascade',
    name: 'Temporal Cascade',
    class: 'mage',
    learnLevel: 12,
    specs: ['arcane'],
    cost: 90,
    castTime: 2,
    cooldown: 17,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    targetType: 'friendly',
    // Group/raid-only: the cast is refused (no cost/cooldown) on a friendly that is
    // not the caster or a party/raid member, so an out-of-group target never wastes it.
    partyOnlyTarget: true,
    effects: [
      {
        type: 'massTemporalEcho',
        duration: 10,
        radius: 15,
        maxTargets: 5,
        heal: { min: 14, max: 18 },
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 130,
        effects: [
          {
            type: 'massTemporalEcho',
            duration: 10,
            radius: 15,
            maxTargets: 5,
            heal: { min: 22, max: 28 },
          },
        ],
      },
      {
        rank: 3,
        level: 20,
        cost: 170,
        effects: [
          {
            type: 'massTemporalEcho',
            duration: 10,
            radius: 15,
            maxTargets: 5,
            heal: { min: 28, max: 36 },
          },
        ],
      },
    ],
    description:
      'Sends an echo cascading through your group: the target and up to four of their nearest allies are mended at once and each marked for $t sec, drawing part of the Arcane damage you deal back through their echoes to heal them. (Chronomancy)',
  },
  // ---- Chronomancy combat resurrection: Temporal Reversal. Rewinds a DEAD group/raid
  // member's timeline back to life at their corpse, IN COMBAT, with a fraction of their
  // pools and no resurrection sickness (targetsDead + the resurrectAlly effect, reusing
  // spirit.ts revivePlayerAt). The ten-minute cooldown keeps a death costly.
  temporal_reversal: {
    id: 'temporal_reversal',
    name: 'Temporal Reversal',
    class: 'mage',
    learnLevel: 16,
    specs: ['arcane'],
    cost: 60,
    castTime: 2,
    cooldown: 600,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    targetType: 'friendly',
    targetsDead: true,
    effects: [{ type: 'resurrectAlly', hpFrac: 0.35 }],
    description:
      "Rewinds a fallen ally's timeline, returning them to life at their body with a portion of their health and mana, even in the thick of combat. (Chronomancy)",
  },
  // ---- Chronomancy out-of-combat mass resurrection. The base seven-second cast
  // and mana cost are provisional playtest values. It has no target and rewinds all
  // dead members on the authoritative group or raid roster at cast completion.
  // The five-minute cooldown is the real throttle: requiresOutOfCombat alone is not
  // one, because a backline caster who never draws aggro drops combat mid-fight the
  // moment combatTimer passes the 5s linger (see the engagedPids pass in sim.ts), so
  // a zero-cooldown mass rez could be chained repeatedly inside a single encounter.
  collective_reversal: {
    id: 'collective_reversal',
    name: 'Collective Reversal',
    class: 'mage',
    learnLevel: 8,
    specs: ['arcane'],
    cost: 250,
    castTime: 7,
    cooldown: 300,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    requiresOutOfCombat: true,
    projectile: false,
    effects: [{ type: 'massResurrectGroup', hpFrac: 0.3 }],
    description:
      'Rewinds every fallen member of your group or raid, returning them to life at their body with 30% health and mana. Cannot be cast in combat. (Chronomancy)',
  },
  // ---- Chronomancy (healer) "Correct" pillar: Rewind (Rebobinar), the raid
  // cooldown. docs/prd/mage-chronomancy.md. Instant, no target, self-centered 40 yd
  // AoE on the caster's group/raid. Restores 30% of the REAL damage each living
  // member took in the last 5s, capped at 35% of their max HP and their missing HP;
  // never crits, applies no Echo, does not touch the Arcane conversion, and generates
  // normal heal threat. Runs entirely through combat/rewind.ts + the 5s damage ring
  // (combat/damage_history.ts). PLAYTEST-provisional cost (150) and 120s cooldown.
  temporal_rewind: {
    id: 'temporal_rewind',
    name: 'Rewind',
    class: 'mage',
    learnLevel: 14,
    specs: ['arcane'],
    cost: 150,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'arcane',
    requiresTarget: false, // instant, self-centered: no target needed
    effects: [
      {
        type: 'rewind',
        fraction: 0.3,
        maxHpFraction: 0.35,
        windowSec: 5,
        radius: 40,
      },
    ],
    description:
      'Sends an arcane wave through your group or raid, rewinding time to restore 30% of the damage each ally within 40 yards took over the last 5 seconds (up to 35% of their maximum health). Cannot be a critical effect. (Chronomancy)',
  },
  // Hourglass of Suspension: a ground-targeted Chronomancy control and rescue
  // tool. All tuning below is PLAYTEST-provisional. A point at the caster's feet
  // selects self, then a living party or raid ally is preferred over one hostile
  // in the small capture radius. The shared combat module owns exact behavior.
  temporal_hourglass: {
    id: 'temporal_hourglass',
    name: 'Hourglass of Suspension',
    class: 'mage',
    learnLevel: 14,
    specs: ['arcane'],
    cost: 110,
    castTime: 0,
    cooldown: 50,
    range: 28,
    school: 'arcane',
    requiresTarget: false,
    targetMode: 'position',
    projectile: false,
    effects: [
      {
        type: 'temporalHourglass',
        duration: TEMPORAL_HOURGLASS_DURATION,
        hostilePveDuration: TEMPORAL_HOURGLASS_HOSTILE_PVE_DURATION,
        hostilePvpDuration: TEMPORAL_HOURGLASS_HOSTILE_PVP_DURATION,
        groundDuration: TEMPORAL_HOURGLASS_GROUND_DURATION,
        selfRadius: TEMPORAL_HOURGLASS_SELF_RADIUS,
        captureRadius: TEMPORAL_HOURGLASS_CAPTURE_RADIUS,
        healMaxHpPct: TEMPORAL_HOURGLASS_HEAL_FRACTION,
        selfCooldownRate: TEMPORAL_HOURGLASS_SELF_COOLDOWN_RATE,
        allyCooldownRate: TEMPORAL_HOURGLASS_ALLY_COOLDOWN_RATE,
      },
    ],
    description:
      'Place a temporal hourglass at the selected location. Beneath an enemy, it suspends them for $e sec in PvE or $p sec in PvP and prevents all actions; damage breaks the effect. At your feet or beneath a group ally, it grants stasis for $t sec, prevents damage and actions, restores $h% of maximum health, and makes cooldowns recover $s% faster for you or $a% faster for an ally. On empty ground, the hourglass waits for $g sec and affects the first valid unit to step on it. The beneficial aura can be removed manually.',
  },
  // ---- Chronomancy (healer) group haste cooldown: Temporal Acceleration, the
  // Chronomancer's equivalent of the Shaman's Bloodlust. A BASE ability (owner
  // directive 2026-07-13: not a talent). Instant, no target, 40 yd group/raid, +30%
  // FULL haste (attack + cast + channel) for 15s on a 5 min cooldown, sharing the
  // `sated` exhaustion with Bloodlust so the two can never be chained. Runs through
  // the same aoeAllyHaste effect + combat/haste_burst.ts.
  // Perfect Moment: the Chronomancer's offensive cooldown (owner design
  // 2026-07-14). Instantly grants FOUR Arcane Charges and freezes them for 10
  // sec: Aether Darts fires its full-charge five-missile barrage without
  // spending the stack (combat/chronomancy.ts applyPerfectMoment +
  // aetherDartsBoltBonus's window guard). Off the GCD, like Phoenix Trance.
  perfect_moment: {
    id: 'perfect_moment',
    name: 'Perfect Moment',
    class: 'mage',
    learnLevel: 10,
    specs: ['arcane'],
    cost: 0,
    castTime: 0,
    cooldown: 120,
    offGcd: true,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [{ type: 'perfectMoment' }],
    description:
      'Seize your perfect moment: instantly gain 4 Arcane Charges, and for 10 sec Aether Darts does not consume them. (Chronomancer)',
  },
  temporal_acceleration: {
    id: 'temporal_acceleration',
    name: 'Temporal Acceleration',
    class: 'mage',
    learnLevel: 20,
    specs: ['arcane'],
    cost: 120,
    castTime: 0,
    cooldown: 300,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [
      {
        type: 'aoeAllyHaste',
        mult: 1.3,
        duration: 15,
        radius: 40,
        spell: true,
        exhaust: true,
        groupOnly: true,
      },
    ],
    description:
      'Accelerates the flow of time for your group or raid, increasing attack, casting, and channeling speed by 30% for 15 sec. Allies recently affected by Temporal Acceleration or Storm Chorus are too exhausted to benefit. (Chronomancy)',
  },
  // ---- Chronomancy (healer) Phase 3: Aether Surge, docs/prd/mage-chronomancy.md
  // sections 13.4 / 14. The single-target Arcane spender that drives the offensive
  // heal rotation. `projectile: false` so cost, damage and the +1 charge all
  // resolve at cast completion in one controlled order (cost reads N charges,
  // damage reads N, then banks N+1); a traveling bolt would race a back-to-back
  // recast. Each held Arcane Charge scales damage (+30%) and cost (x1.9, steep)
  // via combat/chronomancy.ts; Aether Darts consumes the charges. PLAYTEST-
  // provisional: the base cost is DERIVED by tests/chronomancy_balance_targets.test.ts to
  // land the conservative rotation near 70-80s to OOM at the level-20 pool.
  arcane_surge: {
    id: 'arcane_surge',
    name: 'Aether Surge',
    class: 'mage',
    learnLevel: 5,
    specs: ['arcane'],
    // The integrated level-20 stat curve pushed the conservative rotation to
    // 65.6s OOM at 16 mana. Fourteen restores the signed 70-80s sustain window
    // without relaxing the emergency-spam or damage-separation contracts.
    cost: 14,
    castTime: 2,
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    // Instant impact at cast completion (no traveling bolt): keeps the charge
    // read/write in one deterministic order, see combat/chronomancy.ts.
    projectile: false,
    // (base cost is `cost: 14` above; DERIVED via the balance harness so the
    // targets hold WITH the 25% free-cast proc's mana relief.)
    // Low base damage (DERIVED via tests/chronomancy_balance_targets.test.ts): the
    // conservative rotation must sustain clearly under Piro/Cryo (>=22% below);
    // the payoff is ramping it with charges (and the Echo healing it feeds).
    effects: [{ type: 'directDamage', min: 10, max: 13 }],
    // The builder originally shipped with no rank ladder, leaving its level-5
    // packet unchanged at the level-20 cap. Every rank re-states the DERIVED
    // base cost (14, see above) so the charge-driven mana curve stays exactly
    // where the harness put it and only the damage learns with the player.
    // `cost` is required on AbilityRank, so it has to be repeated, not omitted:
    // a rank row that drifts from the base cost silently re-tunes the OOM
    // window for every level at or above that rank.
    ranks: [
      { rank: 2, level: 10, cost: 14, effects: [{ type: 'directDamage', min: 11, max: 13 }] },
      { rank: 3, level: 15, cost: 14, effects: [{ type: 'directDamage', min: 11, max: 14 }] },
      { rank: 4, level: 20, cost: 14, effects: [{ type: 'directDamage', min: 12, max: 14 }] },
    ],
    description:
      "Draws a surge of raw aether through the enemy for $d damage. Each cast leaves an Arcane Charge that raises your next Aether Surge's damage and cast speed (5% faster each) but sharply raises its mana cost, stacking up to 4; Aether Darts spends the charges. Each cast can also arm Aether Rush, making your next Aether Surge free and twice as fast to cast.",
  },
  ice_barrier: {
    id: 'ice_barrier',
    // Frost's personal barrier (owner leveling pass 2026-07-14): Fire gets its
    // own Blazing Barrier at the spec pick, so the shared Frostveil is gone.
    specs: ['frost'],
    name: 'Frostveil',
    class: 'mage',
    learnLevel: 5,
    cost: 45,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    // The original level-20 shield moved down to the spec pick at level 5.
    // Rank it through the leveling curve instead of granting its cap value early.
    effects: [
      {
        type: 'absorb',
        amount: 50,
        duration: 60,
        spellPowerCoeff: MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 65,
        effects: [
          {
            type: 'absorb',
            amount: 90,
            duration: 60,
            spellPowerCoeff: MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF,
          },
        ],
      },
      {
        rank: 3,
        level: 18,
        cost: 90,
        effects: [
          {
            type: 'absorb',
            amount: 130,
            duration: 60,
            spellPowerCoeff: MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF,
          },
        ],
      },
    ],
    description: 'Shields you in ice, absorbing $d damage for 60 sec.',
  },

  // ====================== ROGUE ======================
  venom_dart: {
    id: 'venom_dart',
    name: 'Venom Dart',
    class: 'rogue',
    learnLevel: 14,
    cost: 25,
    castTime: 0,
    cooldown: 8,
    range: 20,
    school: 'nature',
    requiresTarget: true,
    awardsCombo: 1,
    // The Knifework wound-tending accent (owner playtest: the loop wanted a
    // fourth rotational button, and the Venomrend wound kept expiring before
    // the next rend). The extension itself lives in rogueEngineOnCast.
    effects: [{ type: 'directDamage', min: 30, max: 40 }],
    description: 'Flick a poisoned dart for $d Nature damage. Awards 1 combo point.',
    specNotes: {
      assassination:
        'Adds 1 Venom Ritual and extends your venom wound by 6 sec (the wound never goes above 20 sec).',
    },
  },
  sinister_strike: {
    id: 'sinister_strike',
    name: 'Wicked Slash',
    class: 'rogue',
    learnLevel: 1,
    cost: 45,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    // Thuggery engine (combat/rogue_engines.ts): while the Redline window
    // runs, the builder button is Haymaker, the pip-deepening heavy hit.
    actionReplacement: { abilityId: 'body_blow', auraKind: 'redline', minStacks: 1 },
    effects: [{ type: 'weaponStrike', bonus: 3, normalized: true }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 45,
        effects: [{ type: 'weaponStrike', bonus: 6, normalized: true }],
      },
      {
        rank: 3,
        level: 14,
        cost: 45,
        effects: [{ type: 'weaponStrike', bonus: 12, normalized: true }],
      },
      {
        rank: 4,
        level: 20,
        cost: 45,
        effects: [{ type: 'weaponStrike', bonus: 18, normalized: true }],
      },
    ],
    description: 'An instant strike for weapon damage plus $d. Awards 1 combo point.',
    specNotes: {
      assassination: 'Adds 1 Venom Ritual (max 6).',
      combat:
        'While Redline is active, this button becomes Haymaker: 130% weapon damage plus 10, awards 2 combo points, and adds 1 Redline (max 4).',
    },
  },
  eviscerate: {
    id: 'eviscerate',
    name: 'Dirt Nap',
    class: 'rogue',
    learnLevel: 1,
    cost: 35,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    spendsCombo: true,
    // Knifework engine (combat/rogue_engines.ts): at 6 Venom Ritual stages
    // the button transforms into Venomrend, the detonation finisher (six
    // against a five-thrust cycle alternates Dirt Nap and Venomrend).
    // Thuggery engine: while the Redline window runs the same button is
    // Lights Out, the cash-out that ends the run. The aura kinds are
    // spec-gated, so at most one rule can match.
    actionReplacement: [
      { abilityId: 'venomrend', auraKind: 'venom_ritual', minStacks: 6 },
      { abilityId: 'knockout_blow', auraKind: 'redline', minStacks: 1 },
    ],
    effects: [{ type: 'finisherDamage', base: 4, perCombo: 7, variance: 4 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 35,
        effects: [{ type: 'finisherDamage', base: 8, perCombo: 12, variance: 6 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 35,
        effects: [{ type: 'finisherDamage', base: 14, perCombo: 18, variance: 9 }],
      },
    ],
    description: 'Finishing move that causes $d.',
    specNotes: {
      assassination:
        'At 6 Venom Ritual, this button becomes Venomrend: a strike that instantly deals all the damage your bleeds would still have dealt, plants a fresh venom wound, and restores 20 energy.',
      combat:
        'Landing this with 4 or more combo points starts Redline for 8 sec: Wicked Slash becomes Haymaker and this button becomes Lights Out (45 plus 35 per combo point, hitting 25% harder for each Redline built, restores 25 energy). Spend it before Redline ends.',
    },
  },
  backstab: {
    id: 'backstab',
    name: 'Craven Thrust',
    class: 'rogue',
    learnLevel: 4,
    cost: 60,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    effects: [
      {
        type: 'weaponStrike',
        bonus: 11,
        requiresBehind: true,
        weaponMult: 1.5,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 60,
        effects: [
          {
            type: 'weaponStrike',
            bonus: 20,
            requiresBehind: true,
            weaponMult: 1.5,
          },
        ],
      },
      {
        rank: 3,
        level: 18,
        cost: 60,
        effects: [
          {
            type: 'weaponStrike',
            bonus: 32,
            requiresBehind: true,
            weaponMult: 1.5,
          },
        ],
      },
    ],
    description:
      "Drive your dagger into the target's back for 150% weapon damage plus $d. Must be behind the target. Requires a dagger. Awards 1 combo point.",
    specNotes: {
      assassination:
        'Each strike adds 1 Venom Ritual (max 6) and refunds 15 energy. At 6 Venom Ritual, Dirt Nap becomes Venomrend (it deals all your remaining bleed damage at once).',
    },
  },
  gouge: {
    id: 'gouge',
    name: 'Eye Jab',
    class: 'rogue',
    learnLevel: 6,
    cost: 45,
    castTime: 0,
    cooldown: 10,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    effects: [
      { type: 'directDamage', min: 8, max: 9 },
      { type: 'incapacitate', duration: 4 },
    ],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 45,
        effects: [
          { type: 'directDamage', min: 15, max: 17 },
          { type: 'incapacitate', duration: 4 },
        ],
      },
    ],
    description:
      'Strikes the target for $d damage, incapacitating it for 4 sec. Any damage breaks the effect. Awards 1 combo point.',
  },
  evasion: {
    id: 'evasion',
    tooltipOmitEffectLines: true,
    name: 'Ghostfoot',
    class: 'rogue',
    learnLevel: 8,
    cost: 0,
    castTime: 0,
    cooldown: 300,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_dodge', value: 0.5, duration: 15 }],
    description: 'Increases your dodge chance by 50% for 15 sec.',
  },
  slice_and_dice: {
    id: 'slice_and_dice',
    name: 'Cutthroat Tempo',
    class: 'rogue',
    learnLevel: 10,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    spendsCombo: true,
    // Engines feel pass (owner playtest): at real energy cadence a 24 sec max
    // uptime meant the buff was down every build cycle; 12 + 4 per combo
    // (32 sec at 5) keeps upkeep to roughly one refresh per engine payoff.
    effects: [{ type: 'finisherHaste', mult: 1.3, basedur: 12, perCombo: 4 }],
    description:
      'Finishing move that increases melee attack speed by 30% for 12 sec plus 4 sec per combo point (5 combo points: 32 sec).',
  },
  sprint: {
    id: 'sprint',
    tooltipOmitEffectLines: true,
    name: 'Swift Heels',
    class: 'rogue',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 300,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.7, duration: 15 }],
    description: 'Increases your movement speed by 70% for 15 sec.',
  },
  kidney_shot: {
    id: 'kidney_shot',
    name: 'Low Blow',
    class: 'rogue',
    learnLevel: 8,
    cost: 25,
    castTime: 0,
    cooldown: 20,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    spendsCombo: true,
    effects: [{ type: 'finisherStun', base: 1, perCombo: 1 }],
    description:
      'Finishing move that stuns the target for 1 sec plus 1 sec per combo point (5 combo points: 6 sec).',
  },
  ambush: {
    id: 'ambush',
    name: "Lurker's Strike",
    class: 'rogue',
    learnLevel: 5,
    cost: 60,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    requiresStealth: true,
    effects: [
      {
        type: 'weaponStrike',
        bonus: 28,
        requiresBehind: true,
        weaponMult: 2.5,
      },
    ],
    description:
      'Strike from the shadows for 250% weapon damage plus $d. Must be stealthed and behind the target. Requires a dagger. Awards 1 combo point.',
    specNotes: {
      subtlety:
        'Used from Duskveil this adds 1 Gloam (max 3). At 3 Gloam you can use it WITHOUT stealth and from any angle: that use costs nothing, spends all 3 Gloam, starts the 6 sec Shadow Veil, and hits for double.',
    },
  },
  stealth: {
    id: 'stealth',
    tooltipOmitEffectLines: true,
    name: 'Duskveil',
    class: 'rogue',
    learnLevel: 2,
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    requiresOutOfCombat: true,
    effects: [{ type: 'selfBuff', kind: 'stealth', value: 0.5, duration: 3600 }],
    description:
      'Conceals you in the shadows: enemies barely notice you, but you move 50% slower. Attacking or taking damage breaks Duskveil. Cast again to step out.',
    specNotes: {
      subtlety: 'Each opener you use from Duskveil adds 1 Gloam (max 3).',
    },
  },
  adrenaline_rush: {
    id: 'adrenaline_rush',
    name: 'Quickened Blood',
    class: 'rogue',
    learnLevel: 20,
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'gainResource', amount: 60 }],
    description: 'Your blood runs hot, instantly restoring 60 energy.',
  },
  garrote: {
    id: 'garrote',
    name: 'Throat Wire',
    class: 'rogue',
    learnLevel: 1,
    cost: 50,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    requiresStealth: true,
    effects: [
      { type: 'directDamage', min: 5, max: 7 },
      { type: 'dot', total: 60, duration: 18, interval: 3 },
    ],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 50,
        effects: [
          { type: 'directDamage', min: 9, max: 12 },
          { type: 'dot', total: 132, duration: 18, interval: 3 },
        ],
      },
    ],
    description:
      "Loop a wire around the enemy's throat, causing $d damage now and bleeding it for $o over 18 sec. Must be stealthed. Awards 1 combo point.",
    specNotes: {
      subtlety:
        'Used from Duskveil this adds 1 Gloam (max 3). At 3 Gloam you can use it WITHOUT stealth: that use costs nothing, spends all 3 Gloam, and starts the 6 sec Shadow Veil.',
    },
  },
  cheap_shot: {
    id: 'cheap_shot',
    name: 'Gut Punch',
    class: 'rogue',
    learnLevel: 8,
    cost: 60,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 2,
    requiresStealth: true,
    effects: [
      { type: 'directDamage', min: 6, max: 8 },
      { type: 'stun', duration: 4 },
    ],
    description:
      'Strike the target for $d damage, stunning it for 4 sec. Must be stealthed. Awards 2 combo points.',
    specNotes: {
      subtlety:
        'Used from Duskveil this adds 1 Gloam (max 3). At 3 Gloam you can use it WITHOUT stealth: that use costs nothing, spends all 3 Gloam, and starts the 6 sec Shadow Veil.',
    },
  },
  sap: {
    id: 'sap',
    name: 'Sap',
    class: 'rogue',
    learnLevel: 10,
    cost: 65,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    requiresStealth: true,
    requiresOutOfCombat: true,
    effects: [{ type: 'incapacitate', duration: 8 }],
    description:
      'Incapacitates the target for 8 sec. Must be stealthed and out of combat. Any damage breaks the effect.',
  },
  crippling_poison: {
    id: 'crippling_poison',
    name: 'Leaden Venom',
    class: 'rogue',
    learnLevel: 12,
    cost: 40,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 3, max: 5 },
      { type: 'slow', mult: 0.5, duration: 12 },
    ],
    description:
      'Strikes the target with a crippling poison, dealing $d Nature damage and slowing its movement speed by 50% for 12 sec.',
  },
  expose_armor: {
    id: 'expose_armor',
    name: 'Armor Breach',
    class: 'rogue',
    learnLevel: 14,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    spendsCombo: true,
    // Finisher: each combo point spent lands one Sunder stack (5 points = the
    // full 5-stack cap, 10% armor), classic Expose Armor style.
    effects: [{ type: 'sunder', armor: 170, maxStacks: 5, perCombo: true }],
    description:
      'Finishing move that exposes the target for 30 sec: each combo point spent reduces its armor by 2% (5 combo points: $d%).',
  },
  rupture: {
    id: 'rupture',
    name: 'Bleed Out',
    class: 'rogue',
    learnLevel: 14,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    spendsCombo: true,
    effects: [
      { type: 'dot', total: 96, duration: 16, interval: 2, baseDuration: 6, perComboDuration: 2 },
    ],
    description:
      'Finishing move that wounds the target: it bleeds every 2 sec, for 6 sec plus 2 sec per combo point (5 combo points: 16 sec and $d total damage).',
  },
  vanish: {
    id: 'vanish',
    tooltipOmitEffectLines: true,
    name: 'Smokefade',
    class: 'rogue',
    learnLevel: 18,
    cost: 0,
    castTime: 0,
    cooldown: 300,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'stealth', value: 0.5, duration: 10 }],
    description:
      'Melt from sight, entering Duskveil even in combat. You move 50% slower while hidden. Lasts up to 10 sec.',
  },
  instant_poison: {
    id: 'instant_poison',
    name: "Adder's Bite",
    class: 'rogue',
    learnLevel: 14,
    cost: 40,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 8, duration: 1800 }],
    description:
      'Coats your weapon for 30 min, causing each of your melee swings to deal 8 additional Nature damage.',
  },
  deadly_poison: {
    id: 'deadly_poison',
    name: 'Festering Venom',
    class: 'rogue',
    learnLevel: 14,
    cost: 40,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 14, duration: 1800 }],
    description:
      'Coats your weapon for 30 min, causing each of your melee swings to deal 14 additional Nature damage.',
  },
  blind: {
    id: 'blind',
    name: 'Dirt Toss',
    class: 'rogue',
    learnLevel: 20,
    cost: 50,
    castTime: 0,
    cooldown: 120,
    range: 5,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'incapacitate', duration: 8 }],
    description:
      "Tosses dirt into the target's eyes, causing it to wander disoriented for 8 sec. Any damage breaks the effect.",
  },

  // ====================== PALADIN ======================
  seal_of_righteousness: {
    id: 'seal_of_righteousness',
    name: 'Oathbrand',
    class: 'paladin',
    learnLevel: 1,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 4, duration: 30 }],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 35,
        effects: [{ type: 'imbue', bonus: 7, duration: 30 }],
      },
      {
        rank: 3,
        level: 16,
        cost: 50,
        effects: [{ type: 'imbue', bonus: 11, duration: 30 }],
      },
    ],
    description:
      'Fills you with Holy power for 30 sec, causing each of your melee swings to deal $d additional Holy damage.',
  },
  holy_light: {
    id: 'holy_light',
    name: 'Mending Light',
    class: 'paladin',
    learnLevel: 1,
    cost: 25,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 42, max: 51 }],
    ranks: [
      { rank: 2, level: 8, cost: 35, effects: [{ type: 'heal', min: 76, max: 90 }] },
      { rank: 3, level: 14, cost: 50, effects: [{ type: 'heal', min: 122, max: 144 }] },
      { rank: 4, level: 20, cost: 65, effects: [{ type: 'heal', min: 190, max: 222 }] },
    ],
    description:
      'Quickly heals a friendly target for $d. Restoring health generates 1 Devotion, even without a specialization. Radiant Resonance or Solar Reprisal makes it instant.',
  },
  devotion_aura: {
    id: 'devotion_aura',
    name: 'Steadfast Aura',
    class: 'paladin',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    exclusiveGroup: 'paladin_aura',
    effects: [
      {
        type: 'buffTarget',
        kind: 'buff_armor_pct',
        value: 10,
        duration: 1800,
        party: true,
      },
    ],
    description: 'Increases the armor of all party members by $b% for 30 min.',
  },
  blessing_of_might: {
    id: 'blessing_of_might',
    name: 'Oath of Iron',
    class: 'paladin',
    learnLevel: 4,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [
      {
        type: 'buffTarget',
        kind: 'buff_ap_pct',
        value: 10,
        duration: 1800,
        party: true,
      },
    ],
    description:
      'Blesses the party, increasing the attack power of all party members by $b% for 30 min.',
  },
  divine_protection: {
    id: 'divine_protection',
    name: 'Ward of Faith',
    class: 'paladin',
    learnLevel: 6,
    cost: 15,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'absorb', amount: 0, casterMaxHpPct: 0.25, duration: 10 }],
    description:
      'A holy shield absorbs $d% of your maximum health for $t sec. Enduring Protection increases the shield.',
  },
  // Paladin tank cooldown: a predictive divine cheat-death (the `guardian_ward`
  // aura, consumed by an enemy lethal blow in damage.ts). Its short window and
  // long cooldown make timing the defense the choice, rather than keeping it up.
  sacred_bulwark: {
    id: 'sacred_bulwark',
    name: 'Sacred Bulwark',
    class: 'paladin',
    learnLevel: 20,
    cost: 15,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'guardian_ward', value: 0.35, duration: 10 }],
    description:
      'For $t sec, the next enemy hit that would kill you is denied, restoring you to 35% health instead.',
  },
  hammer_of_justice: {
    id: 'hammer_of_justice',
    name: 'Sundering Gavel',
    class: 'paladin',
    learnLevel: 2,
    cost: 30,
    castTime: 0,
    cooldown: 60,
    range: 10,
    school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'stun', duration: 3 }],
    description: 'Stuns the target for $t sec.',
  },
  lay_on_hands: {
    id: 'lay_on_hands',
    name: 'Last Rite',
    class: 'paladin',
    // Level 8 so the row-8 pick that upgrades it (Steady Hands) has something to
    // upgrade the moment it is taken.
    learnLevel: 8,
    cost: 0,
    castTime: 0,
    cooldown: 600,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 0, max: 0, casterMaxHpPct: 1, canCrit: false }],
    description:
      'A massive surge that restores $d% of your maximum health and generates 1 Devotion when it restores health. 10 min cooldown.',
  },
  holy_taunt: {
    id: 'holy_taunt',
    name: 'Sacred Goad',
    class: 'paladin',
    learnLevel: 10,
    specs: ['protection'],
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    offGcd: true,
    effects: [{ type: 'taunt' }],
    description:
      'Goads the target: your threat rises to match its most hated enemy and it is compelled to attack you for 3 sec.',
  },
  flash_of_light: {
    id: 'flash_of_light',
    name: 'Lightmend',
    class: 'paladin',
    learnLevel: 12,
    cost: 35,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 62, max: 76 }],
    ranks: [{ rank: 2, level: 20, cost: 46, effects: [{ type: 'heal', min: 90, max: 110 }] }],
    description:
      'A quick, efficient burst of Light that heals a friendly target for $d. Restoring health generates 1 Devotion, even without a specialization.',
  },
  exorcism: {
    id: 'exorcism',
    name: 'Rite of Expulsion',
    class: 'paladin',
    learnLevel: 5,
    cost: 55,
    castTime: 0,
    cooldown: 15,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 46, max: 56 }],
    description: 'Banishes the wicked with Holy wrath, causing $d Holy damage.',
  },
  righteous_fury: {
    id: 'righteous_fury',
    name: 'Burning Oath',
    class: 'paladin',
    learnLevel: 5,
    specs: ['protection'],
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    passive: true,
    effects: [],
    description:
      'Passively increases the threat generated by your Holy damage by 60%. Faithwarden only.',
  },
  retribution_aura: {
    id: 'retribution_aura',
    name: 'Requital Aura',
    class: 'paladin',
    learnLevel: 7,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    exclusiveGroup: 'paladin_devotion',
    // Ranked from level 7. The reflect is a FLAT value: it takes no spell power,
    // no attack power and no level coefficient, and no talent touches it, so a
    // single authored number is the aura's whole lifetime. At 5 it read as real
    // pressure at 7 and as rounding error by 20, next to a kit that hits for 95 to
    // 115. The ranks keep it worth the aura slot all the way up; Sacred Concord
    // still triples whichever rank is live.
    effects: [
      {
        type: 'buffTarget',
        kind: 'thorns',
        value: 5,
        duration: 0,
        permanent: true,
        party: true,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 13,
        cost: 0,
        effects: [
          {
            type: 'buffTarget',
            kind: 'thorns',
            value: 12,
            duration: 0,
            permanent: true,
            party: true,
          },
        ],
      },
      {
        rank: 3,
        level: 18,
        cost: 0,
        effects: [
          {
            type: 'buffTarget',
            kind: 'thorns',
            value: 22,
            duration: 0,
            permanent: true,
            party: true,
          },
        ],
      },
    ],
    description:
      'Surrounds you and your party with holy energy until death or replacement. Enemies that strike an affected ally in melee take $b Holy damage, and affected allies deal $b additional Holy damage with auto-attacks. Replaces your own Bastion Devotion. Another Paladin casting Requital Aura refreshes it instead of stacking.',
  },

  // ====================== HUNTER ======================
  tame_beast: {
    id: 'tame_beast',
    name: 'Wildbond',
    class: 'hunter',
    learnLevel: 10,
    cost: 0,
    castTime: 6,
    cooldown: 0,
    range: 20,
    school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'tamePet' }],
    description:
      'Begins taming a beast to be your companion. It must be your level or lower and not an elite. Your pet follows you, attacks your enemies, and holds threat of its own. You may have one pet at a time.',
  },
  dismiss_pet: {
    id: 'dismiss_pet',
    name: 'Release Companion',
    class: 'hunter',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'dismissPet' }],
    description: 'Releases your pet back to the wild.',
  },
  revive_pet: {
    id: 'revive_pet',
    name: 'Patch Up',
    class: 'hunter',
    learnLevel: 10,
    cost: 45,
    castTime: 3,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'hot', total: 240, duration: 12, interval: 3 }],
    description:
      'Restore $o health to your living companion over 12 sec. Healing increases with Spell Power. If your companion is dead, revive it with 35% health instead.',
  },
  raptor_strike: {
    id: 'raptor_strike',
    name: 'Gutting Strike',
    class: 'hunter',
    learnLevel: 1,
    excludeSpecs: ['beast_mastery', 'marksmanship'],
    excludeSpecsAtLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'weaponStrike', bonus: 1, weaponMult: 0.1 }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 0,
        effects: [{ type: 'weaponStrike', bonus: 2, weaponMult: 0.1 }],
      },
      {
        rank: 3,
        level: 14,
        cost: 0,
        effects: [{ type: 'weaponStrike', bonus: 3, weaponMult: 0.1 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 0,
        effects: [{ type: 'weaponStrike', bonus: 16, weaponMult: 0.1 }],
      },
    ],
    description:
      'Strike for 10% weapon damage plus $d. A hit restores 15 Focus and grants 1 Hunting Momentum. Damage increases with Attack Power through weapon damage.',
  },
  pack_command: {
    id: 'pack_command',
    name: 'Pack Command',
    class: 'hunter',
    specs: ['beast_mastery'],
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 4,
    range: 35,
    school: 'physical',
    requiresTarget: true,
    actionReplacement: {
      abilityId: 'unleash_beast',
      auraKind: 'hunter_ferocity',
      minStacks: 3,
    },
    effects: [{ type: 'packCommand', min: 36, max: 48, focus: 20, ferocityDuration: 30 }],
    description:
      "Command your living pet to strike for 36 to 48 Physical damage. Damage increases with the pet's Attack Power. A hit restores 20 Focus and grants 1 Pack Ferocity for 30 sec, up to 3. Each stack increases all damage dealt by your pet by 10%. This strike uses the stacks you had before the hit.",
  },
  unleash_beast: {
    id: 'unleash_beast',
    name: 'Unleash Beast',
    class: 'hunter',
    specs: ['beast_mastery'],
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 35,
    school: 'physical',
    requiresTarget: true,
    effects: [
      {
        type: 'unleashBeast',
        primaryMin: 42,
        primaryMax: 53,
        clapMin: 57,
        clapMax: 75,
        secondaryClapMult: 1.5,
        radius: 6,
        frenzyDuration: 8,
      },
    ],
    description:
      "Consume 3 Pack Ferocity after your pet strikes for 42 to 53 Physical damage and claps every enemy within 6 yards for 57 to 75. The clap deals 50% more damage to enemies other than the main target. The strike and clap use Pack Ferocity's full 30% pet damage bonus and increase with the pet's Attack Power. For 8 sec afterward, the pet deals 25% more damage, attacks 35% faster, and makes Fell Shot cleave up to 2 enemies within 5 yards of the target.",
  },
  stampede: {
    id: 'stampede',
    name: 'Stampede',
    class: 'hunter',
    specs: ['beast_mastery'],
    learnLevel: 17,
    cost: 0,
    castTime: 0,
    cooldown: 90,
    range: 35,
    school: 'physical',
    requiresTarget: true,
    effects: [
      {
        type: 'hunterStampede',
        beasts: 3,
        duration: 12,
        attackInterval: 2,
        min: 18,
        max: 24,
        rangedPowerCoeff: 0.08,
      },
    ],
    description:
      'Summon 3 beasts for 12 sec. Each attacks every 2 sec for $d Physical damage. The shown damage includes 8% of your Ranged Attack Power before pet damage bonuses. The beasts snapshot Pack Ferocity when summoned, gaining 10% damage per stack. While Stampede is on cooldown, successful Pack Commands have a 20% chance to reset it, guaranteed after 5 failed chances. It cannot reset while the beasts are active. (Packlord)',
  },
  measured_shot: {
    id: 'measured_shot',
    name: 'Measured Shot',
    class: 'hunter',
    specs: ['marksmanship'],
    learnLevel: 5,
    cost: 0,
    castTime: 1.5,
    cooldown: 0,
    range: 35,
    minRange: 8,
    school: 'physical',
    projectile: true,
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 38, max: 48 },
      { type: 'gainResource', amount: 20 },
    ],
    description:
      'Shoot the target for $d Physical damage. A hit restores 20 Focus. Damage increases with Ranged Attack Power.',
  },
  aspect_of_the_hawk: {
    id: 'aspect_of_the_hawk',
    name: "Harrier's Guise",
    class: 'hunter',
    learnLevel: 4,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    exclusiveGroup: 'aspect',
    effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 20, duration: 1800 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 30,
        effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 35, duration: 1800 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 40,
        effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 50, duration: 1800 }],
      },
    ],
    description: "Adopt Harrier's Guise, increasing your Attack Power by $b for 30 min.",
  },
  serpent_sting: {
    id: 'serpent_sting',
    name: 'Venom Barb',
    class: 'hunter',
    learnLevel: 4,
    cost: 15,
    castTime: 0,
    cooldown: 0,
    range: 35,
    minRange: 8,
    school: 'nature',
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 20, duration: 15, interval: 3 }],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 25,
        effects: [{ type: 'dot', total: 35, duration: 15, interval: 3 }],
      },
      {
        rank: 3,
        level: 16,
        cost: 35,
        effects: [{ type: 'dot', total: 55, duration: 15, interval: 3 }],
      },
    ],
    description:
      'Deal $d total Nature damage over 15 sec, once every 3 sec. Damage increases with Ranged Attack Power.',
  },
  arcane_shot: {
    id: 'arcane_shot',
    name: 'Fell Shot',
    class: 'hunter',
    learnLevel: 5,
    cost: 25,
    castTime: 0,
    cooldown: 6,
    range: 35,
    minRange: 8,
    school: 'arcane',
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 13, max: 17 }],
    ranks: [
      { rank: 2, level: 12, cost: 25, effects: [{ type: 'directDamage', min: 24, max: 30 }] },
      { rank: 3, level: 18, cost: 25, effects: [{ type: 'directDamage', min: 38, max: 47 }] },
    ],
    description:
      'Shoot the target for $d Arcane damage. Damage increases with Ranged Attack Power.',
  },
  concussive_shot: {
    id: 'concussive_shot',
    name: 'Rattling Shot',
    class: 'hunter',
    learnLevel: 8,
    cost: 20,
    castTime: 0,
    cooldown: 12,
    range: 35,
    minRange: 8,
    school: 'physical',
    projectile: true, // a fired shot: damage/slow resolve when the bolt lands
    // A fired shot: its flat damage scales off Ranged AP like the other shots,
    // not melee AP, even though it is physical.
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 4, max: 6 },
      { type: 'slow', mult: 0.5, duration: 4 },
    ],
    description:
      'Shoot the target for $d Physical damage and slow it by 50% for 4 sec. Damage increases with Ranged Attack Power.',
  },
  mongoose_bite: {
    id: 'mongoose_bite',
    name: 'Woundrend',
    class: 'hunter',
    specs: ['survival'],
    learnLevel: 10,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'weaponStrike', bonus: 22, weaponMult: 0.45 }],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 30,
        effects: [{ type: 'weaponStrike', bonus: 54, weaponMult: 0.45 }],
      },
    ],
    description:
      'Strike for 45% weapon damage plus $d. If the target has your Bloodhook Wound, deal 1 wound tick immediately and refresh the wound to 12 sec. Damage increases with Attack Power through weapon damage.',
  },
  hunting_momentum: {
    id: 'hunting_momentum',
    name: 'Hunting Momentum',
    class: 'hunter',
    specs: ['survival'],
    learnLevel: 5,
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: Gutting Strike grants 1 Hunting Momentum for 8 sec, up to 3. At 3 stacks, Woundrend deals 45% more strike damage and consumes the stacks. (Fieldcraft)',
  },
  fieldcraft_reentry: {
    id: 'fieldcraft_reentry',
    name: 'Armed Re-entry',
    class: 'hunter',
    specs: ['survival'],
    learnLevel: 5,
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: Trailbreak refreshes Hunting Momentum and arms your next Gutting Strike or Bloodhook for 12 sec. Gutting Strike deals 15% more damage per stack. Bloodhook deals 18 to 24 extra Physical damage, increased by 15% per stack and by Ranged Attack Power. At 3 stacks, either attack consumes Hunting Momentum. (Fieldcraft)',
  },
  wing_clip: {
    id: 'wing_clip',
    name: 'Fettering Slash',
    class: 'hunter',
    learnLevel: 10,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 3, max: 5 },
      { type: 'slow', mult: 0.6, duration: 10 },
    ],
    description:
      'Slash the target for $d Physical damage and slow it by 40% for 10 sec. Damage increases with Attack Power.',
  },
  aspect_of_the_monkey: {
    id: 'aspect_of_the_monkey',
    name: "Marten's Guise",
    class: 'hunter',
    learnLevel: 5,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    exclusiveGroup: 'aspect',
    effects: [{ type: 'selfBuff', kind: 'buff_dodge', value: 0.08, duration: 1800 }],
    description: "Adopt Marten's Guise, increasing your dodge chance by 8% for 30 min.",
  },
  aspect_of_the_cheetah: {
    id: 'aspect_of_the_cheetah',
    name: "Courser's Guise",
    class: 'hunter',
    learnLevel: 5,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    exclusiveGroup: 'aspect',
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.3, duration: 1800 }],
    description: "Adopt Courser's Guise, increasing your movement speed by 30% for 30 min.",
  },
  pack_rally: {
    id: 'pack_rally',
    name: 'Pack Rally',
    class: 'hunter',
    learnLevel: 17,
    cost: 20,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    exclusiveGroup: 'aspect',
    effects: [
      { type: 'selfBuff', kind: 'buff_speed', value: 1.3, duration: 1800 },
      { type: 'hunterPackRally', duration: 10, radius: 30 },
    ],
    description:
      "Adopt Courser's Guise. You, your companion, and group or raid allies within 30 yards gain 30% movement speed and 10% attack, casting, and channeling speed for 10 sec.",
  },
  aimed_shot: {
    id: 'aimed_shot',
    name: 'Long Draw',
    class: 'hunter',
    specs: ['marksmanship'],
    learnLevel: 11,
    cost: 35,
    castTime: 2.5,
    cooldown: 0,
    range: 35,
    minRange: 8,
    school: 'physical',
    projectile: true, // a fired shot: damage resolves when the arrow lands
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 89, max: 109 }],
    description:
      'Shoot the target for $d Physical damage. Damage increases with Ranged Attack Power.',
  },
  rapid_fire: {
    id: 'rapid_fire',
    name: 'Fevered Draw',
    class: 'hunter',
    specs: ['marksmanship'],
    learnLevel: 14,
    cost: 0,
    castTime: 0,
    castWhileMoving: true,
    channel: { duration: 2.4, ticks: 6 },
    cooldown: 12,
    range: 35,
    minRange: 8,
    school: 'physical',
    projectile: true,
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 19, max: 26 }],
    description:
      'Fire 6 shots over 2.4 sec while moving. Each shot deals $d Physical damage and increases with Ranged Attack Power.',
  },
  shrapnel_charge: {
    id: 'shrapnel_charge',
    name: 'Shrapnel Charge',
    class: 'hunter',
    specs: ['survival'],
    learnLevel: 11,
    cost: 0,
    castTime: 0,
    cooldown: 12,
    range: 25,
    school: 'physical',
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [
      {
        type: 'hunterShrapnel',
        primaryMin: 24,
        primaryMax: 30,
        splashMin: 13,
        splashMax: 17,
        radius: 6,
        maxTargets: 5,
        spreadTotal: 12,
        spreadDuration: 6,
        spreadInterval: 2,
      },
    ],
    description:
      'Hit the target for 24 to 30 Physical damage and up to 4 other enemies within 6 yards for 13 to 17. Other targets also bleed for 12 damage over 6 sec. If the main target has your Bloodhook Wound, deal 1 wound tick immediately. Direct damage increases with Ranged Attack Power.',
  },
  bloodtrail_assault: {
    id: 'bloodtrail_assault',
    name: 'Bloodtrail Assault',
    class: 'hunter',
    specs: ['survival'],
    learnLevel: 17,
    cost: 0,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'hunter_bloodtrail', value: 1, duration: 12 }],
    description:
      'For 12 sec, Bloodhook spreads a 60%-strength wound to up to 2 enemies within 5 yards, Woundrend commands an 18-damage pet attack, and Shrapnel Charge gains 2 yards of radius, deals 25% more base damage to its main target, and triggers 50% more wound damage.',
  },
  trailbreak: {
    id: 'trailbreak',
    name: 'Trailbreak',
    class: 'hunter',
    learnLevel: 4,
    cost: 0,
    castTime: 0,
    cooldown: 15,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'hunterTrailbreak', distance: 12 }],
    description:
      'Leap 12 yards backward. If you have Hunting Momentum, refresh it and arm Re-entry for 12 sec.',
  },
  wildheart: {
    id: 'wildheart',
    name: 'Wildheart',
    class: 'hunter',
    learnLevel: 6,
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfHealPctMax', pct: 0.3 }],
    description: 'Immediately restore 30% of your maximum health.',
  },
  shellskin: {
    id: 'shellskin',
    name: 'Shellskin',
    class: 'hunter',
    learnLevel: 8,
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'shield_wall', value: 0.6, duration: 8 }],
    description: 'Reduce damage taken by 60% for 8 sec, but prevent attacks while active.',
  },
  frostjaw_trap: {
    id: 'frostjaw_trap',
    name: 'Frostjaw Trap',
    class: 'hunter',
    learnLevel: 11,
    cost: 0,
    castTime: 0,
    cooldown: 30,
    range: 30,
    school: 'frost',
    requiresTarget: false,
    effects: [
      {
        type: 'frostjawTrap',
        radius: 4,
        armTime: 0.75,
        lifetime: 30,
        rootDuration: 3,
        slowMult: 0.5,
        slowDuration: 4,
      },
    ],
    description:
      'Place a trap at the selected enemy or at your feet. It arms after 0.75 sec and lasts 30 sec. The first enemy to trigger it is rooted for 3 sec, and enemies within 4 yards are slowed by 50% for 4 sec.',
  },

  // ====================== PRIEST ======================
  smite: {
    id: 'smite',
    name: 'Scouring Hymn',
    class: 'priest',
    learnLevel: 1,
    cost: 20,
    castTime: 2.0,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 15, max: 20 }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 32,
        effects: [{ type: 'directDamage', min: 26, max: 33 }],
      },
      {
        rank: 3,
        level: 14,
        cost: 48,
        castTime: 2.5,
        effects: [{ type: 'directDamage', min: 42, max: 52 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 70,
        castTime: 2.5,
        effects: [{ type: 'directDamage', min: 64, max: 78 }],
      },
    ],
    description:
      'Deal $d Holy damage. Damage increases with Spell Power. Doctrine: heal each linked ally for 30% of the damage. If no ally is linked, heal the lowest-health party member for 15%.',
  },
  lesser_heal: {
    id: 'lesser_heal',
    name: 'Whispered Prayer',
    class: 'priest',
    learnLevel: 1,
    cost: 30,
    castTime: 2.0,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 47, max: 58 }],
    ranks: [
      {
        rank: 2,
        level: 6,
        cost: 45,
        effects: [{ type: 'heal', min: 72, max: 86 }],
      },
      {
        rank: 3,
        level: 12,
        cost: 65,
        effects: [{ type: 'heal', min: 110, max: 132 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 85,
        effects: [{ type: 'heal', min: 160, max: 192 }],
      },
    ],
    description: 'Heal a friendly target for $d. Healing increases with Spell Power.',
  },
  power_word_fortitude: {
    id: 'power_word_fortitude',
    name: 'Litany of Resolve',
    class: 'priest',
    learnLevel: 1,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'buffTarget', kind: 'buff_sta_pct', value: 5, duration: 1800, party: true }],
    description: 'Increase the Stamina of every party member by $b% for 30 min.',
  },
  shadow_word_pain: {
    id: 'shadow_word_pain',
    name: 'Dirge of Decay',
    class: 'priest',
    learnLevel: 4,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 30, duration: 18, interval: 3 }],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 38,
        effects: [{ type: 'dot', total: 54, duration: 18, interval: 3 }],
      },
      {
        rank: 3,
        level: 16,
        cost: 55,
        effects: [{ type: 'dot', total: 84, duration: 18, interval: 3 }],
      },
    ],
    description:
      'Deal $d total Shadow damage over 18 sec, once every 3 sec. Damage increases with Spell Power. Vespers: deal 10% more damage, and each tick on your Effigy grants 1 Gloomtithe.',
  },
  power_word_shield: {
    id: 'power_word_shield',
    name: 'Psalm of Warding',
    class: 'priest',
    learnLevel: 6,
    cost: 45,
    castTime: 0,
    cooldown: 6,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'absorb', amount: 48, duration: 30 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 70,
        effects: [{ type: 'absorb', amount: 90, duration: 30 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 100,
        effects: [{ type: 'absorb', amount: 145, duration: 30 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 130,
        effects: [{ type: 'absorb', amount: 210, duration: 30 }],
      },
    ],
    description:
      'Shield a friendly target, absorbing $d damage for 30 sec. Doctrine also links the target to your Holy damage for 30 sec.',
  },
  renew: {
    id: 'renew',
    name: 'Lingering Grace',
    class: 'priest',
    learnLevel: 8,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'hot', total: 45, duration: 15, interval: 3 }],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 50,
        effects: [{ type: 'hot', total: 90, duration: 15, interval: 3 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 75,
        effects: [{ type: 'hot', total: 205, duration: 15, interval: 3 }],
      },
    ],
    description:
      'Heal the target for $d over 15 sec, once every 3 sec. Healing increases with Spell Power.',
  },
  mind_blast: {
    id: 'mind_blast',
    name: 'Mindfracture',
    class: 'priest',
    learnLevel: 5,
    cost: 50,
    castTime: 1.5,
    cooldown: 8,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 42, max: 46 }],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 70,
        effects: [{ type: 'directDamage', min: 60, max: 66 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 95,
        effects: [{ type: 'directDamage', min: 86, max: 94 }],
      },
    ],
    description:
      'Deal $d Shadow damage. Damage increases with Spell Power. Vespers binds a target with your Dirge of Decay as its Effigy, grants 1 Gloomtithe, and echoes 30% of the damage to up to 3 other enemies with your Dirge.',
  },
  heal: {
    id: 'heal',
    name: 'Solemn Prayer',
    class: 'priest',
    learnLevel: 14,
    cost: 95,
    castTime: 2.5,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 165, max: 195 }],
    ranks: [{ rank: 2, level: 20, cost: 130, effects: [{ type: 'heal', min: 335, max: 390 }] }],
    description: 'Heal a friendly target for $d. Healing increases with Spell Power.',
  },
  mind_flay: {
    id: 'mind_flay',
    name: 'Litany of Woe',
    class: 'priest',
    learnLevel: 14,
    cost: 45,
    castTime: 0,
    channel: { duration: 3, ticks: 3 },
    cooldown: 0,
    range: 20,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'drainTick', min: 12, max: 12, healFrac: 0 }],
    description:
      'Channel for 3 sec, dealing $d Shadow damage each second. Damage increases with Spell Power.',
  },
  flash_heal: {
    id: 'flash_heal',
    name: 'Urgent Prayer',
    class: 'priest',
    learnLevel: 20,
    cost: 75,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 174, max: 206 }],
    description: 'Heal a friendly target for $d. Healing increases with Spell Power.',
  },

  // ====================== SHAMAN ======================
  lightning_bolt: {
    id: 'lightning_bolt',
    name: 'Arc Bolt',
    class: 'shaman',
    learnLevel: 1,
    cost: 15,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    projectileFx: 'lightning', // a jagged electric bolt instead of the default glowing bolt
    effects: [{ type: 'directDamage', min: 15, max: 17 }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 25,
        castTime: 2.0,
        effects: [{ type: 'directDamage', min: 26, max: 30 }],
      },
      {
        rank: 3,
        level: 14,
        cost: 40,
        castTime: 2.5,
        effects: [{ type: 'directDamage', min: 45, max: 51 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 60,
        castTime: 3.0,
        effects: [{ type: 'directDamage', min: 75, max: 85 }],
      },
    ],
    description:
      'Deal $d Nature damage. Damage increases with Spell Power. Thundercall: a hit grants 1 Thunder.',
  },
  thunder_reservoir: {
    id: 'thunder_reservoir',
    name: 'Thunder Reservoir',
    class: 'shaman',
    specs: ['elemental'],
    learnLevel: 5,
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: Arc Bolt and Skybranch grant Thunder, up to 5. At 5 Thunder, Earthen Jolt deals 125% more damage or Faultwake deals 100% more damage, then consumes all Thunder. (Thundercall)',
  },
  rockbiter_weapon: {
    id: 'rockbiter_weapon',
    name: 'Stonebound Weapon',
    class: 'shaman',
    excludeSpecs: ['elemental', 'restoration'],
    excludeSpecsAtLevel: 5,
    learnLevel: 1,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 5, duration: 1800 }],
    ranks: [
      { rank: 2, level: 8, cost: 30, effects: [{ type: 'imbue', bonus: 9, duration: 1800 }] },
      { rank: 3, level: 16, cost: 45, effects: [{ type: 'imbue', bonus: 14, duration: 1800 }] },
    ],
    description:
      'Imbue your weapon for 30 min. Each swing deals $d extra damage. Warspirit also gains 30% armor, takes 10% less damage, and generates twice as much threat. Earthen Jolt forces its target to attack you for 3 sec, and Thunder Ward grants 10% damage reduction for 3 sec.',
  },
  galeheart_weapon: {
    id: 'galeheart_weapon',
    name: 'Galeheart Weapon',
    class: 'shaman',
    specs: ['enhancement'],
    learnLevel: 5,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 0, duration: 1800 }],
    description: 'Imbue both weapons for 30 min, enabling Warspirit Cadence.',
  },
  warspirit_cadence: {
    id: 'warspirit_cadence',
    name: 'Warspirit Cadence',
    class: 'shaman',
    specs: ['enhancement'],
    learnLevel: 5,
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: Dual-wield attacks have no extra miss chance. Every 3rd landed weapon attack triggers 2 Galeheart Echoes for 50% Nature damage and grants Stormcast for 12 sec. Stormcast makes your next Arc Bolt, Jolt, or Mending Waters instant and cost 50% less Mana. Ancestral Strike counts as 2 attacks. (Warspirit)',
  },
  stormsurge: {
    id: 'stormsurge',
    name: 'Stormsurge',
    class: 'shaman',
    specs: ['enhancement'],
    learnLevel: 14,
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: While Ancestral Strike is on cooldown, consuming Stormcast has a 25% chance to reset it. If the first 3 chances fail, the 4th always resets it. (Warspirit)',
  },
  lifespring_weapon: {
    id: 'lifespring_weapon',
    name: 'Lifespring Weapon',
    class: 'shaman',
    specs: ['restoration'],
    learnLevel: 5,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 0, duration: 1800 }],
    description:
      'Imbue your weapon for 30 min. Mending Waters and Tidecall add 20% more healing to Mending Current.',
  },
  // Shared Shaman action whose effect follows the active spec weapon enchant.
  elemental_trance: {
    id: 'elemental_trance',
    name: 'Elemental Trance',
    class: 'shaman',
    specs: ['enhancement'],
    learnLevel: 20,
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_dr', value: 0.3, duration: 15 }],
    description:
      'Enter an elemental trance for 15 sec, reducing damage taken by 30% and converting 20% of all damage you deal into mana. (Warspirit signature)',
  },
  unleash_weapon: {
    id: 'unleash_weapon',
    name: 'Unleash Weapon',
    class: 'shaman',
    learnLevel: 14,
    cost: 35,
    castTime: 0,
    cooldown: 15,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'any',
    projectile: false,
    effects: [],
    description:
      'Trigger your active weapon enchant. Pyrebrand: deal 54 to 64 Fire damage plus 30% of your Spell Power and gain 2 Thunder. Galeheart: strike with your weapon, advance Warspirit Cadence, and gain 20% attack speed for 6 sec. Stonebound: strike for 75% weapon damage, force the target to attack you for 3 sec, and take 20% less damage for 4 sec. Lifespring: consume Mending Current, heal for 125% of its remaining healing, and reduce the next hit within 8 sec by 50% of the health restored.',
  },
  // Restoration Shaman signature, granted only by the Spiritcall spec.
  chain_heal: {
    id: 'chain_heal',
    name: 'Cascading Mend',
    class: 'shaman',
    learnLevel: 10,
    cost: 60,
    castTime: 2.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [
      {
        type: 'chainHeal',
        min: 120,
        max: 145,
        jumps: 2,
        falloff: 0.5,
        radius: 12,
      },
    ],
    description:
      'Heal a friendly target for $d, then jump to up to 2 allies within 12 yards. Each jump heals for 50% of the previous target. Each ally reached consumes your remaining Mending Current and immediately heals for 125% of the amount consumed. The initial heal increases with Spell Power. (Spiritcall signature)',
  },
  ancestor_return: {
    id: 'ancestor_return',
    name: "Ancestors' Return",
    class: 'shaman',
    specs: ['restoration'],
    learnLevel: 20,
    cost: 250,
    castTime: 7,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    requiresOutOfCombat: true,
    projectile: false,
    effects: [{ type: 'massResurrectGroup', hpFrac: 0.3 }],
    description:
      'Call every fallen member of your group or raid back to life at their body with 30% health and mana. Cannot be cast in combat. (Spiritcall)',
  },
  healing_wave: {
    id: 'healing_wave',
    name: 'Mending Waters',
    class: 'shaman',
    learnLevel: 1,
    cost: MENDING_WATERS_MANA_COST,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 36, max: 44 }],
    ranks: [
      {
        rank: 2,
        level: 6,
        cost: 40,
        castTime: 2.0,
        effects: [{ type: 'heal', min: 56, max: 68 }],
      },
      {
        rank: 3,
        level: 12,
        cost: 65,
        castTime: 2.5,
        effects: [{ type: 'heal', min: 92, max: 110 }],
      },
      {
        rank: 4,
        level: 18,
        cost: 90,
        castTime: 2.5,
        effects: [{ type: 'heal', min: 138, max: 164 }],
      },
      {
        rank: 5,
        level: 20,
        cost: 115,
        castTime: 2.5,
        effects: [{ type: 'heal', min: 200, max: 238 }],
      },
    ],
    description:
      "Heal a friendly target for $d. Healing increases with Spell Power. Spiritcall: store 50% of the full heal before overhealing as Mending Current for 12 sec, up to 30% of the target's maximum health.",
  },
  tidecall: {
    id: 'tidecall',
    name: 'Tidecall',
    class: 'shaman',
    specs: ['restoration'],
    learnLevel: 10,
    cost: TIDECALL_MANA_COST,
    castTime: 0,
    cooldown: 12,
    maxCharges: 2,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 58, max: 72 }],
    description:
      "Heal a friendly target for $d. Healing increases with Spell Power. Add the full heal before overhealing to Mending Current, up to 30% of the target's maximum health.",
  },
  earth_shock: {
    id: 'earth_shock',
    name: 'Earthen Jolt',
    class: 'shaman',
    learnLevel: 4,
    cost: 30,
    castTime: 0,
    cooldown: 6,
    range: 20,
    school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 19, max: 22 }],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 45,
        effects: [{ type: 'directDamage', min: 33, max: 38 }],
      },
      {
        rank: 3,
        level: 16,
        cost: 65,
        effects: [{ type: 'directDamage', min: 54, max: 61 }],
      },
    ],
    description:
      'Deal $d Nature damage. Damage increases with Spell Power. Thundercall: at 5 Thunder, deal 125% more damage and consume all Thunder. Stonebound: force the target to attack you for 3 sec.',
  },
  lightning_shield: {
    id: 'lightning_shield',
    name: 'Thunder Ward',
    class: 'shaman',
    learnLevel: 5,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [
      {
        type: 'selfBuff',
        kind: 'thorns',
        value: 13,
        duration: 600,
        charges: 3,
        internalCooldown: 5,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 40,
        effects: [
          {
            type: 'selfBuff',
            kind: 'thorns',
            value: 20,
            duration: 600,
            charges: 3,
            internalCooldown: 5,
          },
        ],
      },
      {
        rank: 3,
        level: 18,
        cost: 55,
        effects: [
          {
            type: 'selfBuff',
            kind: 'thorns',
            value: 29,
            duration: 600,
            charges: 3,
            internalCooldown: 5,
          },
        ],
      },
    ],
    description:
      'Surround yourself with lightning for 10 min. The next 3 melee attacks against you deal $b Nature damage to the attacker, at most once every 5 sec.',
  },
  flame_shock: {
    id: 'flame_shock',
    name: 'Cinder Jolt',
    class: 'shaman',
    learnLevel: 8,
    cost: 35,
    castTime: 0,
    cooldown: 6,
    range: 20,
    school: 'fire',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 25, max: 25 },
      { type: 'dot', total: 28, duration: 12, interval: 3 },
    ],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 55,
        effects: [
          { type: 'directDamage', min: 42, max: 42 },
          { type: 'dot', total: 48, duration: 12, interval: 3 },
        ],
      },
    ],
    description:
      'Deal $d Fire damage, then $o Fire damage over 12 sec. The initial hit increases with Spell Power.',
  },
  flametongue_weapon: {
    id: 'flametongue_weapon',
    name: 'Pyrebrand Weapon',
    class: 'shaman',
    specs: ['elemental'],
    learnLevel: 5,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 8, duration: 1800 }],
    ranks: [
      { rank: 2, level: 18, cost: 40, effects: [{ type: 'imbue', bonus: 13, duration: 1800 }] },
    ],
    description: 'Imbues your weapon for 30 min. Each swing deals $d additional Fire damage.',
  },
  frost_shock: {
    id: 'frost_shock',
    name: 'Rime Jolt',
    class: 'shaman',
    learnLevel: 8,
    cost: 50,
    castTime: 0,
    cooldown: 6,
    range: 20,
    school: 'frost',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 36, max: 42 },
      { type: 'slow', mult: 0.5, duration: 8 },
    ],
    description:
      'Deal $d Frost damage and slow the target by 50% for 8 sec. Damage increases with Spell Power.',
  },
  frostbrand_weapon: {
    id: 'frostbrand_weapon',
    name: 'Rimebound Weapon',
    class: 'shaman',
    learnLevel: 5,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 8, duration: 300 }],
    ranks: [
      {
        rank: 2,
        level: 20,
        cost: 40,
        effects: [{ type: 'imbue', bonus: 13, duration: 300 }],
      },
    ],
    description:
      'Imbues your weapon with biting frost: each swing deals $d additional damage for 5 min.',
  },
  ghost_wolf: {
    id: 'ghost_wolf',
    name: 'Shadewolf',
    class: 'shaman',
    learnLevel: 5,
    cost: 35,
    castTime: 2.0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.4, duration: 3600 }],
    description:
      'Become a Shadewolf and move 40% faster. Cast again to return to your normal form.',
  },
  stormstrike: {
    id: 'stormstrike',
    name: 'Ancestral Strike',
    class: 'shaman',
    learnLevel: 20,
    cost: 40,
    castTime: 0,
    cooldown: 12,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'weaponStrike', bonus: 26 }],
    description:
      'Strike for weapon damage plus $d and advance Warspirit Cadence by 2 steps. Damage increases with Attack Power through weapon damage.',
  },

  // ====================== WARLOCK ======================
  evil_eye: {
    id: 'evil_eye',
    name: 'Evil Eye',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 5,
    cost: 15,
    castTime: 0,
    cooldown: 1,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    projectile: false,
    effects: [{ type: 'afflictionEvilEye' }],
    description:
      'Marks one enemy as the focus of your curses. Moving the Eye preserves Condemnation but does not refresh its 20 sec expiry.',
  },
  maledict_gaze: {
    id: 'maledict_gaze',
    name: 'Maledict Gaze',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: false,
    passive: true,
    effects: [],
    description:
      'Your Maledict Eye attacks your selected primary Evil Eye every 2.5 sec for Shadow damage. Possess the Evil Eye doubles its attack speed.',
  },
  needle_of_fate: {
    id: 'needle_of_fate',
    name: 'Needle of Fate',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 5,
    cost: 25,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'afflictionNeedle' }, { type: 'directDamage', min: 22, max: 27 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 30,
        effects: [{ type: 'afflictionNeedle' }, { type: 'directDamage', min: 36, max: 43 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 35,
        effects: [{ type: 'afflictionNeedle' }, { type: 'directDamage', min: 41, max: 49 }],
      },
    ],
    description:
      'Pierces the enemy for $d Shadow damage and generates 7 Condemnation if it bears your Evil Eye. Each hit on your primary Evil Eye adds a Fate Thread for 12 sec, up to 3. If no Evil Eye exists, the Needle first marks its target.',
  },
  sentence: {
    id: 'sentence',
    name: 'Sentence',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 5,
    cost: 40,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    requiresAuraKind: 'affliction_doom',
    requiresAuraStacks: 20,
    effects: [{ type: 'afflictionSentence' }],
    description:
      'Consumes all Condemnation and Fate Threads to pass sentence on the enemy. Each Thread increases damage by 6%. Added effects escalate at 20, 50, 80, and 100 Condemnation. Its damage scaling flattens after level 16.',
  },
  cursed_accomplice: {
    id: 'cursed_accomplice',
    name: 'Cursed Accomplice',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 7,
    cost: 40,
    castTime: 0,
    cooldown: 0,
    range: 40,
    school: 'shadow',
    requiresTarget: true,
    targetType: 'friendly',
    partyOnlyTarget: true,
    effects: [{ type: 'afflictionAccomplice' }],
    description:
      'Links your Maledict Eye when no ally is selected, making its Gaze generate 2 Condemnation. Linking one selected group member makes only their damage to your Evil Eye generate 3 instead. A new link replaces the previous one and may trigger once every 2 sec.',
  },
  hex_of_violence: {
    id: 'hex_of_violence',
    name: 'Hex of Violence',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 12,
    cost: 55,
    castTime: 0,
    cooldown: 15,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [
      {
        type: 'afflictionViolence',
        duration: 8,
        charges: 3,
        doomPerProc: 7,
        damage: 16,
      },
    ],
    description:
      'Hexes the enemy for 8 sec. Its next 3 damaging actions each generate 7 Condemnation and lash it for 16 Shadow damage.',
  },
  cruel_pact: {
    id: 'cruel_pact',
    name: 'Cruel Pact',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 9,
    cost: 0,
    castTime: 0,
    cooldown: 20,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [
      {
        type: 'afflictionCruelPact',
        healthPct: 0.12,
        manaPctMax: 0.015,
        doom: 20,
      },
    ],
    description:
      'Sacrifices 12% of your maximum health to restore 1.5% of your maximum mana and generate 20 Condemnation. Cannot be used at or below 20% health.',
  },
  vicarious_suffering: {
    id: 'vicarious_suffering',
    name: 'Vicarious Suffering',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 14,
    cost: 50,
    castTime: 0,
    cooldown: 30,
    range: 40,
    school: 'shadow',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'afflictionVicarious', duration: 8, maxDoom: 15 }],
    description:
      'Links your suffering for 8 sec and generates up to 15 Condemnation from hostile hits. On yourself, reduces damage taken by 20%. On an ally, redirects up to 20% to you without taking you below 15% health.',
  },
  possess_evil_eye: {
    id: 'possess_evil_eye',
    name: 'Possess the Evil Eye',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 13,
    cost: 75,
    castTime: 0,
    cooldown: 45,
    offGcd: true,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    projectile: false,
    effects: [{ type: 'afflictionPossession', duration: 15, doom: 35 }],
    description:
      'The Maledictor possesses your primary Evil Eye for 15 sec and generates 35 Condemnation. Needle of Fate casts in 1 sec and generates 2 extra Condemnation, Consume can be channeled while moving, and Sentence deals 25% more damage and releases a delayed echo for 60% damage, tapering to 30% across levels 17-20.',
  },
  hour_of_judgment: {
    id: 'hour_of_judgment',
    name: 'Hour of Judgment',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 20,
    cost: 0,
    castTime: 0,
    cooldown: 90,
    offGcd: true,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    projectile: false,
    effects: [{ type: 'afflictionJudgment', duration: 15, doom: 40, refund: 50 }],
    description:
      'Calls judgment upon your primary Evil Eye for 15 sec, granting 40 Condemnation and 3 Fate Threads, activating Possession, doubling Condemnation generated through the primary Eye, and increasing Sentence damage by 20%. The first Sentence refunds 50 Condemnation.',
  },
  coven: {
    id: 'coven',
    name: 'Coven',
    class: 'warlock',
    specs: ['affliction'],
    learnLevel: 17,
    cost: 120,
    castTime: 0,
    cooldown: 90,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    projectile: false,
    effects: [{ type: 'afflictionCoven', duration: 15, radius: 15, maxSecondary: 4 }],
    description:
      'Creates secondary Evil Eyes on up to 4 nearby enemies for 15 sec. They feed the shared Condemnation pool at 50%, and Sentence echoes to them for 35% damage.',
  },
  shadow_bolt: {
    id: 'shadow_bolt',
    name: 'Gloom Bolt',
    class: 'warlock',
    excludeSpecs: ['affliction', 'demonology'],
    learnLevel: 1,
    cost: 25,
    castTime: 1.7,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 36, max: 50 }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 38,
        castTime: 2.2,
        effects: [{ type: 'directDamage', min: 67, max: 87 }],
      },
      {
        rank: 3,
        level: 14,
        cost: 55,
        castTime: 2.7,
        effects: [{ type: 'directDamage', min: 118, max: 148 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 80,
        castTime: 3.0,
        effects: [{ type: 'directDamage', min: 126, max: 156 }],
      },
    ],
    description: 'Sends a shadowy bolt at the enemy for $d Shadow damage.',
  },
  demon_skin: {
    id: 'demon_skin',
    name: 'Fiendhide',
    class: 'warlock',
    learnLevel: 1,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 30, duration: 1800 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 35,
        effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 55, duration: 1800 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 50,
        effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 80, duration: 1800 }],
      },
    ],
    description: 'Demonic skin increases your armor by $b for 30 min.',
  },
  immolate: {
    id: 'immolate',
    name: 'Burning Pact',
    class: 'warlock',
    specs: ['destruction'],
    learnLevel: 1,
    cost: 25,
    castTime: 2.0,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 31, max: 31 },
      { type: 'dot', total: 56, duration: 15, interval: 3 },
    ],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 40,
        effects: [
          { type: 'directDamage', min: 62, max: 62 },
          { type: 'dot', total: 98, duration: 15, interval: 3 },
        ],
      },
      {
        rank: 3,
        level: 16,
        cost: 60,
        effects: [
          { type: 'directDamage', min: 70, max: 70 },
          { type: 'dot', total: 100, duration: 15, interval: 3 },
        ],
      },
    ],
    description: 'Burns the enemy for $d Fire damage and an additional $o over 15 sec.',
  },
  corruption: {
    id: 'corruption',
    name: 'Blackrot',
    class: 'warlock',
    excludeSpecs: ['affliction', 'demonology', 'destruction'],
    learnLevel: 4,
    cost: 35,
    castTime: 2.0,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 40, duration: 18, interval: 3 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 55,
        effects: [{ type: 'dot', total: 72, duration: 18, interval: 3 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 75,
        effects: [{ type: 'dot', total: 85, duration: 18, interval: 3 }],
      },
    ],
    description: 'Corrupts the target, causing $d Shadow damage over 18 sec.',
  },
  life_tap: {
    id: 'life_tap',
    name: 'Hard Bargain',
    class: 'warlock',
    excludeSpecs: ['affliction'],
    excludeSpecsAtLevel: 14,
    learnLevel: 6,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'lifeTap', hp: 30, mana: 30 }],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 0,
        effects: [{ type: 'lifeTap', hp: 55, mana: 55 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 0,
        effects: [{ type: 'lifeTap', hp: 85, mana: 85 }],
      },
    ],
    description: 'Converts $d health into $d mana.',
  },
  curse_of_agony: {
    id: 'curse_of_agony',
    name: 'Hex of Anguish',
    class: 'warlock',
    excludeSpecs: ['affliction', 'demonology', 'destruction'],
    learnLevel: 8,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 36, duration: 24, interval: 3 }],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 40,
        effects: [{ type: 'dot', total: 72, duration: 24, interval: 3 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 60,
        effects: [{ type: 'dot', total: 78, duration: 24, interval: 3 }],
      },
    ],
    description: 'Curses the target with agony: $d Shadow damage over 24 sec.',
  },
  drain_life: {
    id: 'drain_life',
    name: 'Consume',
    class: 'warlock',
    excludeSpecs: ['demonology'],
    learnLevel: 7,
    cost: 25,
    castTime: 0,
    channel: { duration: 3, ticks: 3 },
    cooldown: 0,
    range: 20,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'drainTick', min: 7, max: 7, healFrac: 0.7 }],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 35,
        effects: [{ type: 'drainTick', min: 12, max: 12, healFrac: 0.7 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 45,
        effects: [{ type: 'drainTick', min: 17, max: 17, healFrac: 0.7 }],
      },
    ],
    description:
      "Consumes the target's vitality, dealing $d Shadow damage each second and transferring 70% of it as health. Affliction transfers all of it instead. When channeled on your primary Evil Eye, it consumes all Fate Threads at the start, and each Thread generates 1 extra Condemnation per tick.",
  },
  soul_lance: {
    id: 'soul_lance',
    name: 'Soul Lance',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 9,
    cost: 35,
    castTime: 1.6,
    cooldown: 8,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 30, max: 36 }],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 50,
        effects: [{ type: 'directDamage', min: 50, max: 60 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 65,
        effects: [{ type: 'directDamage', min: 80, max: 95 }],
      },
    ],
    description:
      'Hurls a spectral lance for $d Shadow damage. Against your Ossuary Mark, 50% of its damage is added to the mark.',
  },
  litany_of_guilt: {
    id: 'litany_of_guilt',
    name: 'Litany of Guilt',
    class: 'warlock',
    specs: ['affliction'],
    // Hexcraft had no area damage at all before level 11, which is half of the
    // game. Rank 1 lands at 8 as a deliberately weak two-target wave; ranks 2
    // and 3 keep the values Litany already had at 11 and 20, so nothing that
    // existed before is nerfed.
    learnLevel: 8,
    cost: 35,
    castTime: 0,
    cooldown: 20,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    projectile: false,
    effects: [
      {
        type: 'afflictionLitany',
        duration: 6,
        radius: 8,
        maxTargets: 2,
        damage: 5,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 11,
        cost: 50,
        effects: [
          {
            type: 'afflictionLitany',
            duration: 8,
            radius: 8,
            maxTargets: 4,
            damage: 9,
          },
        ],
      },
      {
        rank: 3,
        level: 20,
        cost: 65,
        effects: [
          {
            type: 'afflictionLitany',
            duration: 8,
            radius: 8,
            maxTargets: 4,
            damage: 14,
          },
        ],
      },
    ],
    description:
      'Curses your primary Evil Eye for 6 sec. Condemnation gains release a wave that damages up to 2 other enemies within 8 yd, at most once per second. Rank 2 extends it to 8 sec and 4 enemies.',
  },
  umbral_anchor: {
    id: 'umbral_anchor',
    name: 'Umbral Anchor',
    class: 'warlock',
    learnLevel: 5,
    cost: 25,
    castTime: 0,
    cooldown: 45,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'warlockUmbralAnchor', duration: 300, maxRange: 40 }],
    description:
      'First cast: anchors your shadow at your feet for 5 min. Recast within 40 m to return there, consuming the anchor and starting a 45 sec cooldown.',
  },
  soulwell: {
    id: 'soulwell',
    name: 'Soulwell',
    class: 'warlock',
    learnLevel: 8,
    cost: 80,
    castTime: 3,
    cooldown: 300,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    requiresOutOfCombat: true,
    effects: [{ type: 'summonSoulwell', duration: 180 }],
    description:
      'Summons a Soulwell for 3 min. While outside combat, group members can refill their Soul Stones up to 3. A Soul Stone restores 25% of maximum health and shares the potion cooldown.',
  },
  fear: {
    id: 'fear',
    name: 'Harrow',
    class: 'warlock',
    learnLevel: 10,
    cost: 40,
    castTime: 1.5,
    cooldown: 0,
    range: 20,
    school: 'shadow',
    requiresTarget: true,
    fearDr: true,
    effects: [{ type: 'incapacitate', duration: 8 }],
    description:
      'Strikes terror into the enemy, leaving it cowering for up to 8 sec. Any damage breaks the effect.',
  },
  searing_pain: {
    id: 'searing_pain',
    name: 'Sear',
    class: 'warlock',
    learnLevel: 7,
    cost: 35,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    excludeSpecs: ['affliction', 'demonology', 'destruction'],
    effects: [{ type: 'directDamage', min: 30, max: 38 }],
    description: 'Sears the enemy with agonizing fire for $d Fire damage. Quick to cast.',
  },
  shadowburn: {
    id: 'shadowburn',
    name: 'Duskfire',
    class: 'warlock',
    learnLevel: 12,
    cost: 35,
    ruinCost: 1,
    castTime: 0,
    cooldown: 12,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    specs: ['destruction'],
    // executeThreshold, not requiresTargetHpBelow: Duskfire is STRICTLY below 20%
    // (a target sitting exactly on the line is not claimable), which is what its
    // description promises and what the Wrack-refund window is tuned around.
    // Warrior Execute keeps the looser at-or-below requiresTargetHpBelow gate.
    executeThreshold: 0.2,
    effects: [
      { type: 'duskfireClaim', duration: 5 },
      { type: 'directDamage', min: 72, max: 84 },
    ],
    description:
      'Spends 1 Wrack to execute an enemy below 20% health for $d Shadow damage. Refunds its Wrack if the claimed target dies within 5 sec.',
  },
  ruinous_brand: {
    id: 'ruinous_brand',
    name: 'Ruinous Brand',
    class: 'warlock',
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    cooldown: 20,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    projectile: false,
    specs: ['destruction'],
    effects: [{ type: 'ruinousBrand', duration: 15, charges: 3 }],
    description:
      'Brands an enemy for 15 sec. Your next 3 direct spells echo for 25% damage against the branded enemy, or copy 50% damage to it when cast against another target.',
  },
  // Ruination's personal defensive. It is the siege caster's only active
  // mitigation: Fiendhide is passive armor and Sanguine Covenant costs a
  // talent point. Placed at level 8 so every specialization gains its
  // defensive button at the same level (Necromancy takes Bone Armor there).
  cinderhide: {
    id: 'cinderhide',
    name: 'Cinderhide',
    class: 'warlock',
    learnLevel: 8,
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    specs: ['destruction'],
    effects: [
      {
        type: 'selfBuff',
        kind: 'buff_dr',
        value: 0.25,
        duration: 10,
        auraId: 'cinderhide',
        auraName: 'Cinderhide',
      },
    ],
    description: 'Hardens your skin to cooling slag for 10 sec, reducing all damage taken by 25%.',
  },
  summon_imp: {
    id: 'summon_imp',
    name: 'Summon Emberkin',
    class: 'warlock',
    excludeSpecs: ['affliction', 'demonology'],
    learnLevel: 1,
    cost: 50,
    castTime: 5,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'emberkin' }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 50,
        effects: [{ type: 'summonDemon', mobId: 'emberkin' }],
      },
      {
        rank: 3,
        level: 14,
        cost: 50,
        effects: [{ type: 'summonDemon', mobId: 'emberkin' }],
      },
      {
        rank: 4,
        level: 20,
        cost: 50,
        effects: [{ type: 'summonDemon', mobId: 'emberkin' }],
      },
    ],
    description:
      'Summons an Emberkin under the command of the Warlock. The Emberkin casts Felbolt at your enemies from afar. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_voidwalker: {
    id: 'summon_voidwalker',
    name: 'Summon Duskmurk',
    class: 'warlock',
    excludeSpecs: ['affliction', 'demonology'],
    learnLevel: 5,
    cost: 80,
    castTime: 5,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'gloomshade' }],
    description:
      'Summons a Duskmurk under the command of the Warlock. This sturdy demon taunts enemies and uses Abyssal Chain to drag distant normal enemies back into reach. Bosses cannot be pulled. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_infernal: {
    id: 'summon_infernal',
    name: 'Summon Pyre Colossus',
    class: 'warlock',
    learnLevel: 13,
    cost: 100,
    castTime: 0,
    cooldown: 180,
    range: 30,
    school: 'fire',
    requiresTarget: false,
    targetMode: 'position',
    specs: ['destruction'],
    effects: [
      { type: 'aoeDamage', min: 58, max: 72, radius: 6 },
      { type: 'summonPyreColossus', duration: 30 },
    ],
    description:
      'Calls a Pyre Colossus down at the target area, dealing 58-72 Fire damage on impact. It fights for 30 sec without replacing your demon, burns nearby enemies every 2 sec, and generates 1 Wrack every 1 sec.',
  },
  soul_harvest: {
    id: 'soul_harvest',
    name: 'Essence Reap',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 1,
    cost: 30,
    castTime: 1.8,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 16, max: 20 },
      { type: 'gainSoulFragments', amount: 1 },
    ],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 45,
        effects: [
          { type: 'directDamage', min: 32, max: 39 },
          { type: 'gainSoulFragments', amount: 1 },
        ],
      },
      {
        rank: 3,
        level: 20,
        cost: 55,
        effects: [
          { type: 'directDamage', min: 44, max: 55 },
          { type: 'gainSoulFragments', amount: 1 },
        ],
      },
    ],
    description:
      'Tears at the enemy soul for $d Shadow damage and creates 1 Soul Fragment, up to 5.',
  },
  raise_graveguard: {
    id: 'raise_graveguard',
    name: 'Raise Graveguard',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 1,
    cost: 0,
    castTime: 2.5,
    cooldown: 3,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonUndead', templateId: 'graveguard', temporary: false }],
    description:
      'Raises a permanent defensive companion. Graveguard automatically taunts, intercepts 20% of your damage through Grave Dominion, and Reaping Command makes it taunt and take 30% less damage for 4 sec.',
  },
  raise_skeletal_warrior: {
    id: 'raise_skeletal_warrior',
    name: 'Raise Skeletal Warrior',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 5,
    cost: 20,
    soulFragmentCost: 1,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [
      {
        type: 'summonUndead',
        templateId: 'necromancy_skeletal_warrior',
        temporary: true,
      },
    ],
    description:
      'Spends 1 Soul Fragment to add a persistent Skeletal Warrior to your 2-slot Dominion. Only one may serve you. It cleaves nearby enemies for 45% damage every 6 sec, and Reaping Command pins its target with a 40% slow for 4 sec.',
  },
  raise_bone_mage: {
    id: 'raise_bone_mage',
    name: 'Raise Bone Mage',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 8,
    cost: 35,
    soulFragmentCost: 2,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [
      {
        type: 'summonUndead',
        templateId: 'necromancy_bone_mage',
        temporary: true,
      },
    ],
    description:
      'Spends 2 Soul Fragments to add a persistent ranged Bone Mage to your 2-slot Dominion. Only one may serve you. Its attacks expose the target to 5% more magic damage for 6 sec, and Reaping Command raises that weakness to 8%.',
  },
  bone_armor: {
    id: 'bone_armor',
    name: 'Bone Armor',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 8,
    cost: 45,
    castTime: 0,
    cooldown: 45,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'selfAbsorbPctMax', pct: 0.2, duration: 12 }],
    description: 'Wraps you in bone, absorbing damage equal to 20% of your maximum health.',
  },
  corpse_explosion: {
    id: 'corpse_explosion',
    name: 'Corpse Explosion',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 11,
    cost: 30,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'shadow',
    requiresTarget: false,
    targetMode: 'position',
    effects: [{ type: 'aoeDamage', min: 48, max: 60, radius: 8, canCrit: true }],
    description:
      'Sacrifices a Bone Mage first, then a Skeletal Warrior, and a Gravewing only as a last resort. Among duplicates it chooses the one with the least remaining duration, then the weakest, to deal $d Shadow damage at the chosen location.',
  },
  funeral_harvest: {
    id: 'funeral_harvest',
    name: 'Funeral Harvest',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    passive: true,
    effects: [],
    description:
      'When an enemy recently damaged by you or your undead dies, you gain 1 Soul Fragment. This can occur once every 3 sec.',
  },
  ossuary_mark: {
    id: 'ossuary_mark',
    name: 'Ossuary Mark',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 12,
    cost: 30,
    castTime: 0,
    cooldown: 20,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    projectile: false,
    effects: [
      {
        type: 'necromancyOssuaryMark',
        duration: 12,
        storedDamagePct: 0.2,
        soulLanceBonusPct: 0.5,
        deathRadius: 6,
      },
    ],
    description:
      'Marks an enemy for 12 sec, storing 20% of damage dealt by you and your undead. Recast to detonate it. If the marked enemy dies, it explodes within 6 yards and creates 1 Soul Fragment.',
  },
  unholy_command: {
    id: 'unholy_command',
    name: 'Unholy Command',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 13,
    cost: 40,
    soulFragmentCost: 3,
    castTime: 0,
    cooldown: 45,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'commandUndead', duration: 12, dmgPct: 0.25, hastePct: 0.2 }],
    description:
      'Spends 3 Soul Fragments to command all of your undead to deal 25% more damage and act 20% faster for 12 sec.',
  },
  reaping_command: {
    id: 'reaping_command',
    name: 'Reaping Command',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 14,
    cost: 45,
    soulFragmentCost: 2,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    projectile: false,
    effects: [{ type: 'reapingCommand' }],
    description:
      'Spends 2 Soul Fragments to command every undead servant to strike in unison. Graveguards taunt and brace, Warriors pin, Bone Mages expose magic defenses, and Gravewing rends all enemies hit.',
  },
  sacrifice_undead: {
    id: 'sacrifice_undead',
    name: 'Sacrifice Undead',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 7,
    cost: 0,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'sacrificeUndead', healPctMax: 0.25 }],
    description: 'Destroys one Dominion servant to restore 25% of your maximum health.',
  },
  raise_gravewing: {
    id: 'raise_gravewing',
    name: 'Raise Gravewing',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 17,
    cost: 45,
    soulFragmentCost: 2,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [
      {
        type: 'summonUndead',
        templateId: 'necromancy_gravewing',
        temporary: true,
      },
    ],
    description:
      'Spends 2 Soul Fragments to add a persistent Gravewing to your 2-slot Dominion. Only one may serve you. It cleaves nearby enemies for 65% damage every 5 sec, and Reaping Command makes every enemy struck take 8% more damage for 5 sec.',
  },
  army_of_the_dead: {
    id: 'army_of_the_dead',
    name: 'Army of the Dead',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 16,
    cost: 100,
    castTime: 1.5,
    cooldown: 120,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'armyOfDead', duration: 20 }],
    description:
      'Tears open a grave portal to raise a temporary Skeletal Warrior, Bone Mage, and Gravewing for 20 sec, filling the ranks your standing Dominion servants leave empty.',
  },

  // ====================== DRUID ======================
  wrath: {
    id: 'wrath',
    name: 'Wildbolt',
    class: 'druid',
    learnLevel: 1,
    cost: 20,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 13, max: 16 }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 32,
        castTime: 2.0,
        effects: [{ type: 'directDamage', min: 24, max: 29 }],
      },
      { rank: 3, level: 14, cost: 48, effects: [{ type: 'directDamage', min: 70, max: 84 }] },
      {
        rank: 4,
        level: 20,
        cost: 70,
        effects: [{ type: 'directDamage', min: 38, max: 48, spellPowerCoeff: 0.4 }],
      },
    ],
    description: 'Hurls a bolt of nature energy for $d Nature damage.',
    specNotes: {
      balance:
        'In Moonwing Form, each completed cast adds 1 Moontide (max 3). At 3 Moontide, Moonseed becomes Moonsurge and Skyfall becomes Sunwake.',
    },
  },
  healing_touch: {
    id: 'healing_touch',
    name: 'Wildmend',
    class: 'druid',
    learnLevel: 1,
    cost: 25,
    castTime: 2.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 37, max: 51 }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 45,
        castTime: 3.0,
        effects: [{ type: 'heal', min: 68, max: 86 }],
      },
      {
        rank: 3,
        level: 14,
        cost: 75,
        effects: [{ type: 'heal', min: 115, max: 140 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 110,
        effects: [{ type: 'heal', min: 254, max: 302 }],
      },
    ],
    description: 'Heals a friendly target for $d.',
  },
  mark_of_the_wild: {
    id: 'mark_of_the_wild',
    tooltipOmitEffectLines: true,
    name: 'Wildward',
    class: 'druid',
    learnLevel: 1,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [
      {
        type: 'buffTarget',
        kind: 'buff_stats_pct',
        value: 5,
        duration: 1800,
        party: true,
      },
    ],
    description:
      'Places the Wildward on the party, increasing all attributes of all party members by $b% for 30 min.',
  },
  moonfire: {
    id: 'moonfire',
    name: 'Lunar Tempest',
    class: 'druid',
    learnLevel: 4,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 9, max: 12 },
      { type: 'dot', total: 12, duration: 9, interval: 3 },
    ],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 40,
        effects: [
          { type: 'directDamage', min: 17, max: 21 },
          { type: 'dot', total: 24, duration: 12, interval: 3 },
        ],
      },
      {
        rank: 3,
        level: 16,
        cost: 60,
        effects: [
          { type: 'directDamage', min: 50, max: 60 },
          { type: 'dot', total: 70, duration: 12, interval: 3 },
        ],
      },
    ],
    description: 'Burns the enemy with moonfire for $d Arcane damage plus damage over time.',
    specNotes: {
      balance: 'Keep it burning: Moonseed extends it by 6 sec.',
    },
  },
  moonseed: {
    id: 'moonseed',
    name: 'Moonseed',
    class: 'druid',
    specs: ['balance'],
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    requiresAuraKind: 'form_moonkin',
    consumesRequiredAura: false,
    actionReplacement: {
      abilityId: 'moonlash',
      auraKind: 'moontide',
      minStacks: 3,
      actorAuraKind: 'form_moonkin',
    },
    effects: [
      { type: 'directDamage', min: 20, max: 26 },
      { type: 'extendDot', dot: 'moonfire', seconds: 6, maxBonus: 6 },
    ],
    description:
      'Moonwing Form only. Strikes for $d Arcane damage, adds 1 Moontide (max 3), and extends your Lunar Tempest by 6 sec, up to 6 sec per application. At 3 Moontide, this button becomes Moonsurge: an instant strike for 136 to 162 Arcane damage (plus spell power) that spends all 3.',
  },
  rejuvenation: {
    id: 'rejuvenation',
    name: 'Wildbloom',
    class: 'druid',
    learnLevel: 4,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'hot', total: 32, duration: 12, interval: 3 }],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 40,
        effects: [{ type: 'hot', total: 56, duration: 12, interval: 3 }],
      },
      {
        rank: 3,
        level: 16,
        cost: 60,
        effects: [{ type: 'hot', total: 88, duration: 12, interval: 3 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 80,
        effects: [{ type: 'hot', total: 168, duration: 12, interval: 3 }],
      },
    ],
    description: 'Heals the target for $d over 12 sec.',
    specNotes: {
      restoration:
        'Planting a NEW bloom adds 1 Verdance (max 5). At 5 Verdance, Fleetmend becomes Overbloom.',
    },
  },
  thorns: {
    id: 'thorns',
    tooltipOmitEffectLines: true,
    name: 'Briarguard',
    class: 'druid',
    learnLevel: 6,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'buffTarget', kind: 'thorns', value: 3, duration: 600 }],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 35,
        effects: [{ type: 'buffTarget', kind: 'thorns', value: 6, duration: 600 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 50,
        effects: [{ type: 'buffTarget', kind: 'thorns', value: 9, duration: 600 }],
      },
    ],
    description: 'Thorns sprout from the target: melee attackers take $b Nature damage.',
  },
  entangling_roots: {
    id: 'entangling_roots',
    name: 'Gripping Roots',
    class: 'druid',
    learnLevel: 8,
    cost: 35,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'root', duration: 12 }],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 50,
        effects: [
          { type: 'root', duration: 12 },
          { type: 'dot', total: 32, duration: 12, interval: 3 },
        ],
      },
    ],
    description: 'Roots the target in place for up to 12 sec.',
  },
  bear_form: {
    id: 'bear_form',
    tooltipOmitEffectLines: true,
    name: 'Bruin Form',
    class: 'druid',
    learnLevel: 8,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_bear', value: 0.65, duration: 3600 }],
    description:
      'Shapeshift into a bear: armor +130%, greatly increased attack power, your attacks build rage and generate 30% more threat. Cast again to return to caster form.',
  },
  bear_charge: {
    id: 'bear_charge',
    name: 'Bruin Rush',
    class: 'druid',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 15,
    range: 25,
    minRange: 8,
    school: 'physical',
    requiresTarget: true,
    offGcd: true,
    requiresForm: 'bear',
    effects: [{ type: 'charge' }, { type: 'stun', duration: 1 }],
    description:
      'Rush an enemy, generating 9 rage and stunning it for 1 sec. 8-25 yd range. Bruin Form only.',
  },
  maul: {
    id: 'maul',
    name: 'Bonecrush',
    class: 'druid',
    learnLevel: 10,
    cost: 15,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    onNextSwing: true,
    offGcd: true,
    requiresForm: 'bear',
    threat: { flat: 35 }, // classic 180 at rank 7/level 58, scaled to the 1-20 band
    effects: [{ type: 'weaponDamage', bonus: 18 }],
    actionReplacement: { abilityId: 'marrowbreak', auraKind: 'old_blood', minStacks: 3 },
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 15,
        threatFlat: 50,
        effects: [{ type: 'weaponDamage', bonus: 27 }],
      },
    ],
    description:
      'A mauling attack that increases melee damage by $d and causes a high amount of threat. Activates on your next swing. Bruin Form only.',
    specNotes: {
      feral:
        'Each hit that lands adds 1 Old Blood; at 3 Old Blood this button becomes Marrowbreak: a strike for 78 to 96 damage at high threat; below half health it instead shields you for 18% of your maximum health and refunds 15 rage.',
    },
  },
  growl: {
    id: 'growl',
    name: 'Menace',
    class: 'druid',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 8,
    school: 'physical',
    requiresTarget: true,
    offGcd: true,
    requiresForm: 'bear',
    effects: [{ type: 'taunt' }],
    description:
      'Menaces the target: your threat rises to match its most hated enemy and it is compelled to attack you for 3 sec. Bruin Form only.',
  },
  demoralizing_roar: {
    id: 'demoralizing_roar',
    name: 'Craven Roar',
    class: 'druid',
    learnLevel: 10,
    cost: 10,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    requiresForm: 'bear',
    effects: [{ type: 'aoeAttackPower', amount: 20, duration: 20, radius: 8 }],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 10,
        effects: [{ type: 'aoeAttackPower', amount: 35, duration: 20, radius: 8 }],
      },
    ],
    description:
      'Demoralizes nearby enemies, reducing their attack power by 20 for 20 sec. Bruin Form only.',
  },
  cat_form: {
    id: 'cat_form',
    tooltipOmitEffectLines: true,
    name: 'Wolf Form',
    class: 'druid',
    learnLevel: 5,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_cat', value: 0.71, duration: 3600 }],
    description:
      'Shapeshift into a wolf: agility rises with your level, attack power +8 plus 2 per level, your attacks use energy and combo points, and you generate 29% less threat. Cast again to return to caster form.',
  },
  prowl: {
    id: 'prowl',
    tooltipOmitEffectLines: true,
    name: 'Stalk',
    class: 'druid',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    requiresForm: 'cat',
    requiresOutOfCombat: true,
    effects: [{ type: 'selfBuff', kind: 'stealth', value: 0.5, duration: 3600 }],
    description: 'Enter stealth while in Wolf Form, moving 50% slower. Cannot be used in combat.',
  },
  rake: {
    id: 'rake',
    name: 'Flense',
    class: 'druid',
    learnLevel: 5,
    cost: 35,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    requiresForm: 'cat',
    effects: [
      { type: 'weaponStrike', bonus: 8 },
      { type: 'dot', total: 30, duration: 18, interval: 3 },
    ],
    ranks: [
      {
        rank: 2,
        level: 18,
        cost: 35,
        effects: [
          { type: 'weaponStrike', bonus: 34 },
          { type: 'dot', total: 99, duration: 18, interval: 3 },
        ],
      },
    ],
    description:
      'Flense the enemy for weapon damage plus $d and cause bleeding damage over 18 sec. Awards 1 combo point. Wolf Form only.',
    specNotes: {
      feral: 'Each hit that lands adds 1 Old Blood (max 3).',
    },
  },
  claw: {
    id: 'claw',
    name: 'Rendclaw',
    class: 'druid',
    learnLevel: 5,
    cost: 45,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    requiresForm: 'cat',
    effects: [{ type: 'weaponStrike', bonus: 25 }],
    ranks: [{ rank: 2, level: 18, cost: 45, effects: [{ type: 'weaponStrike', bonus: 55 }] }],
    description: 'Claw the enemy for weapon damage plus $d. Awards 1 combo point. Wolf Form only.',
    specNotes: {
      feral: 'Each hit that lands adds 1 Old Blood (max 3).',
    },
  },
  ferocious_bite: {
    id: 'ferocious_bite',
    name: 'Gorebite',
    class: 'druid',
    learnLevel: 14,
    cost: 35,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    spendsCombo: true,
    requiresForm: 'cat',
    effects: [{ type: 'finisherDamage', base: 45, perCombo: 39, variance: 8 }],
    actionReplacement: { abilityId: 'redharvest', auraKind: 'old_blood', minStacks: 3 },
    description: 'Finishing move that causes $d. Wolf Form only.',
    specNotes: {
      feral:
        'Each hit that lands adds 1 Old Blood; at 3 Old Blood this button becomes Redharvest: a bite for 70 plus 43 per combo point that also instantly deals all the damage your Flense and Bloodrift would still have dealt, and restores 30 energy.',
    },
  },
  swipe: {
    id: 'swipe',
    name: 'Sweeping Claws',
    class: 'druid',
    learnLevel: 16,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    requiresForm: 'bear',
    threat: { mult: 1.75 }, // classic: swipe damage causes 1.75x threat
    effects: [{ type: 'aoeDamage', min: 12, max: 15, radius: 5 }],
    description:
      'Sweep your claws through nearby enemies for $d damage. Causes extra threat. Bruin Form only.',
    specNotes: {
      feral: 'Each hit that lands adds 1 Old Blood (max 3).',
    },
  },
  regrowth: {
    id: 'regrowth',
    name: 'Second Bloom',
    class: 'druid',
    learnLevel: 14,
    cost: 55,
    castTime: 2.0,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [
      { type: 'heal', min: 52, max: 62 },
      { type: 'hot', total: 49, duration: 21, interval: 3 },
    ],
    ranks: [
      {
        rank: 2,
        level: 20,
        cost: 72,
        effects: [
          { type: 'heal', min: 75, max: 90 },
          { type: 'hot', total: 71, duration: 21, interval: 3 },
        ],
      },
    ],
    description: 'Heals a friendly target for $d and an additional amount over 21 sec.',
    specNotes: {
      restoration: 'Planting a NEW bloom adds 1 Verdance (max 5).',
    },
  },
  barkskin: {
    id: 'barkskin',
    tooltipOmitEffectLines: true,
    name: 'Oakhide',
    class: 'druid',
    learnLevel: 16,
    cost: 30,
    castTime: 0,
    cooldown: 60,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    offGcd: true,
    // A tank cooldown, so it must fire mid-fight in Bruin Form (or Wolf Form)
    // like Primal Reflexes/Primal Surge below, not just pre-cast in caster form.
    usableInForm: true,
    effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 150, duration: 15 }],
    description: 'Your skin hardens like bark, increasing armor by 150 for 15 sec.',
  },
  // Druid tank cooldown: a dodge-based defensive (distinct from Oakhide's armor
  // boost). Usable while shapeshifted so a bear tank pops it mid-fight; buff_dodge
  // rides into dodgeChance in recalcPlayerStats.
  primal_reflexes: {
    id: 'primal_reflexes',
    tooltipOmitEffectLines: true,
    name: 'Primal Reflexes',
    class: 'druid',
    learnLevel: 20,
    cost: 0,
    castTime: 0,
    cooldown: 60,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    offGcd: true,
    usableInForm: true,
    effects: [{ type: 'selfBuff', kind: 'buff_dodge', value: 0.5, duration: 6 }],
    description: 'Your instincts sharpen, increasing your chance to dodge by 50% for 6 sec.',
  },
  starfire: {
    id: 'starfire',
    name: 'Skyfall',
    class: 'druid',
    learnLevel: 14,
    cost: 80,
    castTime: 3.0,
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 135, max: 185 }],
    actionReplacement: {
      abilityId: 'sunlance',
      auraKind: 'moontide',
      minStacks: 3,
      actorAuraKind: 'form_moonkin',
    },
    description: 'Calls down a bolt of stellar fire, causing $d Arcane damage.',
    specNotes: {
      balance:
        'In Moonwing Form, each completed cast adds 1 Moontide (max 3). At 3 Moontide, this button becomes Sunwake: an instant strike for 80 to 100 Nature damage plus a 45 burn over 9 sec, restoring 35 mana and spending all 3.',
    },
  },
  travel_form: {
    id: 'travel_form',
    tooltipOmitEffectLines: true,
    name: 'Fleet Form',
    class: 'druid',
    learnLevel: 11,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_travel', value: 1.4, duration: 3600 }],
    description:
      'Instantly shift into a swift travel form, increasing movement speed by 40%. You cannot use other abilities while shifted, but can shift in or out of combat, ideal for escaping.',
  },
  enrage: {
    id: 'enrage',
    name: 'Stoke',
    class: 'druid',
    learnLevel: 16,
    cost: 0,
    castTime: 0,
    cooldown: 60,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    requiresForm: 'bear',
    effects: [{ type: 'gainResource', amount: 20 }],
    description: 'Generates 20 rage instantly. Bruin Form only.',
  },
  bash: {
    id: 'bash',
    name: 'Concuss',
    class: 'druid',
    learnLevel: 8,
    cost: 10,
    castTime: 0,
    cooldown: 60,
    range: 8,
    school: 'physical',
    requiresTarget: true,
    requiresForm: 'bear',
    effects: [{ type: 'stun', duration: 2 }],
    description: 'Stuns the target for 2 sec. Bruin Form only.',
  },
  faerie_fire: {
    id: 'faerie_fire',
    name: 'Witchlight',
    class: 'druid',
    learnLevel: 18,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'faerieFire', duration: 40 }],
    description: "Decreases the target's armor by $d% for 40 sec.",
  },
  hibernate: {
    id: 'hibernate',
    name: 'Slumber',
    class: 'druid',
    learnLevel: 18,
    cost: 50,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'incapacitate', duration: 8 }],
    description: 'Forces the target into a deep sleep for up to 8 sec. Any damage will awaken it.',
  },
  dash: {
    id: 'dash',
    tooltipOmitEffectLines: true,
    name: 'Dash',
    class: 'druid',
    learnLevel: 18,
    cost: 0,
    castTime: 0,
    cooldown: 60,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    requiresForm: 'cat',
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.5, duration: 15 }],
    description: 'Sprint forward, increasing movement speed by 50% for 15 sec. Wolf Form only.',
  },
  pounce: {
    id: 'pounce',
    name: 'Slinkstrike',
    class: 'druid',
    learnLevel: 18,
    cost: 50,
    castTime: 0,
    cooldown: 0,
    range: 8,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    requiresForm: 'cat',
    requiresStealth: true,
    effects: [{ type: 'stun', duration: 2 }],
    description:
      'A stealth opener that stuns the target for 2 sec. Awards 1 combo point. Wolf Form only.',
  },
  insect_swarm: {
    id: 'insect_swarm',
    name: 'Stinging Swarm',
    class: 'druid',
    learnLevel: 20,
    cost: 45,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 48, duration: 12, interval: 3 }],
    description: 'The enemy is swarmed by insects, taking $d Nature damage over 12 sec.',
  },
  tigers_fury: {
    id: 'tigers_fury',
    tooltipOmitEffectLines: true,
    name: 'Wolfsblood',
    class: 'druid',
    learnLevel: 20,
    cost: 30,
    castTime: 0,
    cooldown: 30, // balance pass: was 0 (spammable permanent +40 AP)
    range: 0,
    school: 'physical',
    requiresTarget: false,
    requiresForm: 'cat',
    effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 40, duration: 6 }],
    description: 'Increases attack power by $b for $t sec. Wolf Form only.',
  },
  rip: {
    id: 'rip',
    name: 'Bloodrift',
    class: 'druid',
    learnLevel: 14,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    spendsCombo: true,
    requiresForm: 'cat',
    effects: [
      { type: 'dot', total: 156, duration: 24, interval: 2, baseTotal: 36, perComboTotal: 24 },
    ],
    description:
      'Finishing move that makes the target bleed every 2 sec for 24 sec: 36 damage plus 24 per combo point spent (5 combo points: $d total). Wolf Form only.',
    specNotes: {
      feral: 'The landed hit adds 1 Old Blood (max 3).',
    },
  },

  // ============== TALENT-GRANTED (Warrior) ==============
  // Not in CLASSES.warrior.abilities - unlocked only via talent grants (spec
  // signatures + active nodes), so abilitiesKnownAt adds them by `mods.grants`.
  mortal_strike: {
    id: 'mortal_strike',
    name: 'Maiming Strike',
    class: 'warrior',
    learnLevel: 5,
    cost: 30,
    castTime: 0,
    cooldown: 6,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    threat: { mult: 1.2 },
    effects: [
      // Balance 2026-07-10 (owner): 40 -> 50 bonus and the bleed 24 -> 30, the
      // Arms round-3 buff after Brute Swing became the free builder.
      { type: 'weaponStrike', bonus: 50 },
      { type: 'buffTarget', kind: 'mortal_wound', value: 0.5, duration: 10 },
      // Deep Wounds passive (Arms restructure 2026-07-08): Maiming Strike leaves
      // a bleed. Arms-scoped naturally (mortal_strike is Arms-granted). A distinct
      // auraId keeps it from overwriting the mortal_wound healing debuff above.
      {
        type: 'dot',
        total: 30,
        duration: 6,
        interval: 3,
        auraId: 'deep_wounds',
      },
    ],
    description:
      'A vicious strike dealing weapon damage plus $d and reducing healing the target receives by 50% for 10 sec. Applies Gaping Wounds (bleed). (Arms signature)',
  },
  bloodthirst: {
    id: 'bloodthirst',
    name: 'Bloodletting',
    class: 'warrior',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 6,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [
      { type: 'weaponStrike', bonus: 30, weaponMult: 0.5 },
      { type: 'selfHealPctMax', pct: 0.03 },
      { type: 'gainResource', amount: 12 },
      // 30% chance to Enrage for 4 sec (the classic Bloodthirst proc).
      { type: 'enrageChance', chance: 0.3, duration: 4 },
    ],
    description:
      'Instantly attack in a blood frenzy for $d, healing you for 3% of your maximum health and generating 12 rage. Has a 30% chance to Enrage you. (Fury signature)',
  },
  shield_slam: {
    id: 'shield_slam',
    name: 'Shieldcrack',
    class: 'warrior',
    learnLevel: 5,
    requiresShield: true,
    // Protection's active rage BUILDER (owner 2026-07-08): no cost, and it
    // GENERATES 15 rage on a short cooldown, so the tank loop is take-hits +
    // Shieldcrack to build, then spend on Revenge / Armor Shear. Prot-only
    // (spec signature), so no per-spec gate is needed on the rage grant.
    cost: 0,
    castTime: 0,
    cooldown: 6,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    threat: { flat: 110 },
    effects: [
      { type: 'weaponStrike', bonus: 30, weaponMult: 0.5 },
      { type: 'gainResource', amount: 15 },
    ],
    description:
      'Slam the target with your shield for $d and massive threat, generating 15 rage. (Protection signature)',
  },
  whirlwind: {
    id: 'whirlwind',
    name: 'Bladed Gyre',
    class: 'warrior',
    learnLevel: 10,
    // Fury-only (balance pass 2026-07-10): Fury had no baseline AoE, so it gets
    // Bladed Gyre back as its spec AoE tool. Arms/Prot keep their own AoE
    // (Reaping Arc / Quaking Blow); no-spec never learns it.
    specs: ['fury'],
    // Bladed Gyre is free but mints nothing (v0.27.1 rage fix): with Twinstrike,
    // Bloodletting, AND the spin all generating, Fury's whole rotation was
    // rage-positive and Red Harvest fired every ~6s. Bloodletting is now the one
    // generating builder; the spin keeps its zero cost and echo utility.
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [
      {
        type: 'aoeDamage',
        min: 30,
        max: 42,
        radius: 8,
      },
      // Bladed Echo: arms the caster for 2 echoing casts (combat/area_echo.ts).
      // Its own aoeDamage disqualifies whirlwind from consuming the charge.
      {
        type: 'selfBuff',
        kind: 'aoe_echo',
        value: 0,
        duration: 12,
        charges: 2,
        auraId: 'bladed_echo',
        auraName: 'Bladed Echo',
      },
    ],
    description:
      'Spin in a deadly arc, striking all nearby enemies for $d at no rage cost. Your next 2 single-target abilities also strike enemies near their target. (Fury talent)',
  },
  berserker_rage: {
    id: 'berserker_rage',
    name: 'Seething Fury',
    class: 'warrior',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'gainResource', amount: 20 }],
    description: 'Enter a berserker rage, generating 20 rage. (Warrior talent)',
  },
  // ------ Base-kit rescues from PR #1348 (owner ruling: these three are BASE
  // warrior abilities, not talents) ------
  pummel: {
    id: 'pummel',
    name: 'Jawcrack',
    class: 'warrior',
    learnLevel: 8,
    // Owner design: free, and stopping a cast GENERATES 10 rage (the reward
    // makes the interrupt a play, not a tax).
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    offGcd: true,
    effects: [{ type: 'interrupt', lockout: 4, rageOnInterrupt: 10 }],
    description:
      'Interrupts spellcasting, preventing any spell in that school from being cast for 4 sec. Generates 10 rage when it stops a cast.',
  },
  heroic_leap: {
    id: 'heroic_leap',
    name: 'Vaulting Charge',
    class: 'warrior',
    learnLevel: 6,
    cost: 0,
    castTime: 0,
    // 30s (was 20s, owner 2026-08-07): the warrior mobility budget in PvP is the
    // whole point of the level-5 row re-cut above, and Vaulting Charge is the other
    // half of it. Base kit, so this lands on all three specs.
    cooldown: 30,
    range: 30,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    effects: [{ type: 'repositionToAim', landingAoe: { min: 24, max: 32, radius: 6 } }],
    description: 'Leap to the target area, dealing $d damage to nearby enemies on landing.',
  },
  rallying_cry: {
    id: 'rallying_cry',
    castFx: 'shout',
    name: 'Valor Roar',
    class: 'warrior',
    learnLevel: 18,
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    // Owner rework: the WoW-style defensive raid horn (+20% temporary maximum
    // health), 40yd (the classic raid-buff reach).
    effects: [{ type: 'aoeAllyMaxHp', pct: 0.2, duration: 10, radius: 40 }],
    description:
      'Lets loose a valorous roar, granting you and party members within 40 yards 20% additional maximum health for 10 sec. Protection: they also take 5% less damage for the duration.',
  },
  // ------ Choice-row talents (warrior_rows.ts grants; numbers are the owner's
  // design draft, tune VALUE not SHAPE) ------
  storm_bolt: {
    id: 'storm_bolt',
    name: 'Thunderhurl',
    class: 'warrior',
    learnLevel: 11,
    cost: 10,
    castTime: 0,
    cooldown: 30,
    range: 20,
    school: 'physical',
    requiresTarget: true,
    projectile: true,
    effects: [
      { type: 'directDamage', min: 18, max: 26 },
      { type: 'stun', duration: 3 },
    ],
    description: 'Hurl your weapon at the target for $d, stunning it for 3 sec.',
  },
  intimidating_shout: {
    id: 'intimidating_shout',
    castFx: 'shout',
    name: 'Intimidating Shout',
    class: 'warrior',
    learnLevel: 14,
    // Free in every spec (owner 2026-07-08): the panic/CC horn should never be
    // gated behind rage you may not have when you need to break off.
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    // Classic-era shape (25 rage / 3 min / 5 targets / 8 yd / 8 sec) scaled to
    // the 1-20 band: cost and cooldown tuned down. The DURATION now diverges too
    // (owner 2026-08-07, 8 -> 4): classic's 8 sec left the melee class with a
    // longer fear than either caster whose identity is fear (Psychic Scream 4,
    // Howl of Terror 3), and PVP_FEAR_DR_RESET (60s) is half this cooldown, so DR
    // never engages and every cast landed the full 8. 4 anchors on Psychic Scream
    // rather than on an invented number.
    effects: [{ type: 'aoeFear', duration: 4, radius: 8, maxTargets: 5 }],
    description:
      'A terrifying shout that sends up to 5 enemies within 8 yards fleeing in fear for 4 sec. Damage may break the effect.',
  },
  bladestorm: {
    id: 'bladestorm',
    name: 'Bladestorm',
    class: 'warrior',
    learnLevel: 20,
    cost: 25,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    // A self-centered position channel: each tick pulses the aoeDamage at the
    // caster's LIVE position (no ground-aim reticle), so the storm moves with
    // you for its full duration. Owner ruling: the channel runs its FULL 4s
    // no matter what, so it ignores pushback (uninterruptible) and survives
    // the caster's own movement (you spin while running, like WoW).
    targetMode: 'position',
    selfCentered: true,
    uninterruptible: true,
    castWhileMoving: true,
    channel: { duration: 4, ticks: 4 },
    effects: [{ type: 'aoeDamage', min: 16, max: 22, radius: 6 }],
    description:
      'Become a whirling storm of steel, striking all enemies within 6 yards for $d every second for 4 sec.',
  },
  victory_rush: {
    id: 'victory_rush',
    name: "Victor's Surge",
    class: 'warrior',
    learnLevel: 8,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    // Usable only inside the on-kill window aura handleDeath opens; the cast
    // consumes it (runEffects), so one kill funds one strike.
    requiresAuraKind: 'victory_rush',
    effects: [
      { type: 'weaponStrike', bonus: 10 },
      { type: 'selfHealPctMax', pct: 0.2 },
    ],
    description:
      'Strike for weapon damage plus $d and heal 20% of your maximum health. Only usable within 20 sec of killing an enemy.',
  },
  piercing_howl: {
    id: 'piercing_howl',
    name: 'Piercing Howl',
    class: 'warrior',
    learnLevel: 11,
    cost: 10,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    // Slow shortened 15s to 8s after the owner's playtest (a near-permanent
    // AoE snare on a no-cooldown shout was too strong).
    effects: [{ type: 'aoeSlow', mult: 0.5, duration: 8, radius: 15 }],
    description: 'A piercing shout that slows all enemies within 15 yards by 50% for 8 sec.',
  },
  die_by_sword: {
    id: 'die_by_sword',
    name: 'Die by the Sword',
    class: 'warrior',
    learnLevel: 8,
    // Arms base-kit defensive cooldown (owner restructure 2026-07-08): Arms had
    // no defensive of its own. Also still reachable as a choice-row grant. No
    // shield gate: the "sword" IS the defense (Arms wields a two-hander).
    specs: ['arms'],
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'die_by_sword', value: 0.3, duration: 8 }],
    description:
      'Defensive cooldown: for 8 sec you take 30% less damage and dodge far more attacks.',
  },
  // The level-5 mobility row's peel option (replaces Double Charge, which stored a
  // second Onrush use and, under the parallel per-charge recharge model, handed PvP
  // warriors two 25-yard gap closers plus two stuns per 15 sec).
  //
  // Deliberately NOT a second Onrush: it reuses the `charge` effect but targets a
  // FRIENDLY player, so it adds mobility and a peel without adding pressure. The row
  // job is mobility with no direct damage increase (docs/design/class-design-rules.md),
  // and this carries no damage, no control, and no rage.
  //
  // No `specs` field: this ability is ONLY ever reached as a row grant, and grants
  // bypass the level and spec gates in abilitiesKnownAt, so a `specs` list here would
  // be dead weight rather than a restriction. (Contrast die_by_sword above, which
  // carries specs:['arms'] because it is ALSO Arms base kit; its row grant still
  // reaches every spec.)
  //
  // The shield is ranked rather than flat so it tracks the health curve at roughly 6-7%
  // of maximum health across the band it is usable in (252 hp at level 5, 822 at 20); a
  // flat value tuned for the cap would be three times as strong at level 5. It is well
  // under a dedicated healer shield (Psalm of Warding rank 4 absorbs 210) by design.
  //
  // Those two claims are the reason for the numbers, so they are PINNED rather than
  // left as prose: tests/warrior_intervene.test.ts asserts the share of the health
  // curve at each rank's own unlock level and the ceiling against the healer shield.
  // An absolutes-only test would have gone green on any re-tune that broke both.
  intervene: {
    id: 'intervene',
    name: 'Intervene',
    class: 'warrior',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    // 30s (owner 2026-08-07), deliberately DOUBLE the hostile Onrush's 15s: this
    // row exists to reduce the warrior mobility budget in PvP, so the replacement
    // must not hand back a short-cooldown reposition through the friendly door.
    cooldown: 30,
    range: 25,
    minRange: 8,
    school: 'physical',
    requiresTarget: true,
    targetType: 'friendly',
    offGcd: true,
    effects: [{ type: 'charge' }, { type: 'absorb', amount: 18, duration: 6 }],
    ranks: [
      {
        rank: 2,
        level: 11,
        cost: 0,
        effects: [{ type: 'charge' }, { type: 'absorb', amount: 34, duration: 6 }],
      },
      {
        rank: 3,
        level: 17,
        cost: 0,
        effects: [{ type: 'charge' }, { type: 'absorb', amount: 50, duration: 6 }],
      },
    ],
    description: 'Rush to a friendly player, shielding them from $d damage for 6 sec.',
  },
  recklessness: {
    id: 'recklessness',
    name: 'Recklessness',
    class: 'warrior',
    learnLevel: 17,
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_reckless', value: 0.2, duration: 12 }],
    description:
      'Enrage: your rage generation increases by 50% and your critical strike chance by 20% for 12 sec.',
  },
  avatar: {
    id: 'avatar',
    name: 'Avatar',
    class: 'warrior',
    learnLevel: 17,
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    // The whole point of the break is escaping fear/stun, so the cast must be
    // pressable while controlled (like Ice Block); the stun gate would
    // otherwise make breakControl unreachable exactly when it matters.
    usableWhileControlled: true,
    effects: [
      { type: 'breakControl' },
      // ONE aura for both halves (value = damage amp; the body scale is the
      // fixed AVATAR_SCALE): two selfBuffs would overwrite each other, since
      // applyAura replaces by aura id and both would be 'avatar'.
      { type: 'selfBuff', kind: 'buff_avatar', value: 0.2, duration: 20 },
    ],
    description:
      'Transform into a colossus for 20 sec, breaking enemy control effects on you (boss control is unaffected) and increasing your damage dealt by 20%.',
  },
  sanguine_aura: {
    id: 'sanguine_aura',
    castFx: 'weaponAura',
    name: 'Sanguine Aura',
    class: 'warrior',
    learnLevel: 20,
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [
      {
        type: 'partyMeleeBuff',
        attackSpeedMult: 1 / 1.1,
        dmgPct: 0.1,
        duration: 20,
      },
    ],
    description:
      'Imbue your weapon with the blood of your foes: you and your melee allies gain 10% attack speed and 10% damage for 20 sec.',
  },

  // ============== TALENT-GRANTED (Classic specs) ==============
  // Not in CLASSES.*.abilities. Unlocked only via spec grants.
  crusader_strike: {
    id: 'crusader_strike',
    name: 'Oathstrike',
    class: 'paladin',
    learnLevel: 10,
    cost: 30,
    castTime: 0,
    cooldown: 4,
    range: 0,
    school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'weaponStrike', bonus: 24 }],
    description: 'Strikes the target for weapon damage plus $d Holy damage. (Paladin talent)',
  },
  metamorphosis: {
    id: 'metamorphosis',
    name: 'Lich Form',
    class: 'warlock',
    specs: ['demonology'],
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [
      { type: 'selfBuff', kind: 'form_lich', value: 1, duration: 20 },
      { type: 'selfBuff', kind: 'buff_spelldmg', value: 0.2, duration: 20 },
      { type: 'selfBuff', kind: 'buff_spellhaste', value: 0.2, duration: 20 },
      { type: 'gainSoulFragments', amount: 3 },
      { type: 'empowerUndeadArmy', duration: 20, dmgPct: 0.5, hastePct: 0.2 },
    ],
    description:
      'Become a Lich for 20 sec, creating 3 Soul Fragments and increasing your spell damage and casting speed by 20%. Your undead deal 50% more damage and act 20% faster, and Soul Lance pierces through its target to strike up to 2 nearby enemies for 50% of its damage. (Necromancy signature)',
  },
  holy_shock: {
    id: 'holy_shock',
    name: 'Lightjolt',
    class: 'paladin',
    learnLevel: 10,
    cost: 55,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'any',
    effects: [
      { type: 'heal', min: 40, max: 50 },
      { type: 'directDamage', min: 40, max: 50 },
    ],
    ranks: [
      {
        rank: 2,
        level: 20,
        cost: 72,
        effects: [
          { type: 'heal', min: 58, max: 73 },
          { type: 'directDamage', min: 40, max: 50 },
        ],
      },
    ],
    description:
      'Shocks a friendly target with Holy energy to heal them, or an enemy for $d Holy damage. (Holy signature)',
  },
  bestial_wrath: {
    id: 'bestial_wrath',
    name: 'Howling Rage',
    class: 'hunter',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'howlingRage', duration: 12 }],
    description:
      'Grant 3 Pack Ferocity. Your next Unleash Beast within 20 sec deals 50% more strike and clap damage, and its frenzy lasts 12 sec instead of 8. (Packlord signature)',
  },
  cold_focus: {
    id: 'cold_focus',
    name: 'Cold Focus',
    class: 'hunter',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'hunter_cold_focus', value: 1, duration: 12 }],
    description:
      'For 12 sec, Measured Shot restores 50% more Focus, and Long Draw costs 25% less and casts 30% faster. (Coldsight signature)',
  },
  bloodhook: {
    id: 'bloodhook',
    name: 'Bloodhook',
    class: 'hunter',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 15,
    range: 25,
    minRange: 8,
    school: 'physical',
    requiresTarget: true,
    effects: [
      {
        type: 'hunterBloodhook',
        bleedTotal: 34,
        bleedDuration: 12,
        bleedInterval: 3,
        rangedPowerCoeff: 0.26,
      },
    ],
    description:
      'Charge to an enemy and apply Bloodhook Wound, dealing 34 base Physical damage plus 26% of your Ranged Attack Power over 12 sec in 4 ticks. (Fieldcraft signature)',
  },
  trueshot_aura: {
    id: 'trueshot_aura',
    name: 'Sureflight Aura',
    class: 'hunter',
    learnLevel: 10,
    cost: 40,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'aoeAllyAttackPower', apPct: 10, duration: 1800, radius: 30 }],
    description:
      'Increase the Attack Power of allies within 30 yards by 10% for 30 min. (Marksmanship signature)',
  },
  wyvern_sting: {
    id: 'wyvern_sting',
    name: 'Drakesting',
    class: 'hunter',
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    cooldown: 60,
    range: 30,
    minRange: 8,
    school: 'nature',
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [{ type: 'incapacitate', duration: 4 }],
    description:
      'Stings the enemy from range, incapacitating it for up to 4 sec. Any damage breaks the effect. (Survival signature)',
  },
  arcane_power: {
    id: 'arcane_power',
    name: 'Aether Surge',
    class: 'mage',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [
      { type: 'selfBuff', kind: 'buff_spelldmg', value: 0.2, duration: 10 },
      { type: 'selfBuff', kind: 'buff_spellhaste', value: 0.1, duration: 10 },
    ],
    description:
      'Increases spell damage by 20% and spell haste by 10% for 10 sec. (Arcane signature)',
  },
  combustion: {
    id: 'combustion',
    specs: ['fire'],
    name: 'Phoenix Trance',
    class: 'mage',
    learnLevel: 12,
    cost: 100,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    usableWhileCasting: true,
    // Owner playtest round four: a burst button rides no GCD.
    offGcd: true,
    // Owner decision 2026-07-11: the NEW Phoenix Trance replaces the old +50% crit
    // Flashfire. While worn every Fire spell critically strikes (the crit roll
    // outcome is overridden in combat/fire_mage.ts, the roll still drawn), and
    // those guaranteed crits BUILD Hot Streak like any other (owner reversal
    // same day: the Phoenix Trance window is meant to chain free Pyroblasts).
    effects: [{ type: 'selfBuff', kind: 'combustion', value: 0, duration: 10 }],
    description:
      'Combust: for 10 sec your Fire spells always critically strike, including bolts already in flight. Off the global cooldown. These crits build Hot Streak like any other, and casting it finishes the Cinderfall charge currently recharging. (Fire signature)',
  },
  cone_of_cold: {
    id: 'cone_of_cold',
    name: 'Frostsweep',
    class: 'mage',
    learnLevel: 10,
    cost: 60,
    castTime: 0,
    cooldown: 20,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'aoeDamage', min: 28, max: 36, radius: 8 }],
    description: 'Blasts nearby enemies with frost for $d Frost damage. (Frost signature)',
  },
  icy_veins: {
    id: 'icy_veins',
    specs: ['frost'],
    name: 'Coldsurge',
    class: 'mage',
    learnLevel: 12,
    cost: 0,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [
      { type: 'selfBuff', kind: 'buff_spellhaste', value: 0.3, duration: 10 },
      { type: 'selfBuff', kind: 'cast_shield', value: 1, duration: 10 },
    ],
    description:
      'Increases spell haste by 30% and prevents cast interruption and pushback for 10 sec. (Frost signature)',
  },
  cold_blood: {
    id: 'cold_blood',
    tooltipOmitEffectLines: true,
    name: "Killer's Calm",
    class: 'rogue',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'next_attack_crit', value: 1, duration: 60 }],
    description:
      'Focuses your killing intent so your next attack is a critical strike. (Knifework signature)',
  },
  blade_flurry: {
    id: 'blade_flurry',
    tooltipOmitEffectLines: true,
    name: 'Mirrored Blades',
    class: 'rogue',
    learnLevel: 10,
    cost: 25,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_haste', value: 1.2, duration: 12 }],
    description:
      'Unleashes a flurry of blades, increasing attack speed by 20% for 12 sec. (Thuggery signature)',
  },
  hemorrhage: {
    id: 'hemorrhage',
    name: 'Red Ribbon',
    class: 'rogue',
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    effects: [
      { type: 'weaponStrike', bonus: 16 },
      { type: 'dot', total: 36, duration: 12, interval: 3 },
      { type: 'applyDebuff', kind: 'bleed_vuln', value: 0.4, duration: 12 },
    ],
    description:
      'Strikes the enemy for weapon damage plus $d, causes bleeding damage over 12 sec, and increases bleed damage taken by 40%. Awards 1 combo point. Every 2nd use adds 1 Gloam (max 3). (Skulduggery signature)',
  },
  power_infusion: {
    id: 'power_infusion',
    name: 'Anointing',
    class: 'priest',
    learnLevel: 10,
    cost: 55,
    castTime: 0,
    cooldown: 120,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [
      { type: 'buffTarget', kind: 'buff_spellhaste', value: 0.2, duration: 15 },
      { type: 'buffTarget', kind: 'buff_dmg_done', value: 0.2, duration: 15 },
      { type: 'buffTarget', kind: 'buff_heal_done', value: 0.2, duration: 15 },
    ],
    description:
      'Anoints a friendly target, increasing damage, healing, and casting speed by 20% for 15 sec.',
  },
  holy_nova: {
    id: 'holy_nova',
    name: 'Sunburst Canticle',
    class: 'priest',
    specs: ['holy'],
    learnLevel: 10,
    cost: 70,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    effects: [
      { type: 'aoeHeal', min: 34, max: 42, radius: 10 },
      { type: 'aoeDamage', min: 24, max: 30, radius: 10 },
    ],
    ranks: [
      {
        rank: 2,
        level: 20,
        cost: 90,
        effects: [
          { type: 'aoeHeal', min: 49, max: 61, radius: 10 },
          { type: 'aoeDamage', min: 24, max: 30, radius: 10 },
        ],
      },
    ],
    description:
      'Heal allies within 10 yards for $d and deal 24 to 30 Holy damage to enemies in the same area. Both amounts increase with Spell Power. (Benison baseline)',
  },
  shadowform: {
    id: 'shadowform',
    name: 'Gloamveil',
    class: 'priest',
    specs: ['shadow'],
    learnLevel: 10,
    cost: 60,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_shadow', value: 25, duration: 3600 }],
    description:
      'Enter Gloamveil, increasing your Shadow damage by 25%. Cast it again to leave Gloamveil. (Vespers signature)',
  },
  elemental_mastery: {
    id: 'elemental_mastery',
    name: 'Primal Mastery',
    class: 'shaman',
    learnLevel: 10,
    cost: 45,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [],
    description:
      'For 12 sec, Arc Bolt grants 2 Thunder. Your next Arc Bolt or Skybranch is instant, and your next full Thunder payoff deals 25% more damage. (Thundercall signature)',
  },
  siphon_life: {
    id: 'siphon_life',
    name: 'Veinleech',
    class: 'warlock',
    learnLevel: 10,
    cost: 45,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 60, duration: 30, interval: 3, leechPct: 1 }],
    description:
      'Siphons life from the enemy, causing $d Shadow damage over 30 sec and healing you for the damage done. (Affliction signature)',
  },
  conflagrate: {
    id: 'conflagrate',
    name: 'Conflagrate',
    class: 'warlock',
    specs: ['destruction'],
    learnLevel: 10,
    cost: 40,
    castTime: 0,
    cooldown: 18,
    maxCharges: 2,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'destructionConflagrate' }, { type: 'directDamage', min: 118, max: 140 }],
    description:
      'Advances one future tick of your Burning Pact, then ignites the target for $d Fire damage. Generates 1 Wrack and 1 Desolation. Holds 2 charges. (Destruction signature)',
  },
  moonkin_form: {
    id: 'moonkin_form',
    tooltipOmitEffectLines: true,
    name: 'Moonwing Form',
    class: 'druid',
    learnLevel: 10,
    cost: 55,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_moonkin', value: 0, duration: 3600 }],
    description:
      'Shapeshift into a fearsome Moonkin, increasing your spell damage by 20% and your armor by 50%. Lasts until you shift out. Cast again to return to caster form. (Balance signature)',
  },
  feral_charge: {
    id: 'feral_charge',
    name: 'Primal Surge',
    class: 'druid',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    usableInForm: true,
    effects: [{ type: 'feralCharge' }],
    description:
      'Unleash a primal surge. In Wolf Form, Energy regeneration is increased by 100% for 10 sec. In Bruin Form, instantly generates 50 Rage. (Feral signature)',
  },
  swiftmend: {
    id: 'swiftmend',
    name: 'Fleetmend',
    class: 'druid',
    learnLevel: 10,
    cost: 55,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'consumeAura', auraKind: 'hot', heal: { min: 105, max: 125 } }],
    actionReplacement: { abilityId: 'overbloom', auraKind: 'verdance', minStacks: 5 },
    description:
      'Consumes a heal-over-time effect on a friendly target to heal them for $d. Wildbloom and Second Bloom plantings add Verdance; at 5 Verdance this button becomes Overbloom, which instantly heals every ally carrying your heal-over-time effects for 60% of what those effects had left. (Groveheart signature)',
  },
  moonlash: {
    id: 'moonlash',
    name: 'Moonsurge',
    class: 'druid',
    specs: ['balance'],
    learnLevel: 10,
    cost: 80,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    // The Moontide-3 gate lives on the Skyfall transform rules, the only
    // path to this def; the form guard blocks a stale out-of-form resolve
    // and must never eat the form itself.
    requiresAuraKind: 'form_moonkin',
    consumesRequiredAura: false,
    effects: [{ type: 'directDamage', min: 136, max: 162, spellPowerCoeff: 0.32 }],
    description:
      'Spends your 3 Moontide for a heavy strike of $d Arcane damage: the damage choice. Sunwake spends the same 3 Moontide, so pick one.',
  },
  sunlance: {
    id: 'sunlance',
    name: 'Sunwake',
    class: 'druid',
    specs: ['balance'],
    learnLevel: 10,
    cost: 45,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    // Same contract as Moonlash: the transform rules own the Moontide-3
    // gate, the def guards only the form and must never eat it.
    requiresAuraKind: 'form_moonkin',
    consumesRequiredAura: false,
    effects: [
      { type: 'directDamage', min: 80, max: 100, spellPowerCoeff: 0.32 },
      { type: 'dot', total: 45, duration: 9, interval: 3 },
      { type: 'gainResource', amount: 35 },
    ],
    description:
      'Spends your 3 Moontide for a strike of $d Nature damage plus a $o burn over 9 sec, and restores 35 mana: the mana choice. Moonsurge spends the same 3 Moontide, so pick one.',
  },
  redharvest: {
    id: 'redharvest',
    name: 'Redharvest',
    class: 'druid',
    specs: ['feral'],
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    requiresForm: 'cat',
    requiresAuraKind: 'old_blood',
    requiresAuraStacks: 3,
    spendsCombo: true,
    comboOptional: true,
    effects: [
      { type: 'finisherDamage', base: 70, perCombo: 43, variance: 10 },
      { type: 'consumeDot', dot: 'rake' },
      { type: 'consumeDot', dot: 'rip' },
      { type: 'gainResource', amount: 30 },
    ],
    description:
      'Spends your 3 Old Blood: strike for $d, instantly deal all the damage your Flense and Bloodrift would still have dealt, remove both bleeds, and restore 30 energy. Works with zero combo points.',
  },
  marrowbreak: {
    id: 'marrowbreak',
    name: 'Marrowbreak',
    class: 'druid',
    specs: ['feral'],
    learnLevel: 10,
    cost: 15,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    requiresForm: 'bear',
    requiresAuraKind: 'old_blood',
    requiresAuraStacks: 3,
    threat: { flat: 110, mult: 2 },
    effects: [
      { type: 'directDamage', min: 78, max: 96 },
      { type: 'druidMarrowbreakGuard', belowFrac: 0.5, absorbPctMaxHp: 0.18, rage: 15 },
    ],
    description:
      'Spends your 3 Old Blood for a heavy, high-threat strike of $d damage. Below half health it instead shields you for 18% of your maximum health for 8 sec and refunds 15 rage.',
  },
  overbloom: {
    id: 'overbloom',
    name: 'Overbloom',
    class: 'druid',
    specs: ['restoration'],
    learnLevel: 10,
    cost: 55,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    requiresAuraKind: 'verdance',
    requiresAuraStacks: 5,
    effects: [{ type: 'druidOverbloom', harvestPct: 0.6 }],
    description:
      'Spends your 5 Verdance: every ally carrying your heal-over-time effects is instantly healed for 60% of the healing those effects had left, the effects are removed, and the target gets a fresh Wildbloom.',
  },

  // Baseline class interrupts: every caster-pressuring class trains a short-cooldown
  // spell-kick that stops the target's cast and locks that spell school for a few sec.
  // Core kit (learned outright), not a talent choice.
  kick: {
    id: 'kick',
    name: 'Boot',
    class: 'rogue',
    learnLevel: 10,
    cost: 25,
    castTime: 0,
    cooldown: 10,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout: 4 }],
    description:
      "Interrupts the target's spellcast and prevents casting from that school for 4 sec.",
  },
  blink: {
    id: 'blink',
    name: 'Flitstep',
    class: 'mage',
    // Joins the base kit at 5 (see the 'blink' entry in the mage kit list): two
    // level-5 choice-row options modify it, so it must exist by then, not at 10.
    learnLevel: 5,
    cost: 40,
    castTime: 0,
    cooldown: 15,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [{ type: 'blinkForward', distance: 15, breakRoots: true }],
    description: 'Teleports you 15 yd forward and breaks roots. (Mage talent)',
  },
  counter_shot: {
    id: 'counter_shot',
    name: 'Hushing Shot',
    class: 'hunter',
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    cooldown: 20,
    range: 35,
    minRange: 8,
    school: 'physical',
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout: 4 }],
    description: 'Interrupt the target and prevent spells from that school for 4 sec.',
  },
  counterspell: {
    id: 'counterspell',
    name: 'Spellsever',
    class: 'mage',
    learnLevel: 5,
    cost: 45,
    castTime: 0,
    cooldown: 24,
    range: 30,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout: 6 }],
    description:
      'Counters enemy spellcasting, preventing any spell in that school from being cast for 6 sec. (Mage talent)',
  },
  deep_freeze: {
    id: 'deep_freeze',
    name: 'Deadfrost',
    class: 'mage',
    learnLevel: 5,
    cost: 60,
    castTime: 0,
    cooldown: 30,
    range: 30,
    school: 'frost',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 92, max: 116 },
      { type: 'stun', duration: 4 },
    ],
    description:
      'Deep freezes the target, dealing $d Frost damage and stunning it for 4 sec. (Mage talent)',
  },
  evocation: {
    id: 'evocation',
    name: 'Aetherwell',
    class: 'mage',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    // Owner design (playtest 2026-07-11): a CHANNEL that restores mana every
    // second AND builds stacking spell power the longer you keep channeling
    // (the buff lingers after the channel ends).
    channel: { duration: 6, ticks: 6 },
    effects: [
      { type: 'gainResource', amount: 100 },
      { type: 'selfBuff', kind: 'buff_spellpower', value: 8, duration: 15 },
    ],
    description:
      'Channel for 6 sec: each second restores 100 mana and builds 8 spell power, stacking while you channel and lasting 15 sec. (Mage talent)',
  },
  ice_block: {
    id: 'ice_block',
    name: 'Cold Coffin',
    class: 'mage',
    learnLevel: 12,
    cost: 15,
    castTime: 0,
    cooldown: 240,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    // Owner 2026-07-13: usable while stunned/polymorphed/silenced (it always frees
    // you); grants TOTAL immunity (the stasis check in dealDamage) and strips every
    // debuff on cast (cleanseSelf). Frost carries a second charge (resolvedAbility).
    usableWhileControlled: true,
    effects: [{ type: 'cleanseSelf' }, { type: 'selfBuff', kind: 'stasis', value: 0, duration: 8 }],
    description:
      'Encases you in solid ice for 8 sec, becoming immune to all damage and effects and removing every harmful effect. Usable while stunned or polymorphed. You cannot act while encased. Recast to cancel. (Mage)',
  },
  mend_pet: {
    id: 'mend_pet',
    name: 'Patch Up',
    class: 'hunter',
    learnLevel: 10,
    cost: 45,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'hot', total: 135, duration: 15, interval: 3 }],
    description: 'Heals a friendly target for $d over 15 sec. (Hunter talent)',
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor',
    class: 'mage',
    learnLevel: 16,
    specs: ['fire'],
    cost: 120,
    castTime: 0,
    cooldown: 45,
    range: 30,
    school: 'fire',
    requiresTarget: false,
    targetMode: 'position',
    // Owner design: aimed at the ground with a FALL DELAY, then one impact
    // that Ignites everything it strikes (a single delayed groundAoE pulse at
    // interval; igniteFrac copies each target's resolved damage into its burn).
    effects: [
      {
        type: 'groundAoE',
        min: 90,
        max: 120,
        radius: 8,
        duration: 2.5,
        interval: 2,
        igniteFrac: 0.4,
        delayed: true,
      },
    ],
    description:
      'Calls a meteor down on the target area: after a 2 sec fall it deals 90 to 120 Fire damage and Ignites everything it strikes. (Fire)',
  },
  presence_of_mind: {
    id: 'presence_of_mind',
    name: 'Racing Mind',
    class: 'mage',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 60,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    offGcd: true, // owner 2026-07-13: fire it without spending the global cooldown
    effects: [{ type: 'selfBuff', kind: 'next_cast_instant', value: 1, duration: 60 }],
    description: 'Makes your next spell with a cast time instant. Lasts 60 sec. (Mage talent)',
  },
  // --- Mage choice-row actives (owner tree, Artifact calculator 2026-07-11).
  // WoW development names, renamed with the final localization pass like the
  // frost spec kit. Numbers are the calculator's provisional values.
  ice_floes: {
    id: 'ice_floes',
    name: 'Ice Floes',
    class: 'mage',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 25,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    offGcd: true,
    // value = protected casts left; player_motion skips its cast-cancel while
    // worn and finishing a hard cast decrements it (casting_lifecycle).
    effects: [{ type: 'selfBuff', kind: 'ice_floes', value: 2, duration: 15 }],
    description:
      'Your next two spells with a cast time can be cast while moving. Lasts 15 sec. (Mage talent)',
  },
  greater_invisibility: {
    id: 'greater_invisibility',
    name: 'Greater Invisibility',
    class: 'mage',
    learnLevel: 8,
    cost: 60,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    // One dispatch strips up to two DoTs and applies the vanish. Its configured
    // damage cut starts only once that vanish ends (effect_dispatch).
    effects: [
      {
        type: 'greaterInvisibility',
        duration: 20,
        drValue: 0.9,
        afterDuration: 2,
        removeDotCount: 2,
      },
    ],
    description:
      'Vanish for 20 sec and remove 2 damage-over-time effects. When the invisibility ends, take 90% less damage for 2 sec. (Mage talent)',
  },
  rings_of_frost: {
    id: 'rings_of_frost',
    name: 'Ring of Frost',
    class: 'mage',
    learnLevel: 11,
    cost: 60,
    castTime: 1.5,
    cooldown: 30,
    range: 25,
    school: 'frost',
    requiresTarget: false,
    // Aimed at the ground; the cast time is the arming delay. The center stays
    // safe, while enemies touching the persistent perimeter trigger it once.
    targetMode: 'position',
    effects: [
      {
        type: 'aoeRoot',
        duration: 4,
        radius: 6,
        min: 0,
        max: 0,
        ring: { duration: 10, innerRadius: 4.5 },
      },
    ],
    description:
      'Summons a ring for 10 sec. Enemies crossing its perimeter are frozen for 4 sec. (Mage talent)',
  },
  cold_snap: {
    id: 'cold_snap',
    name: "Winter's Recall",
    class: 'mage',
    learnLevel: 17,
    cost: 0,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    offGcd: true,
    effects: [
      {
        type: 'clearCooldowns',
        abilities: [
          'blink',
          'ice_barrier',
          'blazing_barrier',
          'temporal_barrier',
          'greater_invisibility',
        ],
      },
    ],
    description:
      'Finishes the cooldown on Flitstep, Frostveil, and Greater Invisibility. (Mage talent)',
  },
  mass_barrier: {
    id: 'mass_barrier',
    name: 'Mass Barrier',
    class: 'mage',
    learnLevel: 17,
    cost: 150,
    castTime: 0,
    cooldown: 90,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [
      {
        type: 'aoeAllyAbsorb',
        amount: 130,
        duration: 60,
        radius: 30,
        maxTargets: 5,
      },
    ],
    description:
      'Shields you and up to 4 nearby allies within 30 yd, each absorbing 130 damage for 60 sec. (Mage talent)',
  },
  overload: {
    id: 'overload',
    name: 'Overload',
    class: 'mage',
    learnLevel: 14,
    cost: 0,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'overload', value: 0.4, duration: 10 }],
    description:
      'Your next spell is amplified by 40% but costs 50% more mana. Lasts 10 sec. (Mage talent)',
  },
  power_echo: {
    id: 'power_echo',
    name: 'Power Echo',
    class: 'mage',
    learnLevel: 14,
    cost: 0,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'power_echo', value: 0.5, duration: 10 }],
    description:
      'Your next direct spell repeats at 50% power on the same target. Lasts 10 sec. (Mage talent)',
  },
  rune_of_power: {
    id: 'rune_of_power',
    name: 'Rune of Power',
    class: 'mage',
    learnLevel: 20,
    cost: 100,
    // Owner rule 2026-07-11: inscribing the rune is a deliberate cast too.
    castTime: 1.5,
    cooldown: 45,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    // A FRIENDLY ground zone at the caster's feet: each pulse buffs allies
    // standing inside (the groundAoE allyBuffPct rider; no damage, no rng).
    effects: [
      {
        type: 'groundAoE',
        min: 0,
        max: 0,
        radius: 8,
        duration: 15,
        interval: 2,
        allyBuffPct: 0.1,
      },
    ],
    description:
      'Inscribe a rune of power at your feet for 15 sec: allies standing within 8 yd deal 10% more damage. (Mage talent)',
  },
  blazing_barrier: {
    id: 'blazing_barrier',
    name: 'Blazing Barrier',
    class: 'mage',
    learnLevel: 5,
    specs: ['fire'],
    cost: 45,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    // The fire spec's PERSONAL BARRIER slot (Frost carries Frostveil): the
    // shared row talents hook either id via PERSONAL_BARRIER_IDS.
    effects: [
      {
        type: 'absorb',
        amount: 50,
        duration: 60,
        spellPowerCoeff: MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF,
      },
    ],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 65,
        effects: [
          {
            type: 'absorb',
            amount: 90,
            duration: 60,
            spellPowerCoeff: MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF,
          },
        ],
      },
      {
        rank: 3,
        level: 18,
        cost: 90,
        effects: [
          {
            type: 'absorb',
            amount: 130,
            duration: 60,
            spellPowerCoeff: MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF,
          },
        ],
      },
    ],
    description: 'Wreathe yourself in flame, absorbing $d damage for 60 sec. (Fire)',
  },
  ignition: {
    id: 'ignition',
    name: 'Ignition',
    class: 'mage',
    learnLevel: 5,
    specs: ['fire'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: your spell critical strikes burn the target for 40% of the damage dealt over 6 sec, stacking. (Fire mastery)',
  },
  hot_streak: {
    id: 'hot_streak',
    name: 'Hot Streak',
    class: 'mage',
    learnLevel: 5,
    specs: ['fire'],
    passive: true,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    effects: [],
    description:
      'Passive: two critical strikes in a row with your Fire spells (Cinderbolt, Cinderfall, Scald, Pyrelance or Flamestrike) make your next Pyrelance or Flamestrike instant and free. The spenders count toward the NEXT streak, free casts included; a Flamestrike counts once however many enemies it strikes, and only the initial impact ever counts. (Fire)',
  },
  summon_water_elemental: {
    id: 'summon_water_elemental',
    name: 'Summon Water Elemental',
    class: 'mage',
    learnLevel: 12,
    specs: ['frost'],
    cost: 150,
    castTime: 2,
    cooldown: 0,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'water_elemental' }],
    description:
      'Summon a Water Elemental to fight beside you, hurling Waterbolts at your target and channeling Water Jet. (Frost)',
  },
  rebuke: {
    id: 'rebuke',
    name: 'Reproach',
    class: 'paladin',
    learnLevel: 10,
    cost: 20,
    castTime: 0,
    cooldown: 12,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout: 4 }],
    description:
      'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Paladin talent)',
  },
  skull_bash: {
    id: 'skull_bash',
    name: 'Headbutt',
    class: 'druid',
    learnLevel: 10,
    cost: 10,
    castTime: 0,
    cooldown: 15,
    range: 8,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout: 4 }],
    description:
      'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Druid talent)',
  },
  spell_lock: {
    id: 'spell_lock',
    name: 'Abyssal Gag',
    class: 'warlock',
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    cooldown: 24,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout: 4 }],
    description:
      'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Warlock talent)',
  },

  // Canonical Talents V2 active grants. These are absent from baseline class kits
  // and become known only through the selected row's `grant` effect.
  ...TALENT_ABILITIES_V2,
  ...PRIEST_ABILITIES,

  // The Vale Cup sport kit (class-agnostic; docs/prd/vale-cup.md). Merged here
  // so every ABILITIES consumer (casting, icons, hotbar validation, tooltips)
  // resolves sport ids; no class lists them, so abilitiesKnownAt never grants
  // them outside a match (resolveSportKit is the only entry).
  ...SPORT_ABILITIES,
};

const PALADIN_LEGACY_ABILITY_IDS = [
  'seal_of_righteousness',
  'devotion_aura',
  'blessing_of_might',
  'holy_taunt',
  'flash_of_light',
  'exorcism',
  'rebuke',
  'sacred_bulwark',
  'holy_shock',
  'crusader_strike',
] as const;

for (const abilityId of PALADIN_LEGACY_ABILITY_IDS) {
  ABILITIES[abilityId].hiddenFromPlayer = true;
}

// A class ability resolved to a concrete rank, with talent modifiers already
// folded into its cost / cast / cooldown / effects. The combat path reads only
// these flat numbers - it never consults the talent tree. Structurally matches
// sim's ResolvedAbility.
export interface KnownAbility {
  def: AbilityDef;
  rank: number;
  cost: number;
  castTime: number;
  cooldown: number;
  effects: AbilityEffect[];
  threatFlat: number;
  threatMult: number;
  castWhileMoving?: boolean; // talent-granted mobility (def.castWhileMoving covers baseline)
  damagePushbackImmune?: boolean;
  ignoreStealthRequirement?: boolean; // Cheap Trick: the resolved ability drops requiresStealth
  charges?: number; // resolved total uses; undefined means one use
  bonusCharges?: number; // +N stored uses resolved from def/talents; drives the abilityCharges recharge model
}

// Scale one effect's damage/heal magnitudes, returning a NEW effect object - the
// base content arrays are shared module data and must never be mutated. `flat`
// is added once to the effect's primary magnitude.
// Buff-value kinds whose magnitude is an INTEGER count (attack power, armor,
// stats, spellpower, thorns). buffPct scaling rounds these; every other buff kind
// carries a fractional RATE (haste/dodge/spell-haste multipliers) that must scale
// without rounding, or a sub-1.0 bonus floors to zero.
const INTEGRAL_BUFF_KINDS: ReadonlySet<AuraKind> = new Set([
  'buff_ap',
  'buff_armor',
  'buff_int',
  'buff_agi',
  'buff_sta',
  'buff_allstats',
  'buff_spellpower',
  'thorns',
]);

function scaleBuffValue(kind: AuraKind, value: number, mul: number): number {
  const scaled = value * mul;
  return INTEGRAL_BUFF_KINDS.has(kind) ? Math.round(scaled) : scaled;
}

// The buff kinds whose value is a flat MAGNITUDE and so scales with an
// ability/global damage-power mod in scaleEffect. Every other selfBuff/buffTarget
// kind passes through untouched (see the selfBuff/buffTarget arm below).
const SCALABLE_BUFF_KINDS: ReadonlySet<AuraKind> = new Set([
  'buff_ap',
  'buff_armor',
  'buff_int',
  'buff_agi',
  'buff_spi',
  'buff_sta',
  'buff_allstats',
  'buff_spellpower',
  'thorns',
]);

function scaleEffect(
  eff: AbilityEffect,
  dmgMult: number,
  healMult: number,
  dotMult: number,
  hotMult: number,
  absorbMult: number,
  flat: number,
): AbilityEffect {
  switch (eff.type) {
    case 'weaponDamage':
      return { ...eff, bonus: Math.round(eff.bonus * dmgMult + flat) };
    case 'weaponStrike':
      return {
        ...eff,
        bonus: Math.round(eff.bonus * dmgMult + flat),
        weaponMult: (eff.weaponMult ?? 1) * dmgMult,
      };
    case 'directDamage':
      return {
        ...eff,
        min: Math.round(eff.min * dmgMult + flat),
        max: Math.round(eff.max * dmgMult + flat),
      };
    case 'dot': {
      // A directPct rider snapshots an already-scaled direct hit; scaling the
      // fraction again would double-apply the talent/global damage modifier.
      if (eff.directPct) return { ...eff };
      const scaled = { ...eff, total: Math.round(eff.total * dmgMult * dotMult + flat) };
      // A combo-scaled finisher bleed (Bloodrift) derives its tick value from
      // baseTotal + perComboTotal x points, IGNORING `total`, so scaling `total`
      // alone would leave the whole payload inert against damage modifiers.
      // (baseDuration/perComboDuration are seconds, not damage: Bleed Out buys
      // more ticks at the same scaled value, so they are deliberately untouched.)
      if (eff.perComboTotal !== undefined) {
        scaled.baseTotal = Math.round((eff.baseTotal ?? 0) * dmgMult * dotMult + flat);
        scaled.perComboTotal = Math.round(eff.perComboTotal * dmgMult * dotMult);
      }
      return scaled;
    }
    case 'aoeDamage':
    case 'aoeHeal':
      return {
        ...eff,
        min: Math.round(eff.min * (eff.type === 'aoeHeal' ? healMult : dmgMult) + flat),
        max: Math.round(eff.max * (eff.type === 'aoeHeal' ? healMult : dmgMult) + flat),
      };
    case 'chainDamage':
      return {
        ...eff,
        min: Math.round(eff.min * dmgMult + flat),
        max: Math.round(eff.max * dmgMult + flat),
      };
    case 'aoeRoot':
      return {
        ...eff,
        min: Math.round(eff.min * dmgMult),
        max: Math.round(eff.max * dmgMult),
      };
    case 'drainTick':
      return {
        ...eff,
        min: Math.round(eff.min * dmgMult),
        max: Math.round(eff.max * dmgMult),
      };
    case 'afflictionSentence':
      return {
        ...eff,
        damageMult: (eff.damageMult ?? 1) * dmgMult,
        flat: (eff.flat ?? 0) + flat,
      };
    case 'afflictionViolence':
      return { ...eff, damage: Math.round(eff.damage * dmgMult + flat) };
    case 'afflictionLitany':
      return { ...eff, damage: Math.round(eff.damage * dmgMult + flat) };
    case 'finisherDamage':
      return {
        ...eff,
        base: Math.round(eff.base * dmgMult + flat),
        perCombo: Math.round(eff.perCombo * dmgMult),
      };
    case 'imbue':
      return {
        ...eff,
        bonus: Math.round(eff.bonus * dmgMult + flat),
      };
    case 'heal':
      if (eff.casterMaxHpPct !== undefined) return eff;
      return {
        ...eff,
        min: Math.round(eff.min * healMult + flat),
        max: Math.round(eff.max * healMult + flat),
      };
    case 'chainHeal':
      return {
        ...eff,
        min: Math.round(eff.min * healMult + flat),
        max: Math.round(eff.max * healMult + flat),
      };
    case 'paladinAegis':
      return {
        ...eff,
        tickMin: Math.round(eff.tickMin * healMult + flat),
        tickMax: Math.round(eff.tickMax * healMult + flat),
        finalMin: Math.round(eff.finalMin * healMult),
        finalMax: Math.round(eff.finalMax * healMult),
      };
    case 'massTemporalEcho':
      // Like heal/chainHeal, the initial-heal base is talent scaled here so it
      // matches the SP rider talentHealMult now applies at the effect_dispatch.ts
      // call site (Chronoweave's "all healing" bonus was previously a no-op here).
      return {
        ...eff,
        heal: {
          min: Math.round(eff.heal.min * healMult + flat),
          max: Math.round(eff.heal.max * healMult + flat),
        },
      };
    case 'hot':
      return {
        ...eff,
        total: Math.round(eff.total * healMult * hotMult + flat),
      };
    case 'consumeAura':
      // `flat` is added once, to the PRIMARY magnitude only: deal when present,
      // else heal (a dual deal+heal def must not double-apply a flat talent mod).
      return {
        ...eff,
        deal: eff.deal
          ? {
              min: Math.round(eff.deal.min * dmgMult + flat),
              max: Math.round(eff.deal.max * dmgMult + flat),
            }
          : undefined,
        heal: eff.heal
          ? {
              min: Math.round(eff.heal.min * healMult + (eff.deal ? 0 : flat)),
              max: Math.round(eff.heal.max * healMult + (eff.deal ? 0 : flat)),
            }
          : undefined,
      };
    case 'absorb':
      return {
        ...eff,
        amount: Math.round(eff.amount * healMult * absorbMult + flat),
        casterMaxHpPct:
          eff.casterMaxHpPct === undefined
            ? undefined
            : Math.round(eff.casterMaxHpPct * healMult * absorbMult * 10_000) / 10_000,
      };
    // Only the buff kinds whose value is a flat MAGNITUDE (armor, attack power, a flat
    // primary stat, spell power, thorns damage) scale with a damage-power mod. Every
    // other selfBuff/buffTarget kind is a rate, multiplier, percent, or a locked
    // caster-form value and passes through untouched: scaling a 1.2 haste or 1.4 speed
    // multiplier and rounding corrupts it (1.2 -> 1 = zero haste, 1.4 -> 1 = no speed),
    // and a sub-1 rate (a 0.2 crit fraction) floors to 0 (this silently zeroed Aether
    // Surge's haste for an Arcane mage). Gate on the KIND, never a value heuristic.
    // Intentional buff scaling still rides the per-ability buffPct in applyTalentMods.
    case 'buffTarget':
    case 'selfBuff':
      return SCALABLE_BUFF_KINDS.has(eff.kind)
        ? { ...eff, value: Math.round(eff.value * dmgMult + flat) }
        : eff;
    case 'lifeTap':
      return { ...eff, mana: Math.round(eff.mana * dmgMult + flat) };
    case 'gainResource':
      // Resource generation is economy, not damage. Damage modifiers must not
      // alter an authored Focus, Rage, or Energy gain.
      return eff;
    case 'hunterBloodhook':
    case 'hunterShrapnel':
      return { ...eff, damageMult: (eff.damageMult ?? 1) * dmgMult };
    case 'groundAoE':
      // Rune of Power's pulse is an ally damage-done buff, not a damage roll
      // (its authored min/max are 0/0): leave it untouched so a flat talent
      // mod can never turn a buff zone into a damage zone.
      return eff.allyBuffPct
        ? eff
        : {
            ...eff,
            min: Math.round(eff.min * dmgMult + flat),
            max: Math.round(eff.max * dmgMult + flat),
          };
    case 'repositionToAim':
      // Vaulting Charge's landing hit is a groundAoE-shaped rider on the
      // reposition; scale it the same way a groundAoE pulse scales.
      return eff.landingAoe
        ? {
            ...eff,
            landingAoe: {
              ...eff.landingAoe,
              min: Math.round(eff.landingAoe.min * dmgMult + flat),
              max: Math.round(eff.landingAoe.max * dmgMult + flat),
            },
          }
        : eff;
    default:
      return eff;
  }
}

// Fold precomputed talent modifiers into one resolved ability (FR-5.3). Global
// melee/spell/heal mults apply to every ability of the right school; per-ability
// mods stack on top and also tune cost / cast time / cooldown.
export function applyTalentMods(entry: KnownAbility, mods: TalentModifiers): void {
  const am = mods.abilities[entry.def.id];
  // dmgMult/healMult come from the shared talent_hit_mult resolver: the SAME
  // function combat sites (effect_dispatch.ts/casting_lifecycle.ts/auto_attack.ts)
  // call to scale a resolved ability's runtime SP/AP/weapon rider, so the
  // authored-base bake here and the rider scaling at combat time can never drift
  // apart. (The melee bucket also covers hunter's ranged-AP shots regardless of
  // magic school: `scalesWith: 'ranged'` is exclusively set on hunter abilities
  // (arcane_shot, serpent_sting, wyvern_sting are non-physical), so Marksmanship's
  // Iron Aim ("ranged ability damage") reaches Arcane Shot, the spec's arcane nuke.)
  const { dmgMult, healMult } = resolveTalentHitMult(entry.def, mods);
  const dotMult = 1 + mods.global.dotDmgPct;
  const hotMult = 1 + mods.global.hotHealPct;
  const absorbMult = 1 + mods.global.absorbPct;
  const flat = am?.flatDmg ?? 0;
  if (am?.addEffects.length) {
    // Append copies before the scaling pass so added effects inherit the same
    // global and per-ability damage/heal modifiers as native effects.
    entry.effects = [...entry.effects, ...am.addEffects.map((e) => ({ ...e }))];
  }
  if (
    dmgMult !== 1 ||
    healMult !== 1 ||
    dotMult !== 1 ||
    hotMult !== 1 ||
    absorbMult !== 1 ||
    flat !== 0
  ) {
    entry.effects = entry.effects.map((e) =>
      scaleEffect(e, dmgMult, healMult, dotMult, hotMult, absorbMult, flat),
    );
  }
  if (am) {
    if (am.costPct) entry.cost = Math.max(0, Math.round(entry.cost * (1 + am.costPct)));
    if (am.castPct) entry.castTime = Math.max(0, entry.castTime * (1 + am.castPct));
    if (am.cooldownPct) entry.cooldown = Math.max(0, entry.cooldown * (1 + am.cooldownPct));
    // Flat cooldown ADD (seconds), after the percent: Snap Bewitch turns a
    // cooldown-less cast instant by trading in a real cooldown.
    if (am.cooldownFlat) entry.cooldown = Math.max(0, entry.cooldown + am.cooldownFlat);
    if (am.durationFlat) {
      entry.effects = entry.effects.map((effect) => {
        if (
          effect.type === 'selfBuff' ||
          effect.type === 'buffTarget' ||
          effect.type === 'absorb' ||
          effect.type === 'hot'
        ) {
          return { ...effect, duration: Math.max(0, effect.duration + (am.durationFlat ?? 0)) };
        }
        return effect;
      });
    }
    if (am.castWhileMoving) entry.castWhileMoving = true;
    if (am.damagePushbackImmune) entry.damagePushbackImmune = true;
    if (am.ignoreStealthRequirement) entry.ignoreStealthRequirement = true;
    // Stored uses (Double Charge): base 1 unless the def itself is
    // charge-limited (maxCharges, already resolved onto entry.charges); the
    // combat gate + recharge live in casting_lifecycle / updateTimers, keyed
    // off this resolved max.
    if (am.bonusCharges) {
      entry.bonusCharges = (entry.bonusCharges ?? 0) + am.bonusCharges;
      entry.charges = (entry.charges ?? 1) + am.bonusCharges;
    }
    // buffPct strengthens the value of a (self/target) buff, e.g. Improved Devotion Aura
    // giving more armor. Only the buff effects scale; damage on the same ability does not.
    // Multiplier-shaped values (buff_haste/scale/jump/mortal_wound) are exempt like in
    // scaleEffect.
    if (am.buffPct) {
      const mul = 1 + am.buffPct;
      entry.effects = entry.effects.map((e) =>
        e.type === 'selfBuff' || e.type === 'buffTarget'
          ? { ...e, value: scaleBuffValue(e.kind, e.value, mul) }
          : e.type === 'finisherHaste'
            ? { ...e, mult: 1 + (e.mult - 1) * mul }
            : // Weapon coats scale their per-swing rider (Redhanded's poison
              // damage; a re-coat picks up the new value).
              e.type === 'imbue'
              ? { ...e, bonus: Math.round(e.bonus * mul) }
              : e,
      );
    }
  }
}

// Abilities a class knows at a given level, with rank values resolved and any
// talent modifiers (granted abilities + per-ability/global tweaks) applied.
export function abilitiesKnownAt(
  cls: PlayerClass,
  level: number,
  mods?: TalentModifiers,
  questsDone?: ReadonlySet<string>,
): KnownAbility[] {
  const out: KnownAbility[] = [];
  const baseIds = CLASSES[cls].abilities;
  const ids = [...baseIds];
  const grantIds = new Set<string>();
  for (const g of mods?.grants ?? []) grantIds.add(g.ability);
  for (const g of mods?.grants ?? []) if (!ids.includes(g.ability)) ids.push(g.ability);

  for (const id of ids) {
    const def = ABILITIES[id];
    if (!def) continue;
    // Retired ids stay in ABILITIES so persisted action bars can identify and
    // discard them, but they are not authoritative actions. Keeping them in
    // `known` would let modified clients and RL slots cast abilities the
    // official spellbook deliberately hides.
    if (def.hiddenFromPlayer) continue;
    const granted = grantIds.has(id) || !baseIds.includes(id);
    // Paladin specialization signatures also live in its authored class kit.
    // Keep their requested progression levels authoritative instead of letting
    // the generic signature grant reveal Mercy Lance, Final Edict, or Sunward
    // Disc early. Row-granted actives remain grants and still bypass level gates.
    const paladinBaseKitGrant = cls === 'paladin' && baseIds.includes(id);
    if ((!granted || paladinBaseKitGrant) && def.learnLevel > level) continue;
    // Quest-gated kit: a quest-locked ability stays hidden until its unlocking
    // quest is in questsDone (paladin's recall_the_fallen <- q_rite_of_redemption).
    // Grants bypass entirely (already scoped). Learned permanently: questsDone is
    // durable, so a returning character keeps it through the load-time rebuild.
    if (!granted && def.requiresQuest && !questsDone?.has(def.requiresQuest)) continue;
    // Spec-gated kit: a spec-restricted ability is shown ONLY when the player's
    // committed spec is in its `specs` list. With no spec chosen the shared base
    // kit stays but every spec-exclusive drops out, so exclusivity is visible
    // before committing. Grants bypass entirely (already spec-scoped).
    if (!granted && def.specs && (!mods?.spec || !def.specs.includes(mods.spec))) continue;
    // Spec EXCLUSION: an otherwise-ungated ability drops out for a committed spec
    // in its `excludeSpecs` list (Reaver Strike hides for Protection, which uses
    // Revenge instead). A no-spec player and non-listed specs keep it; grants
    // bypass entirely (already spec-scoped). With excludeSpecsAtLevel set the
    // drop waits for that player level (a kit hand-off, e.g. Redhand serves
    // Fury until Red Harvest arrives at 10).
    if (
      !granted &&
      def.excludeSpecs &&
      mods?.spec &&
      def.excludeSpecs.includes(mods.spec) &&
      level >= (def.excludeSpecsAtLevel ?? 0)
    )
      continue;

    let rank = 1,
      cost = def.cost,
      castTime = def.castTime,
      effects = def.effects;
    let threatFlat = def.threat?.flat ?? 0;
    const threatMult = def.threat?.mult ?? 1;
    for (const r of def.ranks ?? []) {
      if (r.level <= level) {
        rank = r.rank;
        cost = r.cost;
        effects = r.effects;
        if (r.castTime !== undefined) castTime = r.castTime;
        if (r.threatFlat !== undefined) threatFlat = r.threatFlat;
      }
    }
    let cooldown = def.cooldown;
    if (id === 'execute' && mods?.spec === 'arms') {
      cost = 10;
    }
    // Fury's execute is a rage BUILDER, not a spender (owner 2026-07-08):
    // for a committed Fury warrior it costs nothing and MINTS 20 rage instead of
    // the shared finisher cost. Arms, Protection and no-spec keep the classic
    // rage-costing execute. Resolved here (not via a talent mod) so the
    // cast-time cost gate sees 0 and the appended gainResource flows through the
    // normal dispatch scaling (abilityRagePct / rage-gen auras).
    if (id === 'execute' && mods?.spec === 'fury') {
      cost = 0;
      effects = [...effects, { type: 'gainResource', amount: 20 }];
      cooldown = 6;
    }
    if (id === 'drain_life' && mods?.spec === 'affliction') {
      effects = effects.map((effect) =>
        effect.type === 'drainTick' ? { ...effect, healFrac: 1 } : effect,
      );
    }
    const entry: KnownAbility = {
      def,
      rank,
      cost,
      castTime,
      cooldown,
      effects,
      threatFlat,
      threatMult,
      bonusCharges: 0,
    };
    // Charge-limited base kit (Twinstrike): the def's stored-use max resolves
    // exactly like the Double Charge talent's, so casting_lifecycle's charge
    // gate + updateTimers' recharge refund need no new path. Talent
    // bonusCharges (applyTalentMods) stacks on top of this base.
    if (def.maxCharges !== undefined) {
      entry.charges = def.maxCharges;
      entry.bonusCharges = Math.max(0, def.maxCharges - 1);
    }
    // Frost mages carry a SECOND Ice Block charge (owner 2026-07-13: "doble cubo"),
    // on the abilityCharges recharge model. Resolved HERE (the shared known-list
    // builder) so BOTH worlds see it: the offline Sim's meta.known and the
    // ClientWorld's locally recomputed list, which is what the action bar badges.
    if (id === 'ice_block' && mods?.spec === 'frost') entry.bonusCharges = 1;
    if (mods) applyTalentMods(entry, mods);
    out.push(entry);
  }
  return out;
}
