// Frostreach Frontier content: the frost rares the public Incursion spawns, plus the
// weak trash the spawner keeps roaming the band. Killing a rare drops honor + hero
// points to every contributor incl. healers (the reward loop is in
// src/sim/pvp/frontier_rewards.ts, hooked from handleDeath). The rares are UNKITABLE
// group content (2.2x move + ccImmune + slowImmune, like the world boss Thunzharr) and
// tanky/hard enough to want 2 to 3 players plus a healer, so the zone cooperates on a
// spawn instead of a lone tap-and-grab. Loot is empty here (honor/hero is the reward,
// not a drop table). The spawning + meter live in pvp/frontier_incursion.ts; names are
// IP-safe frost coinages.

import { FRONTIER_DAILY_HONOR } from '../pvp/frontier';
import type { MobTemplate, QuestDef } from '../types';
import { FRONTIER_MARSHAL_NPC_ID, FRONTIER_QM_NPC_ID } from './frontier_vendor';

export const FRONTIER_MOBS: Record<string, MobTemplate> = {
  // Rimefang Stalker: a hard, unkitable frost beast. Faster than 2x player run speed,
  // immune to stun/root/snare, so it cannot be kited: a lone player without a healer
  // dies; 2 to 3 grouped players bring it down.
  rimefang_stalker: {
    id: 'rimefang_stalker',
    name: 'Rimefang Stalker',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    elite: true,
    rare: true,
    hpBase: 3200,
    hpPerLevel: 0,
    dmgBase: 80,
    dmgPerLevel: 0,
    attackSpeed: 1.8,
    armorPerLevel: 30,
    moveSpeed: 15.4,
    ccImmune: true,
    slowImmune: true,
    aggroRadius: 18,
    loot: [],
    scale: 1.4,
    color: 0x8fc7e8,
  },
  // Frostbound Revenant: the tankier, harder-hitting undead sentinel, with a frozen
  // cleave. Same unkitable rules; wants a third body to soak the cleave.
  frostbound_revenant: {
    id: 'frostbound_revenant',
    name: 'Frostbound Revenant',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    rare: true,
    hpBase: 4200,
    hpPerLevel: 0,
    dmgBase: 95,
    dmgPerLevel: 0,
    attackSpeed: 2.4,
    armorPerLevel: 40,
    moveSpeed: 15.4,
    ccImmune: true,
    slowImmune: true,
    aggroRadius: 18,
    cleave: { radius: 8, mult: 0.6, name: 'Frozen Sweep' },
    loot: [],
    scale: 1.45,
    color: 0xbfe6ff,
  },
  // Rimebound Wisp: the weak frost trash the Incursion spawner keeps roaming the band.
  // Farming these fills the shared incursion meter (the Greater-Rift core); each kill
  // also pays a small honor trickle (FRONTIER_TRASH_HONOR, granted in the kill hook).
  rimebound_wisp: {
    id: 'rimebound_wisp',
    name: 'Rimebound Wisp',
    minLevel: 19,
    maxLevel: 19,
    family: 'elemental',
    elite: false,
    rare: false,
    hpBase: 120,
    hpPerLevel: 0,
    dmgBase: 16,
    dmgPerLevel: 0,
    attackSpeed: 2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 14,
    loot: [],
    scale: 0.9,
    color: 0xd6f0ff,
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
