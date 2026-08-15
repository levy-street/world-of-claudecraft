import type { MobTemplate } from '../types';

// Warlock demon pets. Summoned (never tamed) demons owned by a warlock; they
// follow/assist exactly like hunter pets (see Sim.updatePet) but never go feral.
// A slain or dismissed demon unravels. The Emberkin is a ranged Felbolt damage
// pet; the Gloomshade is a sturdy melee tank that taunts to hold threat.
// Created at the owner's level (createMob reads the passed level, not
// minLevel/maxLevel).
export const WARLOCK_PET_MOBS: Record<string, MobTemplate> = {
  emberkin: {
    id: 'emberkin',
    name: 'Emberkin',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    // squishy ranged caster: low health and armor, steady Felbolt damage
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
    petScaleRanks: [
      { rank: 2, level: 8, scale: 0.65 },
      { rank: 3, level: 14, scale: 0.75 },
      { rank: 4, level: 20, scale: 0.85 },
    ],
    color: 0xff7a2a,
    petRanged: {
      range: 25,
      school: 'fire',
      ability: 'emberkin_felbolt',
      name: 'Felbolt',
      active: { cooldown: 8 },
    },
    petCanTaunt: false,
  },
  gloomshade: {
    id: 'gloomshade',
    name: 'Gloomshade',
    minLevel: 1,
    maxLevel: 60,
    family: 'demon',
    // tank: deep health pool and heavy armor, modest melee damage, taunts.
    // petRole marks it as the roster's threat-holder: createDemonPet reads this
    // to default auto-taunt on so it holds aggro without a manual toggle.
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
    petRole: 'melee_tank',
    petChainPull: {
      ability: 'gloomshade_abyssal_chain',
      name: 'Abyssal Chain',
      triggerRange: 8,
      maxRange: 20,
      pullRange: 2.8,
      cooldown: 15,
    },
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
    dmgPerLevel: 2.2,
    attackSpeed: 2.8,
    armorPerLevel: 55,
    moveSpeed: 4.8,
    aggroRadius: 8,
    loot: [],
    scale: 1.7,
    color: 0xd24a2a,
  },
};
