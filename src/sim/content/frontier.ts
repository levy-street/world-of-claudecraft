// Frostreach Frontier content: the frost rares that roam the Season 1 PvP band.
// Killing one drops honor + hero points to every contributor (the reward loop is
// in src/sim/pvp/frontier_rewards.ts, hooked from handleDeath). Cap-level rare
// elites; loot is empty here (the honor/hero reward is the point, not a drop
// table). Names are IP-safe frost coinages. Spawn camps + the zone label land in
// a follow-up (kept out of this slice so world-gen spawn rng, and parity, are
// untouched).

import type { MobTemplate } from '../types';

export const FRONTIER_MOBS: Record<string, MobTemplate> = {
  // Rimefang Stalker: a fast frost beast that opens with a chilling bite.
  rimefang_stalker: {
    id: 'rimefang_stalker',
    name: 'Rimefang Stalker',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    elite: true,
    rare: true,
    hpBase: 260,
    hpPerLevel: 0,
    dmgBase: 30,
    dmgPerLevel: 0,
    attackSpeed: 1.8,
    armorPerLevel: 30,
    moveSpeed: 9,
    aggroRadius: 16,
    loot: [],
    scale: 1.3,
    color: 0x8fc7e8,
  },
  // Frostbound Revenant: a slower, harder-hitting undead sentinel of the band.
  frostbound_revenant: {
    id: 'frostbound_revenant',
    name: 'Frostbound Revenant',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    rare: true,
    hpBase: 340,
    hpPerLevel: 0,
    dmgBase: 36,
    dmgPerLevel: 0,
    attackSpeed: 2.4,
    armorPerLevel: 40,
    moveSpeed: 6.5,
    aggroRadius: 16,
    cleave: { radius: 8, mult: 0.6, name: 'Frozen Sweep' },
    loot: [],
    scale: 1.35,
    color: 0xbfe6ff,
  },
};
