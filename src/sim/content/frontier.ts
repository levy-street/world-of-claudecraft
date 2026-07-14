// Frostreach Frontier content: the frost rares that roam the Season 1 PvP band.
// Killing one drops honor + hero points to every contributor (the reward loop is
// in src/sim/pvp/frontier_rewards.ts, hooked from handleDeath). Cap-level rare
// elites; loot is empty here (the honor/hero reward is the point, not a drop
// table). Names are IP-safe frost coinages. Spawn camps + the zone label land in
// a follow-up (kept out of this slice so world-gen spawn rng, and parity, are
// untouched).

import { FRONTIER_DAILY_HONOR } from '../pvp/frontier';
import type { MobTemplate, QuestDef } from '../types';
import { FRONTIER_MARSHAL_NPC_ID, FRONTIER_QM_NPC_ID } from './frontier_vendor';

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

// Frontier daily quests: repeatable once per host day (the daily-quest mechanism in
// src/sim/quests/daily_quest.ts), paying honor instead of xp/copper. The muster daily
// is completable at the hub today (report to the Marshal, requisition from the
// Quartermaster, muster back); the kill/PvP dailies land with the frost-rare spawner
// (a player-gated spawner is a follow-up so the always-idle wander rng never forks
// the parity goldens).
export const FRONTIER_QUESTS: Record<string, QuestDef> = {
  frontier_daily_muster: {
    id: 'frontier_daily_muster',
    name: 'Frontier Muster',
    giverNpcId: FRONTIER_MARSHAL_NPC_ID,
    turnInNpcId: FRONTIER_MARSHAL_NPC_ID,
    text: "Every soldier reports before the day's fighting. Draw your requisition from Quartermaster Frostwarden, then muster back to me for your honor.",
    completionText:
      'Good. The Frontier holds another day. Take your honor, soldier, and mind your back out there.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: FRONTIER_QM_NPC_ID,
        count: 1,
        label: 'Requisition from Quartermaster Frostwarden',
      },
    ],
    xpReward: 0,
    copperReward: 0,
    itemRewards: {},
    honorReward: FRONTIER_DAILY_HONOR,
    daily: true,
    minLevel: 20,
  },
};
