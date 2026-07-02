// Spec-only warrior talent content. Choice rows now carry the mutable talent picks.

import type { ClassTalents, SpecDef } from './talents';

const SPECS: SpecDef[] = [
  {
    id: 'arms',
    class: 'warrior',
    name: 'Arms',
    role: 'dps',
    icon: 'X',
    description: 'A master of two-handed weapons who strikes with deadly, deliberate blows.',
    signature: 'mortal_strike',
    mastery: {
      name: 'Sharpened Blades',
      description: 'Increases all melee ability damage by 10%.',
      effect: { global: { meleeDmgPct: 0.1 } },
    },
  },
  {
    id: 'fury',
    class: 'warrior',
    name: 'Fury',
    role: 'dps',
    icon: 'A',
    description: 'A whirlwind of blows fuelled by unrelenting rage.',
    signature: 'bloodthirst',
    mastery: {
      name: 'Bloodthirsty',
      description: 'Increases your critical strike chance by 5% and attack power by 10.',
      effect: { stats: { crit: 0.05, ap: 10 } },
    },
  },
  {
    id: 'prot',
    class: 'warrior',
    name: 'Protection',
    role: 'tank',
    icon: '#',
    description: "An immovable wall who holds the enemy's attention and shields allies.",
    signature: 'shield_slam',
    mastery: {
      name: 'Vengeance',
      description: 'Increases all threat you generate by 30% and your armor by 10%.',
      effect: { global: { threatPct: 0.3 }, stats: { armorPct: 0.1 } },
    },
  },
];

export const WARRIOR_TALENTS: ClassTalents = {
  class: 'warrior',
  nodes: [],
  specs: SPECS,
};
