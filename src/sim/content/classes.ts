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
  resourceType: 'rage' | 'mana' | 'energy';
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
    color: 0xc79c6e,
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
    ranged: { min: 3, max: 6, speed: 1.8, maxRange: 30, minRange: 0, wand: true, school: 'arcane' },
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
    color: 0x69ccf0,
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
    ],
    color: 0xfff569,
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
    startChest: 'recruit_tunic',
    startItems: START_RATIONS_MANA,
    abilities: [
      'seal_of_righteousness',
      'holy_light',
      'devotion_aura',
      'judgement',
      'blessing_of_might',
      'divine_protection',
      'hammer_of_justice',
      'lay_on_hands',
      'holy_taunt',
      'flash_of_light',
      'exorcism',
      'consecration',
      'righteous_fury',
      'retribution_aura',
      'rebuke',
      'sacred_bulwark',
    ],
    color: 0xf58cba,
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    baseStats: { str: 14, agi: 25, sta: 19, int: 13, spi: 14, armor: 45 },
    statsPerLevel: { str: 1, agi: 3, sta: 2, int: 1, spi: 1, armor: 8 },
    baseHp: 50,
    hpPerLevel: 15,
    baseMana: 80,
    manaPerLevel: 18,
    resourceType: 'mana',
    startWeapon: 'rusty_hatchet',
    startChest: 'footpad_jerkin',
    startItems: START_RATIONS_MANA,
    ranged: { min: 5, max: 9, speed: 2.3, maxRange: 35, minRange: 8 },
    abilities: [
      'raptor_strike',
      'aspect_of_the_hawk',
      'serpent_sting',
      'arcane_shot',
      'concussive_shot',
      'mongoose_bite',
      'wing_clip',
      'tame_beast',
      'dismiss_pet',
      'revive_pet',
      'aspect_of_the_monkey',
      'aspect_of_the_cheetah',
      'aimed_shot',
      'rapid_fire',
      'volley',
      'counter_shot',
    ],
    color: 0xabd473,
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
    ranged: { min: 3, max: 6, speed: 1.8, maxRange: 30, minRange: 0, wand: true, school: 'holy' },
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
    ],
    color: 0xfffff0,
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
      'rockbiter_weapon',
      'healing_wave',
      'earth_shock',
      'lightning_shield',
      'flame_shock',
      'flametongue_weapon',
      'frost_shock',
      'frostbrand_weapon',
      'ghost_wolf',
      'earthquake',
    ],
    color: 0x0070de,
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
    ranged: { min: 3, max: 6, speed: 1.8, maxRange: 30, minRange: 0, wand: true, school: 'shadow' },
    abilities: [
      'shadow_bolt',
      'summon_imp',
      'demon_skin',
      'immolate',
      'corruption',
      'life_tap',
      'summon_voidwalker',
      'curse_of_agony',
      'drain_life',
      'fear',
      'searing_pain',
      'shadowburn',
      'summon_succubus',
      'summon_felhunter',
      'summon_felguard',
      'summon_infernal',
      'summon_doomguard',
      'rain_of_fire',
      'spell_lock',
    ],
    color: 0x9482c9,
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
    ranged: { min: 3, max: 6, speed: 1.8, maxRange: 30, minRange: 0, wand: true, school: 'nature' },
    abilities: [
      'wrath',
      'healing_touch',
      'mark_of_the_wild',
      'moonfire',
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
    color: 0xff7d0a,
  },
};

// ---------------------------------------------------------------------------
// Abilities — classic-era rank values and learn levels (levels 1-10)
// ---------------------------------------------------------------------------

const MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF = 0.5;
const MAGE_TEMPORAL_BARRIER_SPELL_POWER_COEFF = 0.25;

export const ABILITIES: Record<string, AbilityDef> = {
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
    effects: [{ type: 'buffTarget', kind: 'buff_ap_pct', value: 10, duration: 1800, party: true }],
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
          { type: 'selfBuff', kind: 'overpower_charge', value: 0.2, duration: 15 },
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
    effects: [{ type: 'aoeDamage', min: 15, max: 20, radius: 8, frontal: true, stunSec: 3 }],
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
    effects: [{ type: 'aoeDamage', min: 18, max: 24, radius: 8, frontal: true, softCap: 5 }],
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
    effects: [{ type: 'selfBuff', kind: 'defensive_stance', value: 0.9, duration: 3600 }],
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
    effects: [{ type: 'buffTarget', kind: 'buff_int_pct', value: 5, duration: 1800, party: true }],
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
  // Frozen Orb: the roaming Icicle generator (combat/frozen_orb.ts). Instant,
  // 45s cooldown; the orb drifts forward pulsing frost damage + a 30% snare
  // once per second for 8s. Each striking pulse banks one Icicle. Blizzard
  // shortens its cooldown (below).
  frozen_orb: {
    id: 'frozen_orb',
    name: 'Frozen Orb',
    class: 'mage',
    learnLevel: 15,
    specs: ['frost'],
    cost: 50,
    castTime: 0,
    cooldown: 45,
    range: 0,
    school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'frozenOrb', min: 8, max: 11, radius: 6, duration: 8, interval: 1 }],
    ranks: [
      {
        rank: 2,
        level: 18,
        cost: 70,
        effects: [{ type: 'frozenOrb', min: 14, max: 18, radius: 6, duration: 8, interval: 1 }],
      },
    ],
    description:
      'Release an orb of swirling frost that drifts forward for 8 sec, dealing $d Frost damage each second to nearby enemies and slowing them by 30%. Each striking pulse generates one Icicle. (Frost)',
  },
  // Glacial Spike: the frost spec's slow, heavy spender. Gated on a FULL Icicles
  // stack (requiresAuraStacks 5), which the cast consumes; it lands a big frost
  // hit and freezes the target with a short root, so the follow-up Ice Lance and
  // spells Brittle Ruin even where the target was not already frozen. The Icicles
  // build-up lives in combat/frost_mage.ts (fed by Rimelance impacts + Frozen Orb
  // pulses); the freeze reuses the shared root effect so isRooted counts it.
  glacial_spike: {
    id: 'glacial_spike',
    name: 'Glacial Spike',
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
  // pulse) and the Frozen Orb refund (frostMageChannelPulse, 0.5s per enemy
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
    // snare + Frozen Orb refund riders; delayed skips the on-cast pulse so
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
      'Conjures an ice storm at the target area: after a 2 sec cast it rages for 6 sec, dealing 12 to 16 Frost damage each second and slowing enemies by 40%. Each enemy struck shaves 0.5 sec off Frozen Orb, up to 3 sec per cast. (Frost)',
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
    cooldown: 8,
    range: 20,
    school: 'fire',
    requiresTarget: true,
    // Owner playtest 2026-07-11: pressable in the middle of another cast.
    usableWhileCasting: true,
    // Owner rule (round five): fully off the GCD, like Phoenix Trance: castable
    // during one and it never arms one for the other abilities.
    offGcd: true,
    // Owner playtest 2026-07-13: three stored charges (was two), back to back if banked.
    maxCharges: 3,
    // Owner playtest round four: no bolt, the embers bite the moment you press.
    projectile: false,
    effects: [{ type: 'directDamage', min: 27, max: 35 }],
    ranks: [
      { rank: 2, level: 12, cost: 60, effects: [{ type: 'directDamage', min: 44, max: 54 }] },
      { rank: 3, level: 18, cost: 85, effects: [{ type: 'directDamage', min: 68, max: 82 }] },
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
      { rank: 2, level: 14, cost: 75, effects: [{ type: 'directDamage', min: 14, max: 14 }] },
      { rank: 3, level: 20, cost: 105, effects: [{ type: 'directDamage', min: 22, max: 22 }] },
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
    ranks: [{ rank: 2, level: 18, cost: 70, effects: [{ type: 'polymorph', duration: 20 }] }],
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
    cooldown: 12,
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
    learnLevel: 18,
    cost: 85,
    castTime: 0,
    cooldown: 10,
    range: 30,
    school: 'fire',
    requiresTarget: false,
    targetMode: 'position',
    channel: { duration: 4, ticks: 4 },
    effects: [{ type: 'aoeDamage', min: 14, max: 18, radius: 7 }],
    description:
      'Calls a rain of fire onto the target area for 4 sec, burning enemies for $d Fire damage each second.',
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
      'Rains arrows on the target area for 3 sec, dealing $d damage every 0.5 sec to enemies caught in it.',
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
    name: 'Earthquake',
    class: 'shaman',
    learnLevel: 18,
    cost: 80,
    castTime: 0,
    cooldown: 12,
    range: 30,
    school: 'nature',
    requiresTarget: false,
    targetMode: 'position',
    effects: [{ type: 'groundAoE', min: 13, max: 17, radius: 8, duration: 6, interval: 1.5 }],
    description:
      'Shakes the target area for 6 sec, battering enemies for $d Nature damage every 1.5 sec.',
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
      { type: 'directDamage', min: 170, max: 225 },
      { type: 'dot', total: 48, duration: 12, interval: 2 },
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
      { rank: 2, level: 12, cost: 70, effects: [{ type: 'heal', min: 105, max: 125 }] },
      { rank: 3, level: 18, cost: 95, effects: [{ type: 'heal', min: 150, max: 178 }] },
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
    ],
    description:
      'Shifts the target a heartbeat out of the present, a temporal shell absorbing $d damage for 10 sec before the timeline snaps back.',
  },
  // ---- Chronomancy (healer) Phase 2: Temporal Echo, docs/prd/mage-chronomancy.md
  // section 13. Instant, on the GCD, no cooldown. A small initial heal (the sibling
  // `heal` effect, feeds $d) plus the per-caster mark (the `temporalEcho` effect,
  // feeds $t). While marked, 35% of the mage's single-target Arcane damage and 15%
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
  // A pre-existing individual echo on a target is kept at 35% (never downgraded),
  // still initial-healed, and counts within the five. PLAYTEST-provisional values
  // (owner 2026-07-12), gated by tests/chronomancy_balance.test.ts.
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
  collective_reversal: {
    id: 'collective_reversal',
    name: 'Collective Reversal',
    class: 'mage',
    learnLevel: 8,
    specs: ['arcane'],
    cost: 250,
    castTime: 7,
    cooldown: 0,
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
    effects: [{ type: 'rewind', fraction: 0.3, maxHpFraction: 0.35, windowSec: 5, radius: 40 }],
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
  // provisional: the base cost is DERIVED by tests/chronomancy_balance.test.ts to
  // land the conservative rotation near 70-80s to OOM at the level-20 pool.
  arcane_surge: {
    id: 'arcane_surge',
    name: 'Aether Surge',
    class: 'mage',
    learnLevel: 5,
    specs: ['arcane'],
    cost: 16,
    castTime: 2,
    cooldown: 0,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    // Instant impact at cast completion (no traveling bolt): keeps the charge
    // read/write in one deterministic order, see combat/chronomancy.ts.
    projectile: false,
    // (base cost is `cost: 16` above; DERIVED via the balance harness so the
    // targets hold WITH the 25% free-cast proc's mana relief.)
    // Low base damage (DERIVED via tests/chronomancy_balance.test.ts): the
    // conservative rotation must sustain clearly under Piro/Cryo (>=35% below);
    // the payoff is ramping it with charges (and the Echo healing it feeds).
    effects: [{ type: 'directDamage', min: 10, max: 13 }],
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
    effects: [{ type: 'weaponStrike', bonus: 3 }],
    ranks: [
      { rank: 2, level: 8, cost: 45, effects: [{ type: 'weaponStrike', bonus: 6 }] },
      { rank: 3, level: 14, cost: 45, effects: [{ type: 'weaponStrike', bonus: 12 }] },
      { rank: 4, level: 20, cost: 45, effects: [{ type: 'weaponStrike', bonus: 18 }] },
    ],
    description: 'An instant strike for weapon damage plus $d. Awards 1 combo point.',
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
    effects: [{ type: 'weaponStrike', bonus: 11, requiresBehind: true, weaponMult: 1.5 }],
    ranks: [
      {
        rank: 2,
        level: 12,
        cost: 60,
        effects: [{ type: 'weaponStrike', bonus: 20, requiresBehind: true, weaponMult: 1.5 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 60,
        effects: [{ type: 'weaponStrike', bonus: 32, requiresBehind: true, weaponMult: 1.5 }],
      },
    ],
    description:
      "Drive your dagger into the target's back for 150% weapon damage plus $d. Must be behind the target. Requires a dagger. Awards 1 combo point.",
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
    effects: [{ type: 'finisherHaste', mult: 1.3, basedur: 9, perCombo: 3 }],
    description:
      'Finishing move that increases melee attack speed by 30%. Lasts longer per combo point.',
  },
  sprint: {
    id: 'sprint',
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
    description: 'Finishing move that stuns the target. Lasts 1 sec longer per combo point.',
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
    effects: [{ type: 'weaponStrike', bonus: 28, requiresBehind: true, weaponMult: 2.5 }],
    description:
      'Strike from the shadows for 250% weapon damage plus $d. Must be stealthed and behind the target. Requires a dagger. Awards 1 combo point.',
  },
  stealth: {
    id: 'stealth',
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
    // Finisher: lands the full Sunder cap (5 stacks = 10% armor) in one cast.
    effects: [{ type: 'sunder', armor: 170, maxStacks: 5, full: true }],
    description: 'Finishing move that exposes the target, reducing its armor by $d% for 30 sec.',
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
    effects: [{ type: 'dot', total: 96, duration: 16, interval: 2 }],
    description: 'Finishing move that wounds the target, causing it to bleed for $d over 16 sec.',
  },
  vanish: {
    id: 'vanish',
    name: 'Smokestep',
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
    effects: [{ type: 'imbue', bonus: 4, duration: 30, judgeMin: 10, judgeMax: 18 }],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 35,
        effects: [{ type: 'imbue', bonus: 7, duration: 30, judgeMin: 18, judgeMax: 28 }],
      },
      {
        rank: 3,
        level: 16,
        cost: 50,
        effects: [{ type: 'imbue', bonus: 11, duration: 30, judgeMin: 30, judgeMax: 44 }],
      },
    ],
    description:
      'Fills you with Holy power for 30 sec, causing each of your melee swings to deal $d additional Holy damage. Unleash with Verdict.',
  },
  holy_light: {
    id: 'holy_light',
    name: 'Mending Light',
    class: 'paladin',
    learnLevel: 1,
    cost: 25,
    castTime: 2.5,
    cooldown: 0,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 42, max: 51 }],
    ranks: [
      { rank: 2, level: 8, cost: 50, effects: [{ type: 'heal', min: 76, max: 90 }] },
      { rank: 3, level: 14, cost: 70, effects: [{ type: 'heal', min: 122, max: 144 }] },
      { rank: 4, level: 20, cost: 115, effects: [{ type: 'heal', min: 190, max: 222 }] },
    ],
    description: 'Heals a friendly target for $d.',
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
      { type: 'buffTarget', kind: 'buff_armor_pct', value: 10, duration: 1800, party: true },
    ],
    description: 'Increases the armor of all party members by $b% for 30 min.',
  },
  judgement: {
    id: 'judgement',
    name: 'Verdict',
    class: 'paladin',
    learnLevel: 4,
    cost: 30,
    castTime: 0,
    cooldown: 10,
    range: 10,
    school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'judgement' }],
    description:
      'Unleashes your active Seal upon the enemy, consuming it to deal its judgement damage.',
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
    effects: [{ type: 'buffTarget', kind: 'buff_ap_pct', value: 10, duration: 1800, party: true }],
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
    cooldown: 180,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'absorb', amount: 50, duration: 10 }],
    ranks: [
      { rank: 2, level: 14, cost: 25, effects: [{ type: 'absorb', amount: 110, duration: 10 }] },
    ],
    description: 'A holy shield absorbs $d damage for 10 sec.',
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
    learnLevel: 8,
    cost: 30,
    castTime: 0,
    cooldown: 60,
    range: 10,
    school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'stun', duration: 3 }],
    ranks: [{ rank: 2, level: 16, cost: 45, effects: [{ type: 'stun', duration: 4 }] }],
    description: 'Stuns the target for $t sec.',
  },
  lay_on_hands: {
    id: 'lay_on_hands',
    name: 'Last Rite',
    class: 'paladin',
    learnLevel: 10,
    cost: 0,
    castTime: 0,
    cooldown: 600,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 250, max: 250 }],
    ranks: [{ rank: 2, level: 18, cost: 0, effects: [{ type: 'heal', min: 600, max: 600 }] }],
    description: 'A massive surge of healing: restores $d health. 10 min cooldown.',
  },
  holy_taunt: {
    id: 'holy_taunt',
    name: 'Sacred Goad',
    class: 'paladin',
    learnLevel: 10,
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
    description: 'A quick, efficient flash of Light that heals a friendly target for $d.',
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
  consecration: {
    id: 'consecration',
    name: 'Holy Ground',
    class: 'paladin',
    learnLevel: 8,
    cost: 60,
    castTime: 0,
    cooldown: 8,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'groundAoE', min: 28, max: 34, radius: 8, duration: 10, interval: 2 }],
    description:
      'Consecrates the ground beneath you, searing nearby enemies for $d Holy damage every 2 sec for 10 sec.',
  },
  righteous_fury: {
    id: 'righteous_fury',
    name: 'Burning Oath',
    class: 'paladin',
    learnLevel: 16,
    cost: 30,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'righteous_fury', value: 1.6, duration: 1800 }],
    description:
      "Increases the threat generated by your Holy damage by 60% for 30 min. The tanking paladin's cornerstone.",
  },
  retribution_aura: {
    id: 'retribution_aura',
    name: 'Requital Aura',
    class: 'paladin',
    learnLevel: 16,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    exclusiveGroup: 'paladin_aura',
    effects: [{ type: 'selfBuff', kind: 'thorns', value: 5, duration: 1800 }],
    description:
      'Surrounds you with holy energy for 30 min, dealing 5 Holy damage to any enemy that strikes you in melee.',
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
      'Patch up your companion, restoring 240 health over 12 sec if it is alive. If it is dead, revive it at 35% health.',
  },
  raptor_strike: {
    id: 'raptor_strike',
    name: 'Gutting Strike',
    class: 'hunter',
    learnLevel: 1,
    cost: 15,
    castTime: 0,
    cooldown: 6,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    onNextSwing: true,
    offGcd: true,
    effects: [{ type: 'weaponDamage', bonus: 5 }],
    ranks: [
      { rank: 2, level: 8, cost: 25, effects: [{ type: 'weaponDamage', bonus: 11 }] },
      { rank: 3, level: 14, cost: 35, effects: [{ type: 'weaponDamage', bonus: 18 }] },
      { rank: 4, level: 20, cost: 45, effects: [{ type: 'weaponDamage', bonus: 27 }] },
    ],
    description: 'A strong melee attack that increases damage by $d. Activates on your next swing.',
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
    description: 'Take on the aspect of the hawk, increasing attack power by $b for 30 min.',
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
    description: 'Stings the target, dealing $d Nature damage over 15 sec.',
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
      { rank: 2, level: 12, cost: 40, effects: [{ type: 'directDamage', min: 24, max: 30 }] },
      { rank: 3, level: 18, cost: 55, effects: [{ type: 'directDamage', min: 38, max: 47 }] },
    ],
    description: 'An instant shot that deals $d Arcane damage.',
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
    description: 'Dazes the target for $d damage, slowing movement by 50% for 4 sec.',
  },
  mongoose_bite: {
    id: 'mongoose_bite',
    name: 'Counterfang',
    class: 'hunter',
    learnLevel: 10,
    cost: 10,
    castTime: 0,
    cooldown: 5,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    requiresDodgeProc: true,
    effects: [{ type: 'weaponStrike', bonus: 12, cannotBeDodged: true }],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 10,
        effects: [{ type: 'weaponStrike', bonus: 24, cannotBeDodged: true }],
      },
    ],
    description:
      'Counterattack after the target dodges for weapon damage plus $d. Cannot be dodged.',
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
    description: 'Inflicts a wound for $d damage, slowing the enemy by 40% for 10 sec.',
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
    description: 'Take on the aspect of the monkey, increasing your dodge chance by 8% for 30 min.',
  },
  aspect_of_the_cheetah: {
    id: 'aspect_of_the_cheetah',
    name: "Courser's Guise",
    class: 'hunter',
    learnLevel: 14,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    exclusiveGroup: 'aspect',
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.3, duration: 1800 }],
    description: 'Take on the aspect of the cheetah, increasing movement speed by 30% for 30 min.',
  },
  aimed_shot: {
    id: 'aimed_shot',
    name: 'Long Draw',
    class: 'hunter',
    learnLevel: 11,
    cost: 50,
    castTime: 3.0,
    cooldown: 6,
    range: 35,
    minRange: 8,
    school: 'physical',
    projectile: true, // a fired shot: damage resolves when the arrow lands
    scalesWith: 'ranged',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 50, max: 62 }],
    description: 'A carefully aimed shot that deals $d damage.',
  },
  rapid_fire: {
    id: 'rapid_fire',
    name: 'Fevered Draw',
    class: 'hunter',
    learnLevel: 20,
    cost: 0,
    castTime: 0,
    cooldown: 300,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_haste', value: 1.4, duration: 15 }],
    description: 'Increases your attack speed by 40% for 15 sec.',
  },

  // ====================== PRIEST ======================
  smite: {
    id: 'smite',
    name: 'Smite',
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
      { rank: 2, level: 8, cost: 32, effects: [{ type: 'directDamage', min: 26, max: 33 }] },
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
    description: 'Smites the enemy for $d Holy damage.',
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
      { rank: 2, level: 6, cost: 45, effects: [{ type: 'heal', min: 72, max: 86 }] },
      { rank: 3, level: 12, cost: 65, effects: [{ type: 'heal', min: 110, max: 132 }] },
    ],
    description: 'Heals a friendly target for $d.',
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
    description: 'Increases the Stamina of all party members by $b% for 30 min.',
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
    description: 'A word of darkness causes $d Shadow damage over 18 sec.',
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
      { rank: 2, level: 12, cost: 70, effects: [{ type: 'absorb', amount: 90, duration: 30 }] },
      { rank: 3, level: 18, cost: 100, effects: [{ type: 'absorb', amount: 145, duration: 30 }] },
    ],
    description: 'Shields the target, absorbing $d damage for 30 sec.',
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
        effects: [{ type: 'hot', total: 140, duration: 15, interval: 3 }],
      },
    ],
    description: 'Heals the target for $d over 15 sec.',
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
      { rank: 2, level: 14, cost: 70, effects: [{ type: 'directDamage', min: 60, max: 66 }] },
      { rank: 3, level: 20, cost: 95, effects: [{ type: 'directDamage', min: 86, max: 94 }] },
    ],
    description: "Blasts the target's mind for $d Shadow damage.",
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
    ranks: [{ rank: 2, level: 20, cost: 130, effects: [{ type: 'heal', min: 230, max: 270 }] }],
    description: 'A slow but powerful prayer that heals a friendly target for $d.',
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
      "Assaults the target's mind with Shadow energy, causing $d Shadow damage each second for 3 sec.",
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
    effects: [{ type: 'heal', min: 120, max: 142 }],
    description: 'A fast prayer that heals a friendly target for $d.',
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
    description: 'Hurls a bolt of lightning for $d Nature damage.',
  },
  rockbiter_weapon: {
    id: 'rockbiter_weapon',
    name: 'Stonebound Weapon',
    class: 'shaman',
    learnLevel: 1,
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 5, duration: 300 }],
    ranks: [
      { rank: 2, level: 8, cost: 30, effects: [{ type: 'imbue', bonus: 9, duration: 300 }] },
      { rank: 3, level: 16, cost: 45, effects: [{ type: 'imbue', bonus: 14, duration: 300 }] },
    ],
    description:
      'Imbues your weapon with the fury of stone: each swing deals $d additional damage for 5 min.',
  },
  // Restoration shaman signature (granted only via the Restoration spec, not in the base
  // kit). v1 is a strong single-target heal; the multi-target "chain" bounce is a
  // follow-up once a bounce/jump primitive exists.
  chain_heal: {
    id: 'chain_heal',
    name: 'Chain Heal',
    class: 'shaman',
    learnLevel: 10,
    cost: 60,
    castTime: 2.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'chainHeal', min: 120, max: 145, jumps: 2, falloff: 0.5, radius: 12 }],
    description:
      'Heals a friendly target for 120 to 145, then jumps to up to 2 additional nearby allies, healing for 50% less with each jump. (Restoration signature)',
  },
  healing_wave: {
    id: 'healing_wave',
    name: 'Mending Waters',
    class: 'shaman',
    learnLevel: 1,
    cost: 25,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'nature',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'heal', min: 36, max: 44 }],
    ranks: [
      { rank: 2, level: 6, cost: 40, castTime: 2.0, effects: [{ type: 'heal', min: 56, max: 68 }] },
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
    ],
    description: 'Heals a friendly target for $d.',
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
      { rank: 2, level: 10, cost: 45, effects: [{ type: 'directDamage', min: 33, max: 38 }] },
      { rank: 3, level: 16, cost: 65, effects: [{ type: 'directDamage', min: 54, max: 61 }] },
    ],
    description: 'Instantly shocks the target with concussive force for $d Nature damage.',
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
      'Surrounds you with crackling lightning: melee attackers take $b Nature damage, up to 3 charges and at most once every 5 seconds.',
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
    description: 'Sears the target with fire for $d damage plus $o over 12 sec.',
  },
  flametongue_weapon: {
    id: 'flametongue_weapon',
    name: 'Pyrebrand Weapon',
    class: 'shaman',
    learnLevel: 5,
    cost: 25,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 8, duration: 300 }],
    ranks: [
      { rank: 2, level: 18, cost: 40, effects: [{ type: 'imbue', bonus: 13, duration: 300 }] },
    ],
    description:
      'Imbues your weapon with elemental fire: each swing deals $d additional Fire damage for 5 min.',
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
      'Instantly shocks the target with frost for $d Frost damage and slows its movement by 50% for 8 sec.',
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
      { rank: 2, level: 20, cost: 40, effects: [{ type: 'imbue', bonus: 13, duration: 300 }] },
    ],
    description:
      'Imbues your weapon with biting frost: each swing deals $d additional damage for 5 min.',
  },
  ghost_wolf: {
    id: 'ghost_wolf',
    name: 'Shadewolf',
    class: 'shaman',
    learnLevel: 16,
    cost: 35,
    castTime: 2.0,
    cooldown: 0,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.4, duration: 3600 }],
    description:
      'Turns you into a Shadewolf, increasing movement speed by 40%. Cast again to return to normal form.',
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
      'Channels the storm through your weapon, instantly striking for weapon damage plus $d.',
  },

  // ====================== WARLOCK ======================
  shadow_bolt: {
    id: 'shadow_bolt',
    name: 'Gloom Bolt',
    class: 'warlock',
    learnLevel: 1,
    cost: 25,
    castTime: 1.7,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 13, max: 18 }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 38,
        castTime: 2.2,
        effects: [{ type: 'directDamage', min: 24, max: 31 }],
      },
      {
        rank: 3,
        level: 14,
        cost: 55,
        castTime: 2.7,
        effects: [{ type: 'directDamage', min: 42, max: 53 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 80,
        castTime: 3.0,
        effects: [{ type: 'directDamage', min: 68, max: 84 }],
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
    learnLevel: 1,
    cost: 25,
    castTime: 2.0,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 11, max: 11 },
      { type: 'dot', total: 20, duration: 15, interval: 3 },
    ],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 40,
        effects: [
          { type: 'directDamage', min: 22, max: 22 },
          { type: 'dot', total: 35, duration: 15, interval: 3 },
        ],
      },
      {
        rank: 3,
        level: 16,
        cost: 60,
        effects: [
          { type: 'directDamage', min: 38, max: 38 },
          { type: 'dot', total: 60, duration: 15, interval: 3 },
        ],
      },
    ],
    description: 'Burns the enemy for $d Fire damage and an additional $o over 15 sec.',
  },
  corruption: {
    id: 'corruption',
    name: 'Blackrot',
    class: 'warlock',
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
    learnLevel: 6,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'lifeTap', hp: 30, mana: 30 }],
    ranks: [
      { rank: 2, level: 14, cost: 0, effects: [{ type: 'lifeTap', hp: 55, mana: 55 }] },
      { rank: 3, level: 20, cost: 0, effects: [{ type: 'lifeTap', hp: 85, mana: 85 }] },
    ],
    description: 'Converts $d health into $d mana.',
  },
  curse_of_agony: {
    id: 'curse_of_agony',
    name: 'Hex of Anguish',
    class: 'warlock',
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
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    channel: { duration: 5, ticks: 5 },
    cooldown: 0,
    range: 20,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'drainTick', min: 7, max: 7, healFrac: 1 }],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 50,
        effects: [{ type: 'drainTick', min: 12, max: 12, healFrac: 1 }],
      },
      {
        rank: 3,
        level: 20,
        cost: 70,
        effects: [{ type: 'drainTick', min: 17, max: 17, healFrac: 1 }],
      },
    ],
    description: "Drains the target's life, transferring $d health to you each second for 5 sec.",
  },
  fear: {
    id: 'fear',
    name: 'Harrow',
    class: 'warlock',
    learnLevel: 14,
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
    learnLevel: 14,
    cost: 35,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 30, max: 38 }],
    description: 'Sears the enemy with agonizing fire for $d Fire damage. Quick to cast.',
  },
  shadowburn: {
    id: 'shadowburn',
    name: 'Duskfire',
    class: 'warlock',
    learnLevel: 14,
    cost: 70,
    castTime: 0,
    cooldown: 15,
    range: 20,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 56, max: 66 }],
    description: 'Instantly blasts the target with searing shadow for $d Shadow damage.',
  },
  summon_imp: {
    id: 'summon_imp',
    name: 'Summon Emberkin',
    class: 'warlock',
    learnLevel: 1,
    cost: 50,
    castTime: 5,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'emberkin' }],
    description:
      'Summons an Emberkin under the command of the Warlock. The Emberkin hurls Ashbolts at your enemies from afar. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_voidwalker: {
    id: 'summon_voidwalker',
    name: 'Summon Gloomshade',
    class: 'warlock',
    learnLevel: 8,
    cost: 80,
    castTime: 5,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'gloomshade' }],
    description:
      'Summons a Gloomshade under the command of the Warlock. The Gloomshade is a sturdy demon that taunts your enemies and soaks up punishment. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_succubus: {
    id: 'summon_succubus',
    name: 'Summon Duskborn',
    class: 'warlock',
    learnLevel: 12,
    cost: 100,
    castTime: 5,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'duskborn' }],
    description:
      'Summons a Duskborn under the command of the Warlock. The Duskborn is a fragile demon that strikes quickly and hits hard in melee. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_felhunter: {
    id: 'summon_felhunter',
    name: 'Summon Spellhound',
    class: 'warlock',
    learnLevel: 14,
    cost: 120,
    castTime: 5,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'spellhound' }],
    description:
      'Summons a Spellhound under the command of the Warlock. The Spellhound harries enemies from range with Gloombite and excels at hunting spellcasters. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_felguard: {
    id: 'summon_felguard',
    name: 'Summon Warfiend',
    class: 'warlock',
    learnLevel: 16,
    cost: 150,
    castTime: 5,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'warfiend' }],
    description:
      'Summons a Warfiend under the command of the Warlock. The Warfiend is a durable melee demon that wades into battle and holds its own. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_infernal: {
    id: 'summon_infernal',
    name: 'Summon Pyre Colossus',
    class: 'warlock',
    learnLevel: 18,
    cost: 140,
    castTime: 6,
    cooldown: 180,
    range: 0,
    school: 'fire',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'pyre_colossus' }],
    description:
      'Binds a Pyre Colossus to your will — a hulking juggernaut with crushing melee and the deepest health and armor of any demon. A long cooldown gates its raw power. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_doomguard: {
    id: 'summon_doomguard',
    name: 'Summon Wraithborn',
    class: 'warlock',
    learnLevel: 20,
    cost: 150,
    castTime: 6,
    cooldown: 180,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'wraithborn' }],
    description:
      'Binds a Wraithborn to your will — an elite demon that rains heavy Shadow damage from afar. A long cooldown gates its devastating power. Summoning a new demon dismisses your current one. You may have one demon at a time.',
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
      { rank: 3, level: 14, cost: 48, effects: [{ type: 'directDamage', min: 38, max: 45 }] },
      { rank: 4, level: 20, cost: 70, effects: [{ type: 'directDamage', min: 60, max: 71 }] },
    ],
    description: 'Hurls a bolt of nature energy for $d Nature damage.',
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
      { rank: 2, level: 8, cost: 45, castTime: 3.0, effects: [{ type: 'heal', min: 68, max: 86 }] },
      { rank: 3, level: 14, cost: 75, effects: [{ type: 'heal', min: 115, max: 140 }] },
      { rank: 4, level: 20, cost: 110, effects: [{ type: 'heal', min: 175, max: 208 }] },
    ],
    description: 'Heals a friendly target for $d.',
  },
  mark_of_the_wild: {
    id: 'mark_of_the_wild',
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
      { type: 'buffTarget', kind: 'buff_stats_pct', value: 5, duration: 1800, party: true },
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
          { type: 'directDamage', min: 28, max: 34 },
          { type: 'dot', total: 40, duration: 12, interval: 3 },
        ],
      },
    ],
    description: 'Burns the enemy with moonfire for $d Arcane damage plus damage over time.',
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
        effects: [{ type: 'hot', total: 116, duration: 12, interval: 3 }],
      },
    ],
    description: 'Heals the target for $d over 12 sec.',
  },
  thorns: {
    id: 'thorns',
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
      'Shapeshift into a bear: armor +90%, greatly increased attack power, your attacks build rage and generate 30% more threat. Cast again to return to caster form.',
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
    requiresStealth: true,
    effects: [
      { type: 'weaponStrike', bonus: 8 },
      { type: 'dot', total: 30, duration: 9, interval: 3 },
    ],
    ranks: [
      {
        rank: 2,
        level: 18,
        cost: 35,
        effects: [
          { type: 'weaponStrike', bonus: 12 },
          { type: 'dot', total: 48, duration: 9, interval: 3 },
        ],
      },
    ],
    description:
      'A stealth opener that rakes the enemy for weapon damage plus $d and causes bleeding damage over 9 sec. Awards 1 combo point. Wolf Form only.',
  },
  claw: {
    id: 'claw',
    name: 'Claw',
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
    effects: [{ type: 'weaponStrike', bonus: 12 }],
    ranks: [{ rank: 2, level: 18, cost: 45, effects: [{ type: 'weaponStrike', bonus: 20 }] }],
    description: 'Claw the enemy for weapon damage plus $d. Awards 1 combo point. Wolf Form only.',
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
    effects: [{ type: 'finisherDamage', base: 10, perCombo: 14, variance: 6 }],
    description: 'Finishing move that causes $d. Wolf Form only.',
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
    description: 'Heals a friendly target for $d and an additional amount over 21 sec.',
  },
  barkskin: {
    id: 'barkskin',
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
    effects: [{ type: 'directDamage', min: 80, max: 112 }],
    description: 'Calls down a bolt of stellar fire, causing $d Arcane damage.',
  },
  travel_form: {
    id: 'travel_form',
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
    description: "Decreases the target's armor by $d% for 40 sec. Does not stack with Armor Shear.",
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
    name: 'Rip',
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
    effects: [{ type: 'dot', total: 60, duration: 12, interval: 2 }],
    description:
      'Finishing move that causes $d Bleed damage over 12 sec. Consumes combo points. Wolf Form only.',
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
      { type: 'dot', total: 30, duration: 6, interval: 3, auraId: 'deep_wounds' },
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
    name: 'Heroic Leap',
    class: 'warrior',
    learnLevel: 6,
    cost: 0,
    castTime: 0,
    cooldown: 20,
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
    name: 'Storm Bolt',
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
    // the 1-20 band: cost and cooldown tuned down, the fear itself unchanged.
    effects: [{ type: 'aoeFear', duration: 8, radius: 8, maxTargets: 5 }],
    description:
      'A terrifying shout that sends up to 5 enemies within 8 yards fleeing in fear for 8 sec. Damage may break the effect.',
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
    name: 'Victory Rush',
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
    effects: [
      { type: 'breakControl' },
      // ONE aura for both halves (value = damage amp; the body scale is the
      // fixed AVATAR_SCALE): two selfBuffs would overwrite each other, since
      // applyAura replaces by aura id and both would be 'avatar'.
      { type: 'selfBuff', kind: 'buff_avatar', value: 0.2, duration: 20 },
    ],
    description:
      'Transform into a colossus for 20 sec, breaking all control on you and increasing your damage dealt by 20%.',
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
    effects: [{ type: 'partyMeleeBuff', attackSpeedMult: 1 / 1.1, dmgPct: 0.1, duration: 20 }],
    description:
      'Imbue your weapon with the blood of your foes: you and your melee allies gain 10% attack speed and 10% damage for 20 sec.',
  },

  // ============== TALENT-GRANTED (Classic specs) ==============
  // Not in CLASSES.*.abilities. Unlocked only via spec grants.
  crusader_strike: {
    id: 'crusader_strike',
    name: 'Crusader Strike',
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
    name: 'Dread Aspect',
    class: 'warlock',
    learnLevel: 10,
    cost: 75,
    castTime: 0,
    cooldown: 180,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [
      { type: 'selfBuff', kind: 'form_metamorph', value: 1, duration: 20 },
      { type: 'selfBuff', kind: 'buff_spelldmg', value: 0.2, duration: 20 },
      { type: 'selfBuff', kind: 'buff_spellhaste', value: 0.2, duration: 20 },
      { type: 'petBuff', kind: 'pet_damage_pct', value: 50, duration: 20 },
      { type: 'petBuff', kind: 'pet_spellhaste', value: 0.2, duration: 20 },
    ],
    description:
      'Transform into a monstrous demon for 20 sec, increasing your spell damage by 20% and casting speed by 20%. Your demon gains 50% damage and 20% casting speed. (Demonology signature)',
  },
  holy_shock: {
    id: 'holy_shock',
    name: 'Holy Shock',
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
    description:
      'Shocks a friendly target with Holy energy to heal them, or an enemy for $d Holy damage. (Holy signature)',
  },
  holy_shield: {
    id: 'holy_shield',
    name: 'Hallowed Wall',
    class: 'paladin',
    learnLevel: 10,
    cost: 30,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    effects: [
      { type: 'directDamage', min: 90, max: 110 },
      { type: 'chainDamage', min: 60, max: 75, jumps: 2, falloff: 1, radius: 10 },
    ],
    description:
      'Hurls a radiant aegis at an enemy for 90 to 110 Holy damage, then bounces to 2 nearby enemies for 60 to 75 Holy damage each. (Protection signature)',
  },
  bestial_wrath: {
    id: 'bestial_wrath',
    name: 'Howling Rage',
    class: 'hunter',
    learnLevel: 10,
    cost: 40,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [
      { type: 'selfBuff', kind: 'buff_ap_pct', value: 20, duration: 15 },
      { type: 'petBuff', kind: 'pet_damage_pct', value: 100, duration: 15 },
    ],
    description:
      'Sends you into a bestial rage, increasing your attack power by 20% and your pet damage by 100% for 15 sec. (Beast Mastery signature)',
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
      'Inspires nearby allies, increasing attack power by 10% for 30 min. (Marksmanship signature)',
  },
  wyvern_sting: {
    id: 'wyvern_sting',
    name: 'Wyvern Sting',
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
      'Combust: for 10 sec your Fire spells always critically strike, including bolts already in flight. Off the global cooldown. These crits build Hot Streak like any other. (Fire signature)',
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
    name: 'Icy Veins',
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
      'Focuses your killing intent so your next attack is a critical strike. (Assassination signature)',
  },
  blade_flurry: {
    id: 'blade_flurry',
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
      'Unleashes a flurry of blades, increasing attack speed by 20% for 12 sec. (Combat signature)',
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
      'Strikes the enemy for weapon damage plus $d, causes bleeding damage over 12 sec, and increases bleed damage taken by 40%. Awards 1 combo point. (Subtlety signature)',
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
    effects: [{ type: 'buffTarget', kind: 'buff_spellhaste', value: 0.2, duration: 15 }],
    description:
      'Infuses a friendly target with power, increasing spell haste by 20% for 15 sec. (Discipline signature)',
  },
  holy_nova: {
    id: 'holy_nova',
    name: 'Holy Nova',
    class: 'priest',
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
    description:
      'Causes an explosion of Mending Light, healing nearby allies for $d and damaging nearby enemies. (Holy signature)',
  },
  shadowform: {
    id: 'shadowform',
    name: 'Gloamveil',
    class: 'priest',
    learnLevel: 10,
    cost: 60,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_shadow', value: 15, duration: 3600 }],
    description:
      'Assume a Gloamveil, empowering shadow magic until you shift back. Cast again to return to normal form. (Shadow signature)',
  },
  elemental_mastery: {
    id: 'elemental_mastery',
    name: 'Primal Mastery',
    class: 'shaman',
    learnLevel: 10,
    cost: 45,
    castTime: 0,
    cooldown: 120,
    range: 0,
    school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'next_cast_instant', value: 1, duration: 60 }],
    description: 'Calls on primal mastery, making your next spell instant. (Elemental signature)',
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
    learnLevel: 10,
    cost: 55,
    castTime: 0,
    cooldown: 6,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'consumeAura', auraIds: ['immolate'], deal: { min: 54, max: 64 } }],
    description:
      'Consumes your Burning Pact on the enemy to ignite them for $d Fire damage. (Destruction signature)',
  },
  moonkin_form: {
    id: 'moonkin_form',
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
    name: 'Swiftmend',
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
    description:
      'Consumes a heal-over-time effect on a friendly target to heal them for $d. (Restoration signature)',
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
    name: 'Flickerstep',
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
    description:
      'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Hunter talent)',
  },
  counterspell: {
    id: 'counterspell',
    name: 'Spellbreak',
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
    // One dispatch applies the vanish, the damage cut (duration + linger so it
    // survives an early break), and strips up to two DoTs (effect_dispatch).
    effects: [
      { type: 'greaterInvisibility', duration: 20, drValue: 0.9, linger: 3, removeDotCount: 2 },
    ],
    description:
      'Vanish for 20 sec: removes 2 damage-over-time effects and you take 90% less damage while invisible and shortly after. (Mage talent)',
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
      'Finishes the cooldown on Flickerstep, Frostveil, and Greater Invisibility. (Mage talent)',
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
    effects: [{ type: 'aoeAllyAbsorb', amount: 130, duration: 60, radius: 30, maxTargets: 5 }],
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
      { type: 'groundAoE', min: 0, max: 0, radius: 8, duration: 15, interval: 2, allyBuffPct: 0.1 },
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
    name: 'Gag Order',
    class: 'warlock',
    learnLevel: 10,
    cost: 35,
    castTime: 0,
    cooldown: 24,
    range: 30,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout: 5 }],
    description:
      'Interrupts spellcasting and prevents any spell in that school from being cast for 5 sec. (Warlock talent)',
  },

  // Canonical Talents V2 active grants. These are absent from baseline class kits
  // and become known only through the selected row's `grant` effect.
  ...TALENT_ABILITIES_V2,

  // The Vale Cup sport kit (class-agnostic; docs/prd/vale-cup.md). Merged here
  // so every ABILITIES consumer (casting, icons, hotbar validation, tooltips)
  // resolves sport ids; no class lists them, so abilitiesKnownAt never grants
  // them outside a match (resolveSportKit is the only entry).
  ...SPORT_ABILITIES,
};

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
    case 'dot':
      // A directPct rider snapshots an already-scaled direct hit; scaling the
      // fraction again would double-apply the talent/global damage modifier.
      return eff.directPct
        ? { ...eff }
        : { ...eff, total: Math.round(eff.total * dmgMult * dotMult + flat) };
    case 'aoeDamage':
    case 'aoeHeal':
      return {
        ...eff,
        min: Math.round(eff.min * (eff.type === 'aoeHeal' ? healMult : dmgMult) + flat),
        max: Math.round(eff.max * (eff.type === 'aoeHeal' ? healMult : dmgMult) + flat),
      };
    case 'aoeRoot':
      return { ...eff, min: Math.round(eff.min * dmgMult), max: Math.round(eff.max * dmgMult) };
    case 'drainTick':
      return { ...eff, min: Math.round(eff.min * dmgMult), max: Math.round(eff.max * dmgMult) };
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
        judgeMin:
          eff.judgeMin === undefined ? undefined : Math.round(eff.judgeMin * dmgMult + flat),
        judgeMax:
          eff.judgeMax === undefined ? undefined : Math.round(eff.judgeMax * dmgMult + flat),
      };
    case 'judgement':
      return {
        ...eff,
        dmgMult: (eff.dmgMult ?? 1) * dmgMult,
        flat: (eff.flat ?? 0) + flat,
      };
    case 'heal':
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
    case 'hot':
      return { ...eff, total: Math.round(eff.total * healMult * hotMult + flat) };
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
      return { ...eff, amount: Math.round(eff.amount * healMult * absorbMult + flat) };
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
      return { ...eff, amount: Math.round(eff.amount * dmgMult + flat) };
    default:
      return eff;
  }
}

// Fold precomputed talent modifiers into one resolved ability (FR-5.3). Global
// melee/spell/heal mults apply to every ability of the right school; per-ability
// mods stack on top and also tune cost / cast time / cooldown.
function applyTalentMods(entry: KnownAbility, mods: TalentModifiers): void {
  const am = mods.abilities[entry.def.id];
  const physical = entry.def.school === 'physical';
  const globalDmg = physical ? mods.global.meleeDmgPct : mods.global.spellDmgPct;
  const dmgMult = 1 + globalDmg + (am?.dmgPct ?? 0);
  const healMult = 1 + mods.global.healPct + (am?.dmgPct ?? 0);
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
    if (am.castWhileMoving) entry.castWhileMoving = true;
    if (am.damagePushbackImmune) entry.damagePushbackImmune = true;
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
    const granted = grantIds.has(id) || !baseIds.includes(id);
    if (!granted && def.learnLevel > level) continue; // class kit is level-gated; grants bypass it
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
