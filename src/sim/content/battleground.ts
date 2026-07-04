// The Gravemarch 5v5 battleground: mob-kind entity templates for the Boneclad
// Revenant minion columns, the Bulwark towers, the Warstones, and the neutral
// Knell Warden (docs/prd/battlegrounds.md). Data-as-code, no engine logic.
//
// These templates are deliberately NOT merged into the flat MOBS table in
// data.ts: battleground entities are driven exclusively by the battleground
// module (src/sim/social/battleground.ts), never by the wild-mob AI, and every
// MOBS[templateId] consumer (frenzy/reflect affixes, leash, flee families, the
// wiki bestiary) must keep seeing them as unknown. The module spawns them by
// direct import through createMob.
//
// Stat anchors: the level-20 zone3 / dungeon templates (a normal level-20
// zone3 mob lands near 550 hp and ~35 average swing damage; elites take the
// standard 2.3x hp / 1.5x damage multiplier in createMob). Minions give no xp
// (xpMult 0) and no loot. All fight at BG_MOB_LEVEL.
import type { MobTemplate } from '../types';

export const BG_MOB_LEVEL = 20;

/** Every battleground entity template id carries this prefix; the sim's
 *  battleground arms key off it (and off Entity.bgMatchId) so no wild-mob
 *  system ever picks one up. */
export function isBattlegroundMobTemplate(templateId: string): boolean {
  return templateId.startsWith('bg_');
}

export type BgMinionRole = 'footman' | 'arbalist' | 'sergeant';

// Per-role drive metadata the battleground module reads (the MobTemplate keeps
// only the createMob stat surface). attackRange in yards.
export const BG_MINION_ROLES: Record<BgMinionRole, { templateId: string; attackRange: number }> = {
  footman: { templateId: 'bg_footman', attackRange: 2.4 },
  arbalist: { templateId: 'bg_arbalist', attackRange: 14 },
  sergeant: { templateId: 'bg_sergeant', attackRange: 2.6 },
};

export const BATTLEGROUND_MOBS: Record<string, MobTemplate> = {
  // 3 per column: the melee line. ~560 hp, ~36 avg swing at level 20.
  bg_footman: {
    id: 'bg_footman',
    name: 'Boneclad Footman',
    minLevel: BG_MOB_LEVEL,
    maxLevel: BG_MOB_LEVEL,
    family: 'undead',
    hpBase: 140,
    hpPerLevel: 22,
    dmgBase: 7,
    dmgPerLevel: 1.5,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 5.2,
    aggroRadius: 0, // module-driven: the wild aggro scan never runs for bg mobs
    xpMult: 0,
    loot: [],
    scale: 1.0,
    color: 0xcfd2ce,
  },
  // 1 per column: softer, harder-hitting, fires from range (role table above).
  bg_arbalist: {
    id: 'bg_arbalist',
    name: 'Boneclad Arbalist',
    minLevel: BG_MOB_LEVEL,
    maxLevel: BG_MOB_LEVEL,
    family: 'undead',
    hpBase: 110,
    hpPerLevel: 17,
    dmgBase: 9,
    dmgPerLevel: 1.9,
    attackSpeed: 2.4,
    armorPerLevel: 12,
    moveSpeed: 5.2,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 0.98,
    color: 0xb9c2c8,
  },
  // Every third wave: an elite banner carrier anchoring the column.
  bg_sergeant: {
    id: 'bg_sergeant',
    name: 'Boneclad Sergeant',
    minLevel: BG_MOB_LEVEL,
    maxLevel: BG_MOB_LEVEL,
    family: 'undead',
    elite: true,
    hpBase: 160,
    hpPerLevel: 24,
    dmgBase: 8,
    dmgPerLevel: 1.7,
    attackSpeed: 2.2,
    armorPerLevel: 26,
    moveSpeed: 5.2,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 1.14,
    color: 0x9aa7b4,
  },
  // Defensive tower: huge hp, stationary, no regen (bg mobs skip mob AI), its
  // bolt damage lives in the battleground module's tuning consts. CC immunity
  // is enforced by the module (these templates are outside MOBS, so the
  // applyAura ccImmune lookup cannot see the flag; the flag stays for intent).
  bg_bulwark: {
    id: 'bg_bulwark',
    name: 'Bulwark',
    minLevel: BG_MOB_LEVEL,
    maxLevel: BG_MOB_LEVEL,
    family: 'undead',
    ccImmune: true,
    hpBase: 3200,
    hpPerLevel: 140,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 1.6,
    armorPerLevel: 60,
    moveSpeed: 0,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 2.4,
    color: 0x8f8577,
  },
  // The soul-anchor. Destroying the enemy one wins the match.
  bg_warstone: {
    id: 'bg_warstone',
    name: 'Warstone',
    minLevel: BG_MOB_LEVEL,
    maxLevel: BG_MOB_LEVEL,
    family: 'undead',
    ccImmune: true,
    hpBase: 4600,
    hpPerLevel: 200,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2,
    armorPerLevel: 40,
    moveSpeed: 0,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 2.8,
    color: 0x86e3c3,
  },
  // Neutral elite at the center chapel; fells for the Knell silence buff.
  bg_knell_warden: {
    id: 'bg_knell_warden',
    name: 'The Knell Warden',
    minLevel: BG_MOB_LEVEL,
    maxLevel: BG_MOB_LEVEL,
    family: 'undead',
    elite: true,
    hpBase: 330,
    hpPerLevel: 52,
    dmgBase: 12,
    dmgPerLevel: 2.6,
    attackSpeed: 2.4,
    armorPerLevel: 40,
    moveSpeed: 6.5,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 1.35,
    color: 0xd9c78a,
  },
};
