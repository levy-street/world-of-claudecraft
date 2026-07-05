import type { MobTemplate } from '../types';

// Warlock demon pets. Summoned (never tamed) demons owned by a warlock; they
// follow/assist exactly like hunter pets (see Sim.updatePet) but never go feral
// — a slain or dismissed demon unravels. The Emberkin is a ranged Firebolt
// damage pet; the Gloomshade is a sturdy melee tank that taunts to hold threat.
// Created at the owner's level (createMob reads the passed level, not
// minLevel/maxLevel).
export const WARLOCK_PET_MOBS: Record<string, MobTemplate> = {
  emberkin: {
    id: 'emberkin',
    name: 'Emberkin',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    // squishy ranged caster: low health and armor, steady Firebolt damage
    hpBase: 30,
    hpPerLevel: 12,
    dmgBase: 5,
    dmgPerLevel: 1.1,
    attackSpeed: 2.0,
    armorPerLevel: 8,
    moveSpeed: 5.2,
    aggroRadius: 8,
    loot: [],
    scale: 0.55,
    color: 0xff7a2a,
    petRanged: { range: 25, school: 'fire' },
  },
  gloomshade: {
    id: 'gloomshade',
    name: 'Gloomshade',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    // tank: deep health pool and heavy armor, modest melee damage, taunts
    hpBase: 70,
    hpPerLevel: 28,
    dmgBase: 4,
    dmgPerLevel: 0.75,
    attackSpeed: 2.0,
    armorPerLevel: 45,
    moveSpeed: 5.0,
    aggroRadius: 8,
    loot: [],
    scale: 1.15,
    color: 0x3a3a6e,
  },
  // Glass-cannon melee striker: hits hard and fast on a light frame, but
  // folds quickly under retaliation — the warlock's leveling DPS demon.
  duskborn: {
    id: 'duskborn',
    name: 'Duskborn',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    hpBase: 34,
    hpPerLevel: 14,
    dmgBase: 7,
    dmgPerLevel: 2.1,
    attackSpeed: 1.7,
    armorPerLevel: 12,
    moveSpeed: 5.4,
    aggroRadius: 8,
    loot: [],
    scale: 0.95,
    color: 0xc6469b,
  },
  // Anti-caster hound: a ranged Shadow Bite skirmisher with the emberkin's
  // reach but a sturdier body, the classic counter-pick against enemy
  // spellcasters.
  spellhound: {
    id: 'spellhound',
    name: 'Spellhound',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    hpBase: 46,
    hpPerLevel: 18,
    dmgBase: 6,
    dmgPerLevel: 1.7,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 5.6,
    aggroRadius: 8,
    loot: [],
    scale: 1.0,
    color: 0x4a7d4a,
    petRanged: { range: 25, school: 'shadow' },
  },
  // All-rounder warfiend: deeper health and armor than the duskborn with nearly
  // its damage — the warlock's durable melee bruiser once it can be summoned.
  warfiend: {
    id: 'warfiend',
    name: 'Warfiend',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    hpBase: 80,
    hpPerLevel: 30,
    dmgBase: 7,
    dmgPerLevel: 2.0,
    attackSpeed: 2.2,
    armorPerLevel: 38,
    moveSpeed: 5.2,
    aggroRadius: 8,
    loot: [],
    scale: 1.25,
    color: 0x6e5a2a,
  },
  // Bound pyre colossus: a hulking, slow-swinging juggernaut with the deepest
  // health and armor of any demon and crushing melee — a long-cooldown power
  // summon.
  pyre_colossus: {
    id: 'pyre_colossus',
    name: 'Pyre Colossus',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    hpBase: 130,
    hpPerLevel: 42,
    dmgBase: 10,
    dmgPerLevel: 2.6,
    attackSpeed: 2.8,
    armorPerLevel: 55,
    moveSpeed: 4.8,
    aggroRadius: 8,
    loot: [],
    scale: 1.7,
    color: 0xd24a2a,
  },
  // Bound wraithborn: an elite ranged Shadow caster that rains heavy damage
  // from afar — the warlock's high-end nuke demon, summoned at great cost.
  wraithborn: {
    id: 'wraithborn',
    name: 'Wraithborn',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    hpBase: 95,
    hpPerLevel: 34,
    dmgBase: 11,
    dmgPerLevel: 2.4,
    attackSpeed: 2.4,
    armorPerLevel: 30,
    moveSpeed: 5.0,
    aggroRadius: 8,
    loot: [],
    scale: 1.5,
    color: 0x7a3a8e,
    petRanged: { range: 28, school: 'shadow' },
  },
};
