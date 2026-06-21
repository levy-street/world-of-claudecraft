import type { AbilityDef, AbilityEffect, PlayerClass, Stats, WeaponInfo } from '../types';
import type { TalentModifiers } from './talents';

// ---------------------------------------------------------------------------
// Player classes — per-level base stats follow vanilla growth curves.
// HP/mana rules are the real ones: first 20 stamina gives 1 hp each, the rest
// 10 hp each; first 20 intellect gives 1 mana each, the rest 15 mana each.
// ---------------------------------------------------------------------------

export interface ClassDef {
  id: PlayerClass;
  name: string;
  baseStats: Stats;
  statsPerLevel: Stats;
  baseHp: number; // class hp before stamina at level 1
  hpPerLevel: number;
  baseMana: number;
  manaPerLevel: number;
  resourceType: 'rage' | 'mana' | 'energy';
  startWeapon: string;
  startChest: string;
  // hunters: auto shot (8yd deadzone). casters: wand (wand:true → no deadzone,
  // fires a magic-school bolt so they don't run into melee to auto-attack, #94)
  ranged?: WeaponInfo & { maxRange: number; minRange: number; wand?: boolean; school?: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature' };
  abilities: string[]; // full kit, in learn order
  color: number;
}

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
    startChest: 'recruit_tunic',
    abilities: ['heroic_strike', 'battle_shout', 'commanding_shout', 'charge', 'rend', 'thunder_clap', 'hamstring', 'bloodrage', 'overpower', 'execute', 'slam', 'cleave', 'defensive_stance', 'demoralizing_shout', 'sunder_armor', 'taunt'],
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
    ranged: { min: 3, max: 6, speed: 1.8, maxRange: 30, minRange: 0, wand: true, school: 'arcane' },
    abilities: ['fireball', 'frost_armor', 'arcane_intellect', 'frostbolt', 'conjure_water', 'conjure_food', 'fire_blast', 'arcane_missiles', 'polymorph', 'frost_nova', 'arcane_explosion', 'scorch', 'ice_barrier', 'pyroblast'],
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
    startChest: 'footpad_jerkin',
    abilities: ['sinister_strike', 'eviscerate', 'garrote', 'backstab', 'gouge', 'cheap_shot', 'evasion', 'sap', 'slice_and_dice', 'sprint', 'crippling_poison', 'kidney_shot', 'expose_armor', 'ambush', 'rupture', 'vanish', 'instant_poison', 'adrenaline_rush', 'deadly_poison', 'blind', 'stealth'],
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
    abilities: ['seal_of_righteousness', 'holy_light', 'devotion_aura', 'judgement', 'blessing_of_might', 'divine_protection', 'hammer_of_justice', 'lay_on_hands', 'flash_of_light', 'exorcism', 'consecration', 'righteous_fury', 'retribution_aura'],
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
    ranged: { min: 5, max: 9, speed: 2.3, maxRange: 35, minRange: 8 },
    abilities: ['raptor_strike', 'aspect_of_the_hawk', 'serpent_sting', 'arcane_shot', 'concussive_shot', 'mongoose_bite', 'wing_clip', 'tame_beast', 'dismiss_pet', 'revive_pet', 'aspect_of_the_monkey', 'aspect_of_the_cheetah', 'aimed_shot', 'rapid_fire'],
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
    ranged: { min: 3, max: 6, speed: 1.8, maxRange: 30, minRange: 0, wand: true, school: 'holy' },
    abilities: ['smite', 'lesser_heal', 'power_word_fortitude', 'shadow_word_pain', 'power_word_shield', 'renew', 'mind_blast', 'heal', 'mind_flay', 'flash_heal'],
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
    abilities: ['lightning_bolt', 'rockbiter_weapon', 'healing_wave', 'earth_shock', 'lightning_shield', 'flame_shock', 'flametongue_weapon', 'frost_shock', 'frostbrand_weapon', 'ghost_wolf', 'stormstrike'],
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
    ranged: { min: 3, max: 6, speed: 1.8, maxRange: 30, minRange: 0, wand: true, school: 'shadow' },
    abilities: ['shadow_bolt', 'summon_imp', 'demon_skin', 'immolate', 'corruption', 'life_tap', 'summon_voidwalker', 'curse_of_agony', 'drain_life', 'fear', 'searing_pain', 'shadowburn', 'summon_succubus', 'summon_felhunter', 'summon_felguard', 'summon_infernal', 'summon_doomguard'],
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
    abilities: ['wrath', 'healing_touch', 'mark_of_the_wild', 'moonfire', 'rejuvenation', 'thorns', 'entangling_roots', 'bear_form', 'bear_charge', 'maul', 'growl', 'demoralizing_roar', 'cat_form', 'prowl', 'rake', 'claw', 'regrowth', 'ferocious_bite', 'barkskin', 'swipe', 'starfire', 'travel_form', 'enrage', 'bash', 'faerie_fire', 'hibernate', 'dash', 'pounce', 'insect_swarm', 'tigers_fury', 'rip'],
    color: 0xff7d0a,
  },
};

// ---------------------------------------------------------------------------
// Abilities — rank values and learn levels from vanilla (levels 1-10)
// ---------------------------------------------------------------------------

export const ABILITIES: Record<string, AbilityDef> = {
  // ====================== WARRIOR ======================
  heroic_strike: {
    id: 'heroic_strike', name: 'Heroic Strike', class: 'warrior', learnLevel: 1,
    cost: 15, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, onNextSwing: true, offGcd: true,
    threat: { flat: 20 }, // classic per-rank values: 20/39/59/78
    effects: [{ type: 'weaponDamage', bonus: 11 }],
    ranks: [
      { rank: 2, level: 8, cost: 15, threatFlat: 39, effects: [{ type: 'weaponDamage', bonus: 21 }] },
      { rank: 3, level: 14, cost: 15, threatFlat: 59, effects: [{ type: 'weaponDamage', bonus: 32 }] },
      { rank: 4, level: 20, cost: 15, threatFlat: 78, effects: [{ type: 'weaponDamage', bonus: 44 }] },
    ],
    description: 'A strong attack that increases melee damage by $d. Activates on your next swing.',
  },
  battle_shout: {
    id: 'battle_shout', name: 'Battle Shout', class: 'warrior', learnLevel: 1,
    cost: 10, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 20, duration: 120 }],
    ranks: [
      { rank: 2, level: 12, cost: 10, effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 35, duration: 120 }] },
      { rank: 3, level: 20, cost: 10, effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 50, duration: 120 }] },
    ],
    description: 'Increases your attack power by 20 for 2 min.',
  },
  commanding_shout: {
    id: 'commanding_shout', name: 'Commanding Shout', class: 'warrior', learnLevel: 14,
    cost: 10, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_sta', value: 6, duration: 120 }],
    ranks: [
      { rank: 2, level: 24, cost: 10, effects: [{ type: 'selfBuff', kind: 'buff_sta', value: 11, duration: 120 }] },
    ],
    description: 'Increases your Stamina by 6 for 2 min.',
  },
  demoralizing_shout: {
    id: 'demoralizing_shout', name: 'Demoralizing Shout', class: 'warrior', learnLevel: 14,
    cost: 10, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'aoeAttackPower', amount: 30, duration: 30, radius: 10 }],
    ranks: [
      { rank: 2, level: 20, cost: 10, effects: [{ type: 'aoeAttackPower', amount: 45, duration: 30, radius: 10 }] },
    ],
    description: 'Lets out a fearsome shout, reducing the attack power of all nearby enemies by 30 for 30 sec.',
  },
  charge: {
    id: 'charge', name: 'Charge', class: 'warrior', learnLevel: 4,
    cost: 0, castTime: 0, cooldown: 15, range: 25, minRange: 8, school: 'physical',
    requiresTarget: true, offGcd: true,
    effects: [{ type: 'charge' }, { type: 'stun', duration: 1 }],
    description: 'Charges an enemy, generating 9 rage and stunning it for 1 sec. 8-25 yd range.',
  },
  rend: {
    id: 'rend', name: 'Rend', class: 'warrior', learnLevel: 4,
    cost: 10, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 15, duration: 9, interval: 3 }],
    ranks: [
      { rank: 2, level: 10, cost: 10, effects: [{ type: 'dot', total: 21, duration: 9, interval: 3 }] },
      { rank: 3, level: 16, cost: 10, effects: [{ type: 'dot', total: 36, duration: 12, interval: 3 }] },
    ],
    description: 'Wounds the target, causing them to bleed for $d damage over 9 sec.',
  },
  thunder_clap: {
    id: 'thunder_clap', name: 'Thunder Clap', class: 'warrior', learnLevel: 6,
    cost: 20, castTime: 0, cooldown: 4, range: 0, school: 'physical',
    requiresTarget: false,
    threat: { mult: 2.5 }, // classic: thunder clap damage causes 2.5x threat
    effects: [
      { type: 'aoeDamage', min: 12, max: 14, radius: 8 },
      { type: 'aoeAttackSpeed', mult: 1.1, duration: 10, radius: 8 },
    ],
    ranks: [
      {
        rank: 2, level: 14, cost: 20,
        effects: [
          { type: 'aoeDamage', min: 23, max: 27, radius: 8 },
          { type: 'aoeAttackSpeed', mult: 1.1, duration: 10, radius: 8 },
        ],
      },
      {
        rank: 3, level: 20, cost: 20,
        effects: [
          { type: 'aoeDamage', min: 37, max: 43, radius: 8 },
          { type: 'aoeAttackSpeed', mult: 1.1, duration: 10, radius: 8 },
        ],
      },
    ],
    description: 'Blasts nearby enemies for $d damage and slows their attacks by 10% for 10 sec.',
  },
  hamstring: {
    id: 'hamstring', name: 'Hamstring', class: 'warrior', learnLevel: 8,
    cost: 10, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 5, max: 5 }, { type: 'slow', mult: 0.5, duration: 15 }],
    ranks: [{
      rank: 2, level: 16, cost: 10,
      effects: [{ type: 'directDamage', min: 12, max: 12 }, { type: 'slow', mult: 0.5, duration: 15 }],
    }],
    description: 'Maims the enemy for 5 damage, slowing its movement by 50% for 15 sec.',
  },
  bloodrage: {
    id: 'bloodrage', name: 'Bloodrage', class: 'warrior', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 60, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'selfDamagePctMax', pct: 0.08 }, { type: 'gainResource', amount: 10 }],
    description: 'Generates 10 rage at the cost of health.',
  },
  overpower: {
    id: 'overpower', name: 'Overpower', class: 'warrior', learnLevel: 10,
    cost: 5, castTime: 0, cooldown: 5, range: 0, school: 'physical',
    requiresTarget: true, requiresDodgeProc: true,
    effects: [{ type: 'weaponStrike', bonus: 5, cannotBeDodged: true }],
    ranks: [{ rank: 2, level: 16, cost: 5, effects: [{ type: 'weaponStrike', bonus: 15, cannotBeDodged: true }] }],
    description: 'Instant attack for weapon damage +5. Only usable after the target dodges. Cannot be dodged.',
  },
  execute: {
    id: 'execute', name: 'Execute', class: 'warrior', learnLevel: 14,
    cost: 15, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, requiresTargetHpBelow: 0.2,
    effects: [{ type: 'directDamage', min: 60, max: 75 }],
    description: 'Attempt to finish off a wounded foe, causing $d damage. Only usable on enemies below 20% health.',
  },
  slam: {
    id: 'slam', name: 'Slam', class: 'warrior', learnLevel: 16,
    cost: 15, castTime: 1.5, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'weaponStrike', bonus: 25 }],
    description: 'Slams the opponent for weapon damage plus $d.',
  },
  cleave: {
    id: 'cleave', name: 'Cleave', class: 'warrior', learnLevel: 18,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false,
    threat: { flat: 30 }, // classic 100 at rank 5/level 58, scaled to the 1-20 band
    effects: [{ type: 'aoeDamage', min: 20, max: 26, radius: 5 }],
    description: 'A sweeping strike that hits all enemies in front of you for $d damage.',
  },
  defensive_stance: {
    id: 'defensive_stance', name: 'Defensive Stance', class: 'warrior', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 1, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'defensive_stance', value: 0.9, duration: 3600 }],
    description: 'A defensive combat stance: you generate 30% more threat but deal and take 10% less damage. Cast again to leave the stance.',
  },
  sunder_armor: {
    id: 'sunder_armor', name: 'Sunder Armor', class: 'warrior', learnLevel: 10,
    cost: 15, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true,
    threat: { flat: 100 }, // classic rank-1 value (260 by rank 5 at 58)
    effects: [{ type: 'sunder', armor: 25, maxStacks: 5 }],
    ranks: [
      { rank: 2, level: 16, cost: 15, threatFlat: 130, effects: [{ type: 'sunder', armor: 40, maxStacks: 5 }] },
    ],
    description: 'Sunders the target\'s armor, reducing it by $d per application. Stacks up to 5 times. Generates a high amount of threat.',
  },
  taunt: {
    id: 'taunt', name: 'Taunt', class: 'warrior', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 10, range: 8, school: 'physical',
    requiresTarget: true, offGcd: true,
    effects: [{ type: 'taunt' }],
    description: 'Taunts the target: your threat rises to match its most hated enemy and it is compelled to attack you for 3 sec.',
  },

  // ====================== MAGE ======================
  fireball: {
    id: 'fireball', name: 'Fireball', class: 'mage', learnLevel: 1,
    cost: 30, castTime: 1.5, cooldown: 0, range: 30, school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 16, max: 25 }, { type: 'dot', total: 2, duration: 4, interval: 2 }],
    ranks: [{
      rank: 2, level: 6, cost: 45, castTime: 2.0,
      effects: [{ type: 'directDamage', min: 22, max: 31 }, { type: 'dot', total: 3, duration: 6, interval: 2 }],
    }, {
      rank: 3, level: 12, cost: 65, castTime: 2.5,
      effects: [{ type: 'directDamage', min: 36, max: 48 }, { type: 'dot', total: 6, duration: 6, interval: 2 }],
    }, {
      rank: 4, level: 18, cost: 95, castTime: 3.0,
      effects: [{ type: 'directDamage', min: 58, max: 78 }, { type: 'dot', total: 12, duration: 8, interval: 2 }],
    }],
    description: 'Hurls a fiery ball that causes $d Fire damage plus additional damage over time.',
  },
  frost_armor: {
    id: 'frost_armor', name: 'Frost Armor', class: 'mage', learnLevel: 1,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 30, duration: 1800 }],
    ranks: [
      { rank: 2, level: 10, cost: 30, effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 50, duration: 1800 }] },
      { rank: 3, level: 18, cost: 45, effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 70, duration: 1800 }] },
    ],
    description: 'Encases you in frost, increasing armor by 30 for 30 min.',
  },
  arcane_intellect: {
    id: 'arcane_intellect', name: 'Arcane Intellect', class: 'mage', learnLevel: 1,
    cost: 25, castTime: 0, cooldown: 0, range: 0, school: 'arcane',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_int', value: 2, duration: 1800 }],
    ranks: [{ rank: 2, level: 14, cost: 60, effects: [{ type: 'selfBuff', kind: 'buff_int', value: 7, duration: 1800 }] }],
    description: 'Increases Intellect by 2 for 30 min.',
  },
  frostbolt: {
    id: 'frostbolt', name: 'Frostbolt', class: 'mage', learnLevel: 4,
    cost: 25, castTime: 1.5, cooldown: 0, range: 30, school: 'frost',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 18, max: 20 }, { type: 'slow', mult: 0.6, duration: 5 }],
    ranks: [{
      rank: 2, level: 8, cost: 35, castTime: 2.0,
      effects: [{ type: 'directDamage', min: 31, max: 35 }, { type: 'slow', mult: 0.6, duration: 6 }],
    }, {
      rank: 3, level: 14, cost: 50, castTime: 2.5,
      effects: [{ type: 'directDamage', min: 44, max: 50 }, { type: 'slow', mult: 0.6, duration: 7 }],
    }, {
      rank: 4, level: 20, cost: 70, castTime: 2.5,
      effects: [{ type: 'directDamage', min: 66, max: 74 }, { type: 'slow', mult: 0.6, duration: 9 }],
    }],
    description: 'Launches a bolt of frost, causing $d Frost damage and slowing movement by 40%.',
  },
  conjure_water: {
    id: 'conjure_water', name: 'Conjure Water', class: 'mage', learnLevel: 4,
    cost: 40, castTime: 3, cooldown: 0, range: 0, school: 'arcane',
    requiresTarget: false,
    effects: [], // special-cased: creates conjured_water{rank} in bags
    ranks: [
      { rank: 2, level: 10, cost: 70, effects: [] },
      { rank: 3, level: 16, cost: 110, effects: [] },
    ],
    description: 'Conjures 2 bottles of water, restoring mana when drunk. Higher ranks conjure purer water.',
  },
  conjure_food: {
    id: 'conjure_food', name: 'Conjure Food', class: 'mage', learnLevel: 6,
    cost: 45, castTime: 3, cooldown: 0, range: 0, school: 'arcane',
    requiresTarget: false,
    effects: [], // special-cased: creates conjured_bread{rank} in bags
    ranks: [
      { rank: 2, level: 12, cost: 75, effects: [] },
      { rank: 3, level: 18, cost: 115, effects: [] },
    ],
    description: 'Conjures 2 servings of bread, restoring health when eaten. Higher ranks conjure heartier fare.',
  },
  fire_blast: {
    id: 'fire_blast', name: 'Fire Blast', class: 'mage', learnLevel: 6,
    cost: 40, castTime: 0, cooldown: 8, range: 20, school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 27, max: 35 }],
    ranks: [
      { rank: 2, level: 12, cost: 60, effects: [{ type: 'directDamage', min: 44, max: 54 }] },
      { rank: 3, level: 18, cost: 85, effects: [{ type: 'directDamage', min: 68, max: 82 }] },
    ],
    description: 'Blasts the enemy for $d Fire damage. Instant.',
  },
  arcane_missiles: {
    id: 'arcane_missiles', name: 'Arcane Missiles', class: 'mage', learnLevel: 8,
    cost: 50, castTime: 0, channel: { duration: 3, ticks: 3 }, cooldown: 0, range: 30, school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 8, max: 8 }], // per missile
    ranks: [
      { rank: 2, level: 14, cost: 75, effects: [{ type: 'directDamage', min: 14, max: 14 }] },
      { rank: 3, level: 20, cost: 105, effects: [{ type: 'directDamage', min: 22, max: 22 }] },
    ],
    description: 'Launches Arcane Missiles at the enemy, causing 8 Arcane damage each second for 3 sec.',
  },
  polymorph: {
    id: 'polymorph', name: 'Polymorph', class: 'mage', learnLevel: 8,
    cost: 50, castTime: 1.5, cooldown: 0, range: 30, school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'polymorph', duration: 15 }],
    ranks: [{ rank: 2, level: 18, cost: 70, effects: [{ type: 'polymorph', duration: 20 }] }],
    description: 'Transforms the enemy into a sheep for up to 15 sec. The sheep wanders and heals rapidly. Any damage breaks the effect. Beasts and humanoids only.',
  },
  frost_nova: {
    id: 'frost_nova', name: 'Frost Nova', class: 'mage', learnLevel: 10,
    cost: 35, castTime: 0, cooldown: 22, range: 0, school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'aoeRoot', duration: 8, radius: 10, min: 6, max: 7 }],
    ranks: [{ rank: 2, level: 16, cost: 50, effects: [{ type: 'aoeRoot', duration: 8, radius: 10, min: 12, max: 14 }] }],
    description: 'Freezes all nearby enemies in place for up to 8 sec, dealing $d Frost damage.',
  },
  arcane_explosion: {
    id: 'arcane_explosion', name: 'Arcane Explosion', class: 'mage', learnLevel: 14,
    cost: 60, castTime: 0, cooldown: 0, range: 0, school: 'arcane',
    requiresTarget: false,
    effects: [{ type: 'aoeDamage', min: 26, max: 31, radius: 10 }],
    description: 'A burst of Arcane energy hits all nearby enemies for $d Arcane damage.',
  },
  scorch: {
    id: 'scorch', name: 'Scorch', class: 'mage', learnLevel: 16,
    cost: 35, castTime: 1.5, cooldown: 0, range: 30, school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 32, max: 40 }],
    description: 'Scorches the enemy for $d Fire damage. Quick to cast.',
  },
  pyroblast: {
    id: 'pyroblast', name: 'Pyroblast', class: 'mage', learnLevel: 20,
    cost: 125, castTime: 6.0, cooldown: 0, range: 30, school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 75, max: 100 }, { type: 'dot', total: 24, duration: 12, interval: 2 }],
    description: 'Hurls an immense fiery boulder that causes $d Fire damage plus additional damage over time.',
  },
  ice_barrier: {
    id: 'ice_barrier', name: 'Ice Barrier', class: 'mage', learnLevel: 20,
    cost: 90, castTime: 0, cooldown: 30, range: 0, school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'absorb', amount: 130, duration: 60 }],
    description: 'Shields you in ice, absorbing 130 damage for 60 sec.',
  },

  // ====================== ROGUE ======================
  sinister_strike: {
    id: 'sinister_strike', name: 'Sinister Strike', class: 'rogue', learnLevel: 1,
    cost: 45, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, awardsCombo: 1,
    effects: [{ type: 'weaponStrike', bonus: 3 }],
    ranks: [
      { rank: 2, level: 8, cost: 45, effects: [{ type: 'weaponStrike', bonus: 6 }] },
      { rank: 3, level: 14, cost: 45, effects: [{ type: 'weaponStrike', bonus: 12 }] },
      { rank: 4, level: 20, cost: 45, effects: [{ type: 'weaponStrike', bonus: 18 }] },
    ],
    description: 'An instant strike for weapon damage plus $d. Awards 1 combo point.',
  },
  eviscerate: {
    id: 'eviscerate', name: 'Eviscerate', class: 'rogue', learnLevel: 1,
    cost: 35, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, spendsCombo: true,
    effects: [{ type: 'finisherDamage', base: 4, perCombo: 7, variance: 4 }],
    ranks: [
      { rank: 2, level: 12, cost: 35, effects: [{ type: 'finisherDamage', base: 8, perCombo: 12, variance: 6 }] },
      { rank: 3, level: 18, cost: 35, effects: [{ type: 'finisherDamage', base: 14, perCombo: 18, variance: 9 }] },
    ],
    description: 'Finishing move that causes damage per combo point.',
  },
  backstab: {
    id: 'backstab', name: 'Backstab', class: 'rogue', learnLevel: 4,
    cost: 60, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, awardsCombo: 1,
    effects: [{ type: 'weaponStrike', bonus: 11, requiresBehind: true, weaponMult: 1.5 }],
    ranks: [
      { rank: 2, level: 12, cost: 60, effects: [{ type: 'weaponStrike', bonus: 20, requiresBehind: true, weaponMult: 1.5 }] },
      { rank: 3, level: 18, cost: 60, effects: [{ type: 'weaponStrike', bonus: 32, requiresBehind: true, weaponMult: 1.5 }] },
    ],
    description: 'Backstab the target for 150% weapon damage plus $d. Must be behind the target. Requires a dagger. Awards 1 combo point.',
  },
  gouge: {
    id: 'gouge', name: 'Gouge', class: 'rogue', learnLevel: 6,
    cost: 45, castTime: 0, cooldown: 10, range: 0, school: 'physical',
    requiresTarget: true, awardsCombo: 1,
    effects: [{ type: 'directDamage', min: 8, max: 9 }, { type: 'incapacitate', duration: 4 }],
    ranks: [{
      rank: 2, level: 14, cost: 45,
      effects: [{ type: 'directDamage', min: 15, max: 17 }, { type: 'incapacitate', duration: 4 }],
    }],
    description: 'Strikes the target, incapacitating it for 4 sec. Any damage breaks the effect. Awards 1 combo point.',
  },
  evasion: {
    id: 'evasion', name: 'Evasion', class: 'rogue', learnLevel: 8,
    cost: 0, castTime: 0, cooldown: 300, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_dodge', value: 0.5, duration: 15 }],
    description: 'Increases your dodge chance by 50% for 15 sec.',
  },
  slice_and_dice: {
    id: 'slice_and_dice', name: 'Slice and Dice', class: 'rogue', learnLevel: 10,
    cost: 25, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, spendsCombo: true,
    effects: [{ type: 'finisherHaste', mult: 1.3, basedur: 9, perCombo: 3 }],
    description: 'Finishing move that increases melee attack speed by 30%. Lasts longer per combo point.',
  },
  sprint: {
    id: 'sprint', name: 'Sprint', class: 'rogue', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 300, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.7, duration: 15 }],
    description: 'Increases your movement speed by 70% for 15 sec.',
  },
  kidney_shot: {
    id: 'kidney_shot', name: 'Kidney Shot', class: 'rogue', learnLevel: 14,
    cost: 25, castTime: 0, cooldown: 20, range: 0, school: 'physical',
    requiresTarget: true, spendsCombo: true,
    effects: [{ type: 'finisherStun', base: 1, perCombo: 1 }],
    description: 'Finishing move that stuns the target. Lasts 1 sec longer per combo point.',
  },
  ambush: {
    id: 'ambush', name: 'Ambush', class: 'rogue', learnLevel: 16,
    cost: 60, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, awardsCombo: 1, requiresStealth: true,
    effects: [{ type: 'weaponStrike', bonus: 28, requiresBehind: true, weaponMult: 2.5 }],
    description: 'Ambush the target for 250% weapon damage plus $d. Must be stealthed and behind the target. Requires a dagger. Awards 1 combo point.',
  },
  stealth: {
    id: 'stealth', name: 'Stealth', class: 'rogue', learnLevel: 2,
    cost: 0, castTime: 0, cooldown: 10, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true, requiresOutOfCombat: true,
    effects: [{ type: 'selfBuff', kind: 'stealth', value: 0.7, duration: 3600 }],
    description: 'Conceals you in the shadows: enemies barely notice you, but you move 30% slower. Attacking or taking damage breaks Stealth. Cast again to step out.',
  },
  adrenaline_rush: {
    id: 'adrenaline_rush', name: 'Adrenaline Rush', class: 'rogue', learnLevel: 20,
    cost: 0, castTime: 0, cooldown: 180, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'gainResource', amount: 60 }],
    description: 'Your blood runs hot, instantly restoring 60 energy.',
  },
  garrote: {
    id: 'garrote', name: 'Garrote', class: 'rogue', learnLevel: 1,
    cost: 50, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, awardsCombo: 1, requiresStealth: true,
    effects: [{ type: 'directDamage', min: 5, max: 7 }, { type: 'dot', total: 60, duration: 18, interval: 3 }],
    ranks: [{
      rank: 2, level: 14, cost: 50,
      effects: [{ type: 'directDamage', min: 9, max: 12 }, { type: 'dot', total: 132, duration: 18, interval: 3 }],
    }],
    description: 'Garrote the enemy, causing damage now and bleeding it for $d over 18 sec. Must be stealthed. Awards 1 combo point.',
  },
  cheap_shot: {
    id: 'cheap_shot', name: 'Cheap Shot', class: 'rogue', learnLevel: 8,
    cost: 60, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, awardsCombo: 2, requiresStealth: true,
    effects: [{ type: 'directDamage', min: 6, max: 8 }, { type: 'stun', duration: 4 }],
    description: 'Strike the target, stunning it for 4 sec. Must be stealthed. Awards 2 combo points.',
  },
  sap: {
    id: 'sap', name: 'Sap', class: 'rogue', learnLevel: 10,
    cost: 65, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, requiresStealth: true, requiresOutOfCombat: true,
    effects: [{ type: 'incapacitate', duration: 8 }],
    description: 'Incapacitates the target for 8 sec. Must be stealthed and out of combat. Any damage breaks the effect.',
  },
  crippling_poison: {
    id: 'crippling_poison', name: 'Crippling Poison', class: 'rogue', learnLevel: 12,
    cost: 40, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 3, max: 5 }, { type: 'slow', mult: 0.5, duration: 12 }],
    description: 'Strikes the target with a crippling poison, dealing {damage} Nature damage and slowing its movement speed by 50% for 12 sec.',
  },
  expose_armor: {
    id: 'expose_armor', name: 'Expose Armor', class: 'rogue', learnLevel: 14,
    cost: 25, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, spendsCombo: true,
    effects: [{ type: 'sunder', armor: 170, maxStacks: 1 }],
    description: "Finishing move that exposes the target, reducing its armor. More combo points spent build into a deeper cut.",
  },
  rupture: {
    id: 'rupture', name: 'Rupture', class: 'rogue', learnLevel: 16,
    cost: 25, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, spendsCombo: true,
    effects: [{ type: 'dot', total: 96, duration: 16, interval: 2 }],
    description: 'Finishing move that wounds the target, causing it to bleed for $d over 16 sec.',
  },
  vanish: {
    id: 'vanish', name: 'Vanish', class: 'rogue', learnLevel: 18,
    cost: 0, castTime: 0, cooldown: 300, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'stealth', value: 0.7, duration: 10 }],
    description: 'Vanish from sight, entering Stealth even in combat. You move 30% slower while hidden. Lasts up to 10 sec.',
  },
  instant_poison: {
    id: 'instant_poison', name: 'Instant Poison', class: 'rogue', learnLevel: 18,
    cost: 40, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 8, duration: 1800 }],
    description: 'Coats your weapon for 30 min, causing each of your melee swings to deal 8 additional Nature damage.',
  },
  deadly_poison: {
    id: 'deadly_poison', name: 'Deadly Poison', class: 'rogue', learnLevel: 20,
    cost: 40, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 14, duration: 1800 }],
    description: 'Coats your weapon for 30 min, causing each of your melee swings to deal 14 additional Nature damage.',
  },
  blind: {
    id: 'blind', name: 'Blind', class: 'rogue', learnLevel: 20,
    cost: 50, castTime: 0, cooldown: 120, range: 5, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'incapacitate', duration: 8 }],
    description: 'Blinds the target, causing it to wander disoriented for 8 sec. Any damage breaks the effect.',
  },

  // ====================== PALADIN ======================
  seal_of_righteousness: {
    id: 'seal_of_righteousness', name: 'Seal of Righteousness', class: 'paladin', learnLevel: 1,
    cost: 25, castTime: 0, cooldown: 0, range: 0, school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 4, duration: 30, judgeMin: 10, judgeMax: 18 }],
    ranks: [
      { rank: 2, level: 10, cost: 35, effects: [{ type: 'imbue', bonus: 7, duration: 30, judgeMin: 18, judgeMax: 28 }] },
      { rank: 3, level: 16, cost: 50, effects: [{ type: 'imbue', bonus: 11, duration: 30, judgeMin: 30, judgeMax: 44 }] },
    ],
    description: 'Fills you with Holy power for 30 sec, causing each of your melee swings to deal 4 additional Holy damage. Unleash with Judgement.',
  },
  holy_light: {
    id: 'holy_light', name: 'Holy Light', class: 'paladin', learnLevel: 1,
    cost: 35, castTime: 2.5, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 42, max: 51 }],
    ranks: [
      { rank: 2, level: 8, cost: 60, effects: [{ type: 'heal', min: 76, max: 90 }] },
      { rank: 3, level: 14, cost: 95, effects: [{ type: 'heal', min: 122, max: 144 }] },
      { rank: 4, level: 20, cost: 140, effects: [{ type: 'heal', min: 190, max: 222 }] },
    ],
    description: 'Heals a friendly target for $d.',
  },
  devotion_aura: {
    id: 'devotion_aura', name: 'Devotion Aura', class: 'paladin', learnLevel: 1,
    cost: 0, castTime: 0, cooldown: 0, range: 0, school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 40, duration: 1800 }],
    ranks: [
      { rank: 2, level: 12, cost: 0, effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 75, duration: 1800 }] },
      { rank: 3, level: 18, cost: 0, effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 110, duration: 1800 }] },
    ],
    description: 'Increases your armor by 40 for 30 min.',
  },
  judgement: {
    id: 'judgement', name: 'Judgement', class: 'paladin', learnLevel: 4,
    cost: 30, castTime: 0, cooldown: 10, range: 10, school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'judgement' }],
    description: 'Unleashes your active Seal upon the enemy, consuming it to deal its judgement damage.',
  },
  blessing_of_might: {
    id: 'blessing_of_might', name: 'Blessing of Might', class: 'paladin', learnLevel: 4,
    cost: 25, castTime: 0, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'buffTarget', kind: 'buff_ap', value: 15, duration: 300 }],
    ranks: [
      { rank: 2, level: 12, cost: 40, effects: [{ type: 'buffTarget', kind: 'buff_ap', value: 30, duration: 300 }] },
      { rank: 3, level: 20, cost: 60, effects: [{ type: 'buffTarget', kind: 'buff_ap', value: 45, duration: 300 }] },
    ],
    description: 'Places a Blessing on a friendly target, increasing attack power by 15 for 5 min.',
  },
  divine_protection: {
    id: 'divine_protection', name: 'Divine Protection', class: 'paladin', learnLevel: 6,
    cost: 15, castTime: 0, cooldown: 180, range: 0, school: 'holy',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'absorb', amount: 50, duration: 10 }],
    ranks: [{ rank: 2, level: 14, cost: 25, effects: [{ type: 'absorb', amount: 110, duration: 10 }] }],
    description: 'A holy shield absorbs 50 damage for 10 sec.',
  },
  hammer_of_justice: {
    id: 'hammer_of_justice', name: 'Hammer of Justice', class: 'paladin', learnLevel: 8,
    cost: 30, castTime: 0, cooldown: 60, range: 10, school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'stun', duration: 3 }],
    ranks: [{ rank: 2, level: 16, cost: 45, effects: [{ type: 'stun', duration: 4 }] }],
    description: 'Stuns the target for 3 sec.',
  },
  lay_on_hands: {
    id: 'lay_on_hands', name: 'Lay on Hands', class: 'paladin', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 600, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 250, max: 250 }],
    ranks: [{ rank: 2, level: 18, cost: 0, effects: [{ type: 'heal', min: 600, max: 600 }] }],
    description: 'A massive surge of healing: restores 250 health. 10 min cooldown.',
  },
  flash_of_light: {
    id: 'flash_of_light', name: 'Flash of Light', class: 'paladin', learnLevel: 12,
    cost: 35, castTime: 1.5, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 62, max: 76 }],
    description: 'A quick, efficient flash of Light that heals a friendly target for $d.',
  },
  exorcism: {
    id: 'exorcism', name: 'Exorcism', class: 'paladin', learnLevel: 14,
    cost: 55, castTime: 0, cooldown: 15, range: 30, school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 46, max: 56 }],
    description: 'Banishes the wicked with Holy wrath, causing $d Holy damage.',
  },
  consecration: {
    id: 'consecration', name: 'Consecration', class: 'paladin', learnLevel: 18,
    cost: 60, castTime: 0, cooldown: 8, range: 0, school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'groundAoE', min: 28, max: 34, radius: 8, duration: 10, interval: 2 }],
    description: 'Consecrates the ground beneath you, searing nearby enemies for $d Holy damage.',
  },
  righteous_fury: {
    id: 'righteous_fury', name: 'Righteous Fury', class: 'paladin', learnLevel: 16,
    cost: 30, castTime: 0, cooldown: 0, range: 0, school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'righteous_fury', value: 1.6, duration: 1800 }],
    description: 'Increases the threat generated by your Holy damage by 60% for 30 min. The tanking paladin\'s cornerstone.',
  },
  retribution_aura: {
    id: 'retribution_aura', name: 'Retribution Aura', class: 'paladin', learnLevel: 16,
    cost: 0, castTime: 0, cooldown: 0, range: 0, school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'thorns', value: 5, duration: 1800 }],
    description: 'Surrounds you with holy energy for 30 min, dealing 5 Holy damage to any enemy that strikes you in melee.',
  },

  // ====================== HUNTER ======================
  tame_beast: {
    id: 'tame_beast', name: 'Tame Beast', class: 'hunter', learnLevel: 10,
    cost: 0, castTime: 6, cooldown: 0, range: 20, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'tamePet' }],
    description: 'Begins taming a beast to be your companion. It must be your level or lower and not an elite. Your pet follows you, attacks your enemies, and holds threat of its own. You may have one pet at a time.',
  },
  dismiss_pet: {
    id: 'dismiss_pet', name: 'Dismiss Pet', class: 'hunter', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'dismissPet' }],
    description: 'Releases your pet back to the wild.',
  },
  revive_pet: {
    id: 'revive_pet', name: 'Revive Pet', class: 'hunter', learnLevel: 10,
    cost: 45, castTime: 3, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [],
    description: 'Revives your dead pet and returns it to your side.',
  },
  raptor_strike: {
    id: 'raptor_strike', name: 'Raptor Strike', class: 'hunter', learnLevel: 1,
    cost: 15, castTime: 0, cooldown: 6, range: 0, school: 'physical',
    requiresTarget: true, onNextSwing: true, offGcd: true,
    effects: [{ type: 'weaponDamage', bonus: 5 }],
    ranks: [
      { rank: 2, level: 8, cost: 25, effects: [{ type: 'weaponDamage', bonus: 11 }] },
      { rank: 3, level: 14, cost: 35, effects: [{ type: 'weaponDamage', bonus: 18 }] },
      { rank: 4, level: 20, cost: 45, effects: [{ type: 'weaponDamage', bonus: 27 }] },
    ],
    description: 'A strong melee attack that increases damage by 5. Activates on your next swing.',
  },
  aspect_of_the_hawk: {
    id: 'aspect_of_the_hawk', name: 'Aspect of the Hawk', class: 'hunter', learnLevel: 4,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 20, duration: 1800 }],
    ranks: [
      { rank: 2, level: 12, cost: 30, effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 35, duration: 1800 }] },
      { rank: 3, level: 18, cost: 40, effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 50, duration: 1800 }] },
    ],
    description: 'Take on the aspect of the hawk, increasing attack power by 20 for 30 min.',
  },
  serpent_sting: {
    id: 'serpent_sting', name: 'Serpent Sting', class: 'hunter', learnLevel: 4,
    cost: 15, castTime: 0, cooldown: 0, range: 35, minRange: 8, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 20, duration: 15, interval: 3 }],
    ranks: [
      { rank: 2, level: 10, cost: 25, effects: [{ type: 'dot', total: 35, duration: 15, interval: 3 }] },
      { rank: 3, level: 16, cost: 35, effects: [{ type: 'dot', total: 55, duration: 15, interval: 3 }] },
    ],
    description: 'Stings the target, dealing $d Nature damage over 15 sec.',
  },
  arcane_shot: {
    id: 'arcane_shot', name: 'Arcane Shot', class: 'hunter', learnLevel: 6,
    cost: 25, castTime: 0, cooldown: 6, range: 35, minRange: 8, school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 13, max: 17 }],
    ranks: [
      { rank: 2, level: 12, cost: 40, effects: [{ type: 'directDamage', min: 24, max: 30 }] },
      { rank: 3, level: 18, cost: 55, effects: [{ type: 'directDamage', min: 38, max: 47 }] },
    ],
    description: 'An instant shot that deals $d Arcane damage.',
  },
  concussive_shot: {
    id: 'concussive_shot', name: 'Concussive Shot', class: 'hunter', learnLevel: 8,
    cost: 20, castTime: 0, cooldown: 12, range: 35, minRange: 8, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 4, max: 6 }, { type: 'slow', mult: 0.5, duration: 4 }],
    description: 'Dazes the target, slowing movement by 50% for 4 sec.',
  },
  mongoose_bite: {
    id: 'mongoose_bite', name: 'Mongoose Bite', class: 'hunter', learnLevel: 10,
    cost: 10, castTime: 0, cooldown: 5, range: 0, school: 'physical',
    requiresTarget: true, requiresDodgeProc: true,
    effects: [{ type: 'weaponStrike', bonus: 12, cannotBeDodged: true }],
    ranks: [{ rank: 2, level: 16, cost: 10, effects: [{ type: 'weaponStrike', bonus: 24, cannotBeDodged: true }] }],
    description: 'Counterattack after the target dodges for weapon damage plus 12. Cannot be dodged.',
  },
  wing_clip: {
    id: 'wing_clip', name: 'Wing Clip', class: 'hunter', learnLevel: 10,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 3, max: 5 }, { type: 'slow', mult: 0.6, duration: 10 }],
    description: 'Inflicts a wound that slows the enemy by 40% for 10 sec.',
  },
  aspect_of_the_monkey: {
    id: 'aspect_of_the_monkey', name: 'Aspect of the Monkey', class: 'hunter', learnLevel: 10,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_dodge', value: 0.08, duration: 1800 }],
    description: 'Take on the aspect of the monkey, increasing your dodge chance by 8% for 30 min.',
  },
  aspect_of_the_cheetah: {
    id: 'aspect_of_the_cheetah', name: 'Aspect of the Cheetah', class: 'hunter', learnLevel: 14,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.3, duration: 1800 }],
    description: 'Take on the aspect of the cheetah, increasing movement speed by 30% for 30 min.',
  },
  aimed_shot: {
    id: 'aimed_shot', name: 'Aimed Shot', class: 'hunter', learnLevel: 16,
    cost: 50, castTime: 3.0, cooldown: 6, range: 35, minRange: 8, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 50, max: 62 }],
    description: 'A carefully aimed shot that deals $d damage.',
  },
  rapid_fire: {
    id: 'rapid_fire', name: 'Rapid Fire', class: 'hunter', learnLevel: 20,
    cost: 0, castTime: 0, cooldown: 300, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_haste', value: 1.4, duration: 15 }],
    description: 'Increases your attack speed by 40% for 15 sec.',
  },

  // ====================== PRIEST ======================
  smite: {
    id: 'smite', name: 'Smite', class: 'priest', learnLevel: 1,
    cost: 20, castTime: 2.0, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 15, max: 20 }],
    ranks: [
      { rank: 2, level: 8, cost: 32, effects: [{ type: 'directDamage', min: 26, max: 33 }] },
      { rank: 3, level: 14, cost: 48, castTime: 2.5, effects: [{ type: 'directDamage', min: 42, max: 52 }] },
      { rank: 4, level: 20, cost: 70, castTime: 2.5, effects: [{ type: 'directDamage', min: 64, max: 78 }] },
    ],
    description: 'Smites the enemy for $d Holy damage.',
  },
  lesser_heal: {
    id: 'lesser_heal', name: 'Lesser Heal', class: 'priest', learnLevel: 1,
    cost: 30, castTime: 2.0, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 47, max: 58 }],
    ranks: [
      { rank: 2, level: 6, cost: 45, effects: [{ type: 'heal', min: 72, max: 86 }] },
      { rank: 3, level: 12, cost: 65, effects: [{ type: 'heal', min: 110, max: 132 }] },
    ],
    description: 'Heals a friendly target for $d.',
  },
  power_word_fortitude: {
    id: 'power_word_fortitude', name: 'Power Word: Fortitude', class: 'priest', learnLevel: 1,
    cost: 30, castTime: 0, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'buffTarget', kind: 'buff_sta', value: 3, duration: 1800 }],
    ranks: [
      { rank: 2, level: 12, cost: 55, effects: [{ type: 'buffTarget', kind: 'buff_sta', value: 7, duration: 1800 }] },
      { rank: 3, level: 20, cost: 80, effects: [{ type: 'buffTarget', kind: 'buff_sta', value: 12, duration: 1800 }] },
    ],
    description: 'Increases the target\'s Stamina by 3 for 30 min.',
  },
  shadow_word_pain: {
    id: 'shadow_word_pain', name: 'Shadow Word: Pain', class: 'priest', learnLevel: 4,
    cost: 25, castTime: 0, cooldown: 0, range: 30, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 30, duration: 18, interval: 3 }],
    ranks: [
      { rank: 2, level: 10, cost: 38, effects: [{ type: 'dot', total: 54, duration: 18, interval: 3 }] },
      { rank: 3, level: 16, cost: 55, effects: [{ type: 'dot', total: 84, duration: 18, interval: 3 }] },
    ],
    description: 'A word of darkness causes $d Shadow damage over 18 sec.',
  },
  power_word_shield: {
    id: 'power_word_shield', name: 'Power Word: Shield', class: 'priest', learnLevel: 6,
    cost: 45, castTime: 0, cooldown: 6, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'absorb', amount: 48, duration: 30 }],
    ranks: [
      { rank: 2, level: 12, cost: 70, effects: [{ type: 'absorb', amount: 90, duration: 30 }] },
      { rank: 3, level: 18, cost: 100, effects: [{ type: 'absorb', amount: 145, duration: 30 }] },
    ],
    description: 'Shields the target, absorbing 48 damage for 30 sec.',
  },
  renew: {
    id: 'renew', name: 'Renew', class: 'priest', learnLevel: 8,
    cost: 30, castTime: 0, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'hot', total: 45, duration: 15, interval: 3 }],
    ranks: [
      { rank: 2, level: 14, cost: 50, effects: [{ type: 'hot', total: 90, duration: 15, interval: 3 }] },
      { rank: 3, level: 20, cost: 75, effects: [{ type: 'hot', total: 140, duration: 15, interval: 3 }] },
    ],
    description: 'Heals the target for $d over 15 sec.',
  },
  mind_blast: {
    id: 'mind_blast', name: 'Mind Blast', class: 'priest', learnLevel: 10,
    cost: 50, castTime: 1.5, cooldown: 8, range: 30, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 42, max: 46 }],
    ranks: [
      { rank: 2, level: 14, cost: 70, effects: [{ type: 'directDamage', min: 60, max: 66 }] },
      { rank: 3, level: 20, cost: 95, effects: [{ type: 'directDamage', min: 86, max: 94 }] },
    ],
    description: 'Blasts the target\'s mind for $d Shadow damage.',
  },
  heal: {
    id: 'heal', name: 'Heal', class: 'priest', learnLevel: 14,
    cost: 95, castTime: 2.5, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 165, max: 195 }],
    ranks: [{ rank: 2, level: 20, cost: 130, effects: [{ type: 'heal', min: 230, max: 270 }] }],
    description: 'A slow but powerful prayer that heals a friendly target for $d.',
  },
  mind_flay: {
    id: 'mind_flay', name: 'Mind Flay', class: 'priest', learnLevel: 16,
    cost: 45, castTime: 0, channel: { duration: 3, ticks: 3 }, cooldown: 0, range: 20, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'drainTick', min: 12, max: 12, healFrac: 0 }],
    description: 'Assaults the target\'s mind with Shadow energy, causing 12 damage each second for 3 sec.',
  },
  flash_heal: {
    id: 'flash_heal', name: 'Flash Heal', class: 'priest', learnLevel: 20,
    cost: 75, castTime: 1.5, cooldown: 0, range: 30, school: 'holy',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 120, max: 142 }],
    description: 'A fast prayer that heals a friendly target for $d.',
  },

  // ====================== SHAMAN ======================
  lightning_bolt: {
    id: 'lightning_bolt', name: 'Lightning Bolt', class: 'shaman', learnLevel: 1,
    cost: 15, castTime: 1.5, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 15, max: 17 }],
    ranks: [
      { rank: 2, level: 8, cost: 25, castTime: 2.0, effects: [{ type: 'directDamage', min: 26, max: 30 }] },
      { rank: 3, level: 14, cost: 40, castTime: 2.5, effects: [{ type: 'directDamage', min: 45, max: 51 }] },
      { rank: 4, level: 20, cost: 60, castTime: 3.0, effects: [{ type: 'directDamage', min: 75, max: 85 }] },
    ],
    description: 'Hurls a bolt of lightning for $d Nature damage.',
  },
  rockbiter_weapon: {
    id: 'rockbiter_weapon', name: 'Rockbiter Weapon', class: 'shaman', learnLevel: 1,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 5, duration: 300 }],
    ranks: [
      { rank: 2, level: 8, cost: 30, effects: [{ type: 'imbue', bonus: 9, duration: 300 }] },
      { rank: 3, level: 16, cost: 45, effects: [{ type: 'imbue', bonus: 14, duration: 300 }] },
    ],
    description: 'Imbues your weapon with the fury of stone: each swing deals 5 additional damage for 5 min.',
  },
  healing_wave: {
    id: 'healing_wave', name: 'Healing Wave', class: 'shaman', learnLevel: 1,
    cost: 25, castTime: 1.5, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 36, max: 44 }],
    ranks: [
      { rank: 2, level: 6, cost: 40, castTime: 2.0, effects: [{ type: 'heal', min: 56, max: 68 }] },
      { rank: 3, level: 12, cost: 65, castTime: 2.5, effects: [{ type: 'heal', min: 92, max: 110 }] },
      { rank: 4, level: 18, cost: 90, castTime: 2.5, effects: [{ type: 'heal', min: 138, max: 164 }] },
    ],
    description: 'Heals a friendly target for $d.',
  },
  earth_shock: {
    id: 'earth_shock', name: 'Earth Shock', class: 'shaman', learnLevel: 4,
    cost: 30, castTime: 0, cooldown: 6, range: 20, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 19, max: 22 }],
    ranks: [
      { rank: 2, level: 10, cost: 45, effects: [{ type: 'directDamage', min: 33, max: 38 }] },
      { rank: 3, level: 16, cost: 65, effects: [{ type: 'directDamage', min: 54, max: 61 }] },
    ],
    description: 'Instantly shocks the target with concussive force for $d Nature damage.',
  },
  lightning_shield: {
    id: 'lightning_shield', name: 'Lightning Shield', class: 'shaman', learnLevel: 8,
    cost: 25, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'thorns', value: 13, duration: 600 }],
    ranks: [
      { rank: 2, level: 12, cost: 40, effects: [{ type: 'selfBuff', kind: 'thorns', value: 20, duration: 600 }] },
      { rank: 3, level: 18, cost: 55, effects: [{ type: 'selfBuff', kind: 'thorns', value: 29, duration: 600 }] },
    ],
    description: 'Surrounds you with crackling lightning: melee attackers take 13 Nature damage.',
  },
  flame_shock: {
    id: 'flame_shock', name: 'Flame Shock', class: 'shaman', learnLevel: 10,
    cost: 35, castTime: 0, cooldown: 6, range: 20, school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 25, max: 25 }, { type: 'dot', total: 28, duration: 12, interval: 3 }],
    ranks: [{
      rank: 2, level: 16, cost: 55,
      effects: [{ type: 'directDamage', min: 42, max: 42 }, { type: 'dot', total: 48, duration: 12, interval: 3 }],
    }],
    description: 'Sears the target with fire for 25 damage plus $d over 12 sec.',
  },
  flametongue_weapon: {
    id: 'flametongue_weapon', name: 'Flametongue Weapon', class: 'shaman', learnLevel: 10,
    cost: 25, castTime: 0, cooldown: 0, range: 0, school: 'fire',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 8, duration: 300 }],
    ranks: [
      { rank: 2, level: 18, cost: 40, effects: [{ type: 'imbue', bonus: 13, duration: 300 }] },
    ],
    description: 'Imbues your weapon with elemental fire: each swing deals 8 additional Fire damage for 5 min.',
  },
  frost_shock: {
    id: 'frost_shock', name: 'Frost Shock', class: 'shaman', learnLevel: 14,
    cost: 50, castTime: 0, cooldown: 6, range: 20, school: 'frost',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 36, max: 42 }, { type: 'slow', mult: 0.5, duration: 8 }],
    description: 'Instantly shocks the target with frost for $d Frost damage and slows its movement by 50% for 8 sec.',
  },
  frostbrand_weapon: {
    id: 'frostbrand_weapon', name: 'Frostbrand Weapon', class: 'shaman', learnLevel: 12,
    cost: 25, castTime: 0, cooldown: 0, range: 0, school: 'frost',
    requiresTarget: false,
    effects: [{ type: 'imbue', bonus: 8, duration: 300 }],
    ranks: [
      { rank: 2, level: 20, cost: 40, effects: [{ type: 'imbue', bonus: 13, duration: 300 }] },
    ],
    description: 'Imbues your weapon with biting frost: each swing deals 8 additional damage for 5 min.',
  },
  ghost_wolf: {
    id: 'ghost_wolf', name: 'Ghost Wolf', class: 'shaman', learnLevel: 16,
    cost: 35, castTime: 2.0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.4, duration: 3600 }],
    description: 'Turns you into a Ghost Wolf, increasing movement speed by 40%. Cast again to return to normal form.',
  },
  stormstrike: {
    id: 'stormstrike', name: 'Stormstrike', class: 'shaman', learnLevel: 20,
    cost: 40, castTime: 0, cooldown: 12, range: 0, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'weaponStrike', bonus: 26 }],
    description: 'Channels the storm through your weapon, instantly striking for weapon damage plus $d.',
  },

  // ====================== WARLOCK ======================
  shadow_bolt: {
    id: 'shadow_bolt', name: 'Shadow Bolt', class: 'warlock', learnLevel: 1,
    cost: 25, castTime: 1.7, cooldown: 0, range: 30, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 13, max: 18 }],
    ranks: [
      { rank: 2, level: 8, cost: 38, castTime: 2.2, effects: [{ type: 'directDamage', min: 24, max: 31 }] },
      { rank: 3, level: 14, cost: 55, castTime: 2.7, effects: [{ type: 'directDamage', min: 42, max: 53 }] },
      { rank: 4, level: 20, cost: 80, castTime: 3.0, effects: [{ type: 'directDamage', min: 68, max: 84 }] },
    ],
    description: 'Sends a shadowy bolt at the enemy for $d Shadow damage.',
  },
  demon_skin: {
    id: 'demon_skin', name: 'Demon Skin', class: 'warlock', learnLevel: 1,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 30, duration: 1800 }],
    ranks: [
      { rank: 2, level: 12, cost: 35, effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 55, duration: 1800 }] },
      { rank: 3, level: 20, cost: 50, effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 80, duration: 1800 }] },
    ],
    description: 'Demonic skin increases your armor by 30 for 30 min.',
  },
  immolate: {
    id: 'immolate', name: 'Immolate', class: 'warlock', learnLevel: 1,
    cost: 25, castTime: 2.0, cooldown: 0, range: 30, school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 11, max: 11 }, { type: 'dot', total: 20, duration: 15, interval: 3 }],
    ranks: [{
      rank: 2, level: 10, cost: 40,
      effects: [{ type: 'directDamage', min: 22, max: 22 }, { type: 'dot', total: 35, duration: 15, interval: 3 }],
    }, {
      rank: 3, level: 16, cost: 60,
      effects: [{ type: 'directDamage', min: 38, max: 38 }, { type: 'dot', total: 60, duration: 15, interval: 3 }],
    }],
    description: 'Burns the enemy for 11 Fire damage and an additional $d over 15 sec.',
  },
  corruption: {
    id: 'corruption', name: 'Corruption', class: 'warlock', learnLevel: 4,
    cost: 35, castTime: 2.0, cooldown: 0, range: 30, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 40, duration: 18, interval: 3 }],
    ranks: [
      { rank: 2, level: 12, cost: 55, effects: [{ type: 'dot', total: 72, duration: 18, interval: 3 }] },
      { rank: 3, level: 18, cost: 75, effects: [{ type: 'dot', total: 108, duration: 18, interval: 3 }] },
    ],
    description: 'Corrupts the target, causing $d Shadow damage over 18 sec.',
  },
  life_tap: {
    id: 'life_tap', name: 'Life Tap', class: 'warlock', learnLevel: 6,
    cost: 0, castTime: 0, cooldown: 0, range: 0, school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'lifeTap', hp: 30, mana: 30 }],
    ranks: [
      { rank: 2, level: 14, cost: 0, effects: [{ type: 'lifeTap', hp: 55, mana: 55 }] },
      { rank: 3, level: 20, cost: 0, effects: [{ type: 'lifeTap', hp: 85, mana: 85 }] },
    ],
    description: 'Converts 30 health into 30 mana.',
  },
  curse_of_agony: {
    id: 'curse_of_agony', name: 'Curse of Agony', class: 'warlock', learnLevel: 8,
    cost: 25, castTime: 0, cooldown: 0, range: 30, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 36, duration: 24, interval: 3 }],
    ranks: [
      { rank: 2, level: 14, cost: 40, effects: [{ type: 'dot', total: 72, duration: 24, interval: 3 }] },
      { rank: 3, level: 20, cost: 60, effects: [{ type: 'dot', total: 112, duration: 24, interval: 3 }] },
    ],
    description: 'Curses the target with agony: $d Shadow damage over 24 sec.',
  },
  drain_life: {
    id: 'drain_life', name: 'Drain Life', class: 'warlock', learnLevel: 10,
    cost: 35, castTime: 0, channel: { duration: 5, ticks: 5 }, cooldown: 0, range: 20, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'drainTick', min: 7, max: 7, healFrac: 1 }],
    ranks: [
      { rank: 2, level: 14, cost: 50, effects: [{ type: 'drainTick', min: 12, max: 12, healFrac: 1 }] },
      { rank: 3, level: 20, cost: 70, effects: [{ type: 'drainTick', min: 17, max: 17, healFrac: 1 }] },
    ],
    description: 'Drains the target\'s life, transferring 7 health to you each second for 5 sec.',
  },
  fear: {
    id: 'fear', name: 'Fear', class: 'warlock', learnLevel: 14,
    cost: 40, castTime: 1.5, cooldown: 0, range: 20, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'incapacitate', duration: 8 }],
    description: 'Strikes terror into the enemy, leaving it cowering for up to 8 sec. Any damage breaks the effect.',
  },
  searing_pain: {
    id: 'searing_pain', name: 'Searing Pain', class: 'warlock', learnLevel: 16,
    cost: 35, castTime: 1.5, cooldown: 0, range: 30, school: 'fire',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 30, max: 38 }],
    description: 'Sears the enemy with agonizing fire for $d Fire damage. Quick to cast.',
  },
  shadowburn: {
    id: 'shadowburn', name: 'Shadowburn', class: 'warlock', learnLevel: 20,
    cost: 70, castTime: 0, cooldown: 15, range: 20, school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 56, max: 66 }],
    description: 'Instantly blasts the target with Shadow Flame for $d Shadow damage.',
  },
  summon_imp: {
    id: 'summon_imp', name: 'Summon Imp', class: 'warlock', learnLevel: 1,
    cost: 50, castTime: 5, cooldown: 0, range: 0, school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'imp' }],
    description: 'Summons an Imp under the command of the Warlock. The Imp hurls Firebolts at your enemies from afar. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_voidwalker: {
    id: 'summon_voidwalker', name: 'Summon Voidwalker', class: 'warlock', learnLevel: 8,
    cost: 80, castTime: 5, cooldown: 0, range: 0, school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'voidwalker' }],
    description: 'Summons a Voidwalker under the command of the Warlock. The Voidwalker is a sturdy demon that taunts your enemies and soaks up punishment. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_succubus: {
    id: 'summon_succubus', name: 'Summon Succubus', class: 'warlock', learnLevel: 12,
    cost: 100, castTime: 5, cooldown: 0, range: 0, school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'succubus' }],
    description: 'Summons a Succubus under the command of the Warlock. The Succubus is a fragile demon that strikes quickly and hits hard in melee. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_felhunter: {
    id: 'summon_felhunter', name: 'Summon Felhunter', class: 'warlock', learnLevel: 14,
    cost: 120, castTime: 5, cooldown: 0, range: 0, school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'felhunter' }],
    description: 'Summons a Felhunter under the command of the Warlock. The Felhunter harries enemies from range with Shadow Bite and excels at hunting spellcasters. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_felguard: {
    id: 'summon_felguard', name: 'Summon Felguard', class: 'warlock', learnLevel: 16,
    cost: 150, castTime: 5, cooldown: 0, range: 0, school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'felguard' }],
    description: 'Summons a Felguard under the command of the Warlock. The Felguard is a durable melee demon that wades into battle and holds its own. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_infernal: {
    id: 'summon_infernal', name: 'Summon Infernal', class: 'warlock', learnLevel: 18,
    cost: 140, castTime: 6, cooldown: 180, range: 0, school: 'fire',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'infernal' }],
    description: 'Binds an Infernal to your will — a hulking juggernaut with crushing melee and the deepest health and armor of any demon. A long cooldown gates its raw power. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },
  summon_doomguard: {
    id: 'summon_doomguard', name: 'Summon Doomguard', class: 'warlock', learnLevel: 20,
    cost: 150, castTime: 6, cooldown: 180, range: 0, school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'summonDemon', mobId: 'doomguard' }],
    description: 'Binds a Doomguard to your will — an elite demon that rains heavy Shadow damage from afar. A long cooldown gates its devastating power. Summoning a new demon dismisses your current one. You may have one demon at a time.',
  },

  // ====================== DRUID ======================
  wrath: {
    id: 'wrath', name: 'Wrath', class: 'druid', learnLevel: 1,
    cost: 20, castTime: 1.5, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 13, max: 16 }],
    ranks: [
      { rank: 2, level: 8, cost: 32, castTime: 2.0, effects: [{ type: 'directDamage', min: 24, max: 29 }] },
      { rank: 3, level: 14, cost: 48, effects: [{ type: 'directDamage', min: 38, max: 45 }] },
      { rank: 4, level: 20, cost: 70, effects: [{ type: 'directDamage', min: 60, max: 71 }] },
    ],
    description: 'Hurls a bolt of nature energy for $d Nature damage.',
  },
  healing_touch: {
    id: 'healing_touch', name: 'Healing Touch', class: 'druid', learnLevel: 1,
    cost: 25, castTime: 2.5, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 37, max: 51 }],
    ranks: [
      { rank: 2, level: 8, cost: 45, castTime: 3.0, effects: [{ type: 'heal', min: 68, max: 86 }] },
      { rank: 3, level: 14, cost: 75, effects: [{ type: 'heal', min: 115, max: 140 }] },
      { rank: 4, level: 20, cost: 110, effects: [{ type: 'heal', min: 175, max: 208 }] },
    ],
    description: 'Heals a friendly target for $d.',
  },
  mark_of_the_wild: {
    id: 'mark_of_the_wild', name: 'Mark of the Wild', class: 'druid', learnLevel: 1,
    cost: 20, castTime: 0, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'buffTarget', kind: 'buff_armor', value: 25, duration: 1800 }],
    ranks: [
      { rank: 2, level: 10, cost: 35, effects: [{ type: 'buffTarget', kind: 'buff_armor', value: 50, duration: 1800 }] },
      { rank: 3, level: 16, cost: 50, effects: [{ type: 'buffTarget', kind: 'buff_armor', value: 75, duration: 1800 }] },
    ],
    description: 'Places the Mark of the Wild on a friendly target, increasing armor by 25 for 30 min.',
  },
  moonfire: {
    id: 'moonfire', name: 'Moonfire', class: 'druid', learnLevel: 4,
    cost: 25, castTime: 0, cooldown: 0, range: 30, school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 9, max: 12 }, { type: 'dot', total: 12, duration: 9, interval: 3 }],
    ranks: [{
      rank: 2, level: 10, cost: 40,
      effects: [{ type: 'directDamage', min: 17, max: 21 }, { type: 'dot', total: 24, duration: 12, interval: 3 }],
    }, {
      rank: 3, level: 16, cost: 60,
      effects: [{ type: 'directDamage', min: 28, max: 34 }, { type: 'dot', total: 40, duration: 12, interval: 3 }],
    }],
    description: 'Burns the enemy with moonfire for $d Arcane damage plus damage over time.',
  },
  rejuvenation: {
    id: 'rejuvenation', name: 'Rejuvenation', class: 'druid', learnLevel: 4,
    cost: 25, castTime: 0, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'hot', total: 32, duration: 12, interval: 3 }],
    ranks: [
      { rank: 2, level: 10, cost: 40, effects: [{ type: 'hot', total: 56, duration: 12, interval: 3 }] },
      { rank: 3, level: 16, cost: 60, effects: [{ type: 'hot', total: 88, duration: 12, interval: 3 }] },
      { rank: 4, level: 20, cost: 80, effects: [{ type: 'hot', total: 116, duration: 12, interval: 3 }] },
    ],
    description: 'Heals the target for $d over 12 sec.',
  },
  thorns: {
    id: 'thorns', name: 'Thorns', class: 'druid', learnLevel: 6,
    cost: 20, castTime: 0, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'buffTarget', kind: 'thorns', value: 3, duration: 600 }],
    ranks: [
      { rank: 2, level: 14, cost: 35, effects: [{ type: 'buffTarget', kind: 'thorns', value: 6, duration: 600 }] },
      { rank: 3, level: 20, cost: 50, effects: [{ type: 'buffTarget', kind: 'thorns', value: 9, duration: 600 }] },
    ],
    description: 'Thorns sprout from the target: melee attackers take 3 Nature damage.',
  },
  entangling_roots: {
    id: 'entangling_roots', name: 'Entangling Roots', class: 'druid', learnLevel: 8,
    cost: 35, castTime: 1.5, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'root', duration: 12 }],
    ranks: [{
      rank: 2, level: 16, cost: 50,
      effects: [{ type: 'root', duration: 12 }, { type: 'dot', total: 32, duration: 12, interval: 3 }],
    }],
    description: 'Roots the target in place for up to 12 sec.',
  },
  bear_form: {
    id: 'bear_form', name: 'Bear Form', class: 'druid', learnLevel: 10,
    cost: 30, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_bear', value: 0.65, duration: 3600 }],
    description: 'Shapeshift into a bear: armor +65%, attack power +15, your attacks build rage and generate 30% more threat. Cast again to return to caster form.',
  },
  bear_charge: {
    id: 'bear_charge', name: 'Bear Charge', class: 'druid', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 15, range: 25, minRange: 8, school: 'physical',
    requiresTarget: true, offGcd: true, requiresForm: 'bear',
    effects: [{ type: 'charge' }, { type: 'stun', duration: 1 }],
    description: 'Charge an enemy, generating 9 rage and stunning it for 1 sec. 8-25 yd range. Bear Form only.',
  },
  maul: {
    id: 'maul', name: 'Maul', class: 'druid', learnLevel: 10,
    cost: 15, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, onNextSwing: true, offGcd: true, requiresForm: 'bear',
    threat: { flat: 35 }, // classic 180 at rank 7/level 58, scaled to the 1-20 band
    effects: [{ type: 'weaponDamage', bonus: 18 }],
    ranks: [
      { rank: 2, level: 16, cost: 15, threatFlat: 50, effects: [{ type: 'weaponDamage', bonus: 27 }] },
    ],
    description: 'A mauling attack that increases melee damage by $d and causes a high amount of threat. Activates on your next swing. Bear Form only.',
  },
  growl: {
    id: 'growl', name: 'Growl', class: 'druid', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 10, range: 8, school: 'physical',
    requiresTarget: true, offGcd: true, requiresForm: 'bear',
    effects: [{ type: 'taunt' }],
    description: 'Growls at the target: your threat rises to match its most hated enemy and it is compelled to attack you for 3 sec. Bear Form only.',
  },
  demoralizing_roar: {
    id: 'demoralizing_roar', name: 'Demoralizing Roar', class: 'druid', learnLevel: 10,
    cost: 10, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false, requiresForm: 'bear',
    effects: [{ type: 'aoeAttackPower', amount: 20, duration: 20, radius: 8 }],
    ranks: [
      { rank: 2, level: 16, cost: 10, effects: [{ type: 'aoeAttackPower', amount: 35, duration: 20, radius: 8 }] },
    ],
    description: 'Demoralizes nearby enemies, reducing their attack power by 20 for 20 sec. Bear Form only.',
  },
  cat_form: {
    id: 'cat_form', name: 'Wolf Form', class: 'druid', learnLevel: 12,
    cost: 30, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_cat', value: 0.71, duration: 3600 }],
    description: 'Shapeshift into a wolf: agility rises with your level, attack power +8 plus 2 per level, your attacks use energy and combo points, and you generate 29% less threat. Cast again to return to caster form.',
  },
  prowl: {
    id: 'prowl', name: 'Prowl', class: 'druid', learnLevel: 12,
    cost: 0, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false, requiresForm: 'cat', requiresOutOfCombat: true,
    effects: [{ type: 'selfBuff', kind: 'stealth', value: 0.7, duration: 3600 }],
    description: 'Enter stealth while in Wolf Form. Cannot be used in combat.',
  },
  rake: {
    id: 'rake', name: 'Rake', class: 'druid', learnLevel: 12,
    cost: 35, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, awardsCombo: 1, requiresForm: 'cat', requiresStealth: true,
    effects: [{ type: 'weaponStrike', bonus: 8 }, { type: 'dot', total: 30, duration: 9, interval: 3 }],
    ranks: [
      { rank: 2, level: 18, cost: 35, effects: [{ type: 'weaponStrike', bonus: 12 }, { type: 'dot', total: 48, duration: 9, interval: 3 }] },
    ],
    description: 'A stealth opener that rakes the enemy for weapon damage plus $d and causes bleeding damage over 9 sec. Awards 1 combo point. Wolf Form only.',
  },
  claw: {
    id: 'claw', name: 'Claw', class: 'druid', learnLevel: 12,
    cost: 45, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, awardsCombo: 1, requiresForm: 'cat',
    effects: [{ type: 'weaponStrike', bonus: 12 }],
    ranks: [
      { rank: 2, level: 18, cost: 45, effects: [{ type: 'weaponStrike', bonus: 20 }] },
    ],
    description: 'Claw the enemy for weapon damage plus $d. Awards 1 combo point. Wolf Form only.',
  },
  ferocious_bite: {
    id: 'ferocious_bite', name: 'Ferocious Bite', class: 'druid', learnLevel: 14,
    cost: 35, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, spendsCombo: true, requiresForm: 'cat',
    effects: [{ type: 'finisherDamage', base: 10, perCombo: 14, variance: 6 }],
    description: 'Finishing move that causes damage per combo point. Wolf Form only.',
  },
  swipe: {
    id: 'swipe', name: 'Swipe', class: 'druid', learnLevel: 16,
    cost: 20, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false, requiresForm: 'bear',
    threat: { mult: 1.75 }, // classic: swipe damage causes 1.75x threat
    effects: [{ type: 'aoeDamage', min: 12, max: 15, radius: 5 }],
    description: 'Swipe nearby enemies for $d damage. Causes extra threat. Bear Form only.',
  },
  regrowth: {
    id: 'regrowth', name: 'Regrowth', class: 'druid', learnLevel: 14,
    cost: 55, castTime: 2.0, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true, targetType: 'friendly',
    effects: [{ type: 'heal', min: 52, max: 62 }, { type: 'hot', total: 49, duration: 21, interval: 3 }],
    description: 'Heals a friendly target for $d and an additional amount over 21 sec.',
  },
  barkskin: {
    id: 'barkskin', name: 'Barkskin', class: 'druid', learnLevel: 16,
    cost: 30, castTime: 0, cooldown: 60, range: 0, school: 'nature',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 150, duration: 15 }],
    description: 'Your skin hardens like bark, increasing armor by 150 for 15 sec.',
  },
  starfire: {
    id: 'starfire', name: 'Starfire', class: 'druid', learnLevel: 18,
    cost: 80, castTime: 3.0, cooldown: 0, range: 30, school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 60, max: 74 }],
    description: 'Calls down a bolt of stellar fire, causing $d Arcane damage.',
  },
  travel_form: {
    id: 'travel_form', name: 'Travel Form', class: 'druid', learnLevel: 16,
    cost: 30, castTime: 0, cooldown: 0, range: 0, school: 'nature',
    requiresTarget: false,
    effects: [{ type: 'selfBuff', kind: 'form_travel', value: 1.4, duration: 3600 }],
    description: 'Instantly shift into a swift travel form, increasing movement speed by 40%. You cannot use other abilities while shifted, but can shift in or out of combat — ideal for escaping.',
  },
  enrage: {
    id: 'enrage', name: 'Enrage', class: 'druid', learnLevel: 16,
    cost: 0, castTime: 0, cooldown: 60, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true, requiresForm: 'bear',
    effects: [{ type: 'gainResource', amount: 20 }],
    description: 'Generates 20 rage instantly. Bear Form only.',
  },
  bash: {
    id: 'bash', name: 'Bash', class: 'druid', learnLevel: 16,
    cost: 10, castTime: 0, cooldown: 60, range: 8, school: 'physical',
    requiresTarget: true, requiresForm: 'bear',
    effects: [{ type: 'stun', duration: 2 }],
    description: 'Stuns the target for 2 sec. Bear Form only.',
  },
  faerie_fire: {
    id: 'faerie_fire', name: 'Faerie Fire', class: 'druid', learnLevel: 18,
    cost: 30, castTime: 0, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'sunder', armor: 35, maxStacks: 1 }],
    description: "Decreases the target's armor by 35 for 40 sec.",
  },
  hibernate: {
    id: 'hibernate', name: 'Hibernate', class: 'druid', learnLevel: 18,
    cost: 50, castTime: 1.5, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'incapacitate', duration: 8 }],
    description: 'Forces the target into a deep sleep for up to 8 sec. Any damage will awaken it.',
  },
  dash: {
    id: 'dash', name: 'Dash', class: 'druid', learnLevel: 18,
    cost: 0, castTime: 0, cooldown: 60, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true, requiresForm: 'cat',
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.5, duration: 15 }],
    description: 'Sprint forward, increasing movement speed by 50% for 15 sec. Wolf Form only.',
  },
  pounce: {
    id: 'pounce', name: 'Pounce', class: 'druid', learnLevel: 18,
    cost: 50, castTime: 0, cooldown: 0, range: 8, school: 'physical',
    requiresTarget: true, awardsCombo: 1, requiresForm: 'cat', requiresStealth: true,
    effects: [{ type: 'stun', duration: 2 }],
    description: 'A stealth opener that stuns the target for 2 sec. Awards 1 combo point. Wolf Form only.',
  },
  insect_swarm: {
    id: 'insect_swarm', name: 'Insect Swarm', class: 'druid', learnLevel: 20,
    cost: 45, castTime: 0, cooldown: 0, range: 30, school: 'nature',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 48, duration: 12, interval: 3 }],
    description: 'The enemy is swarmed by insects, taking $d Nature damage over 12 sec.',
  },
  tigers_fury: {
    id: 'tigers_fury', name: "Tiger's Fury", class: 'druid', learnLevel: 20,
    cost: 30, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: false, requiresForm: 'cat',
    effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 40, duration: 6 }],
    description: 'Increases attack power by 40 for 6 sec. Wolf Form only.',
  },
  rip: {
    id: 'rip', name: 'Rip', class: 'druid', learnLevel: 20,
    cost: 30, castTime: 0, cooldown: 0, range: 0, school: 'physical',
    requiresTarget: true, spendsCombo: true, requiresForm: 'cat',
    effects: [{ type: 'dot', total: 60, duration: 12, interval: 2 }],
    description: 'Finishing move that causes Bleed damage over 12 sec. Consumes combo points. Wolf Form only.',
  },

  // ============== TALENT-GRANTED (Warrior) ==============
  // Not in CLASSES.warrior.abilities — unlocked only via talent grants (spec
  // signatures + active nodes), so abilitiesKnownAt adds them by `mods.grants`.
  mortal_strike: {
    id: 'mortal_strike', name: 'Mortal Strike', class: 'warrior', learnLevel: 10,
    cost: 30, castTime: 0, cooldown: 6, range: 0, school: 'physical',
    requiresTarget: true, threat: { mult: 1.2 },
    effects: [{ type: 'weaponStrike', bonus: 40 }],
    description: 'A vicious strike dealing weapon damage plus $d. (Arms signature)',
  },
  bloodthirst: {
    id: 'bloodthirst', name: 'Bloodthirst', class: 'warrior', learnLevel: 10,
    cost: 30, castTime: 0, cooldown: 6, range: 0, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'weaponStrike', bonus: 35, weaponMult: 0.6 }],
    description: 'Instantly attack in a blood frenzy for $d. (Fury signature)',
  },
  shield_slam: {
    id: 'shield_slam', name: 'Shield Slam', class: 'warrior', learnLevel: 10,
    cost: 20, castTime: 0, cooldown: 6, range: 0, school: 'physical',
    requiresTarget: true, threat: { flat: 110 },
    effects: [{ type: 'weaponStrike', bonus: 30, weaponMult: 0.5 }],
    description: 'Slam the target with your shield for $d and massive threat. (Protection signature)',
  },
  whirlwind: {
    id: 'whirlwind', name: 'Whirlwind', class: 'warrior', learnLevel: 10,
    cost: 25, castTime: 0, cooldown: 10, range: 0, school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'aoeDamage', min: 30, max: 42, radius: 8 }],
    description: 'Spin in a deadly arc, striking all nearby enemies for $d. (Fury talent)',
  },
  berserker_rage: {
    id: 'berserker_rage', name: 'Berserker Rage', class: 'warrior', learnLevel: 10,
    cost: 0, castTime: 0, cooldown: 30, range: 0, school: 'physical',
    requiresTarget: false, offGcd: true,
    effects: [{ type: 'gainResource', amount: 20 }],
    description: 'Enter a berserker rage, generating 20 rage. (Warrior talent)',
  },
};

// A class ability resolved to a concrete rank, with talent modifiers already
// folded into its cost / cast / cooldown / effects. The combat path reads only
// these flat numbers — it never consults the talent tree. Structurally matches
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
}

// Scale one effect's damage/heal magnitudes, returning a NEW effect object — the
// base content arrays are shared module data and must never be mutated. `flat`
// is added once to the effect's primary magnitude.
function scaleEffect(eff: AbilityEffect, dmgMult: number, healMult: number, flat: number): AbilityEffect {
  switch (eff.type) {
    case 'weaponDamage': return { ...eff, bonus: Math.round(eff.bonus * dmgMult + flat) };
    case 'weaponStrike': return { ...eff, bonus: Math.round(eff.bonus * dmgMult + flat) };
    case 'directDamage': return { ...eff, min: Math.round(eff.min * dmgMult + flat), max: Math.round(eff.max * dmgMult + flat) };
    case 'dot': return { ...eff, total: Math.round(eff.total * dmgMult + flat) };
    case 'aoeDamage': return { ...eff, min: Math.round(eff.min * dmgMult + flat), max: Math.round(eff.max * dmgMult + flat) };
    case 'aoeRoot': return { ...eff, min: Math.round(eff.min * dmgMult), max: Math.round(eff.max * dmgMult) };
    case 'drainTick': return { ...eff, min: Math.round(eff.min * dmgMult), max: Math.round(eff.max * dmgMult) };
    case 'finisherDamage': return { ...eff, base: Math.round(eff.base * dmgMult + flat), perCombo: Math.round(eff.perCombo * dmgMult) };
    case 'imbue': return { ...eff, bonus: Math.round(eff.bonus * dmgMult + flat), judgeMin: eff.judgeMin === undefined ? undefined : Math.round(eff.judgeMin * dmgMult + flat), judgeMax: eff.judgeMax === undefined ? undefined : Math.round(eff.judgeMax * dmgMult + flat) };
    case 'heal': return { ...eff, min: Math.round(eff.min * healMult + flat), max: Math.round(eff.max * healMult + flat) };
    case 'hot': return { ...eff, total: Math.round(eff.total * healMult + flat) };
    case 'absorb': return { ...eff, amount: Math.round(eff.amount * healMult + flat) };
    case 'buffTarget': return { ...eff, value: Math.round(eff.value * dmgMult + flat) };
    case 'selfBuff': return { ...eff, value: Math.round(eff.value * dmgMult + flat) };
    case 'lifeTap': return { ...eff, mana: Math.round(eff.mana * dmgMult + flat) };
    case 'gainResource': return { ...eff, amount: Math.round(eff.amount * dmgMult + flat) };
    default: return eff;
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
  const flat = am?.flatDmg ?? 0;
  if (dmgMult !== 1 || healMult !== 1 || flat !== 0) {
    entry.effects = entry.effects.map((e) => scaleEffect(e, dmgMult, healMult, flat));
  }
  if (am) {
    if (am.costPct) entry.cost = Math.max(0, Math.round(entry.cost * (1 + am.costPct)));
    if (am.castPct) entry.castTime = Math.max(0, entry.castTime * (1 + am.castPct));
    if (am.cooldownPct) entry.cooldown = Math.max(0, entry.cooldown * (1 + am.cooldownPct));
  }
}

// Abilities a class knows at a given level, with rank values resolved and any
// talent modifiers (granted abilities + per-ability/global tweaks) applied.
export function abilitiesKnownAt(cls: PlayerClass, level: number, mods?: TalentModifiers): KnownAbility[] {
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

    let rank = 1, cost = def.cost, castTime = def.castTime, effects = def.effects;
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
    const entry: KnownAbility = { def, rank, cost, castTime, cooldown: def.cooldown, effects, threatFlat, threatMult };
    if (mods) applyTalentMods(entry, mods);
    out.push(entry);
  }
  return out;
}
