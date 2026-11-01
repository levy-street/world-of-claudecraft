// Lantern Hall's weekly dungeon contracts and its quartermaster's stock (data-as-code; the rules
// live in src/sim/guild_contracts.ts and src/sim/guild_quartermaster.ts).
//
// Every week the board posts three contracts, one of each kind, the same for the whole realm:
//  - 'boss': defeat a named boss of one of the five five-player dungeons, either difficulty;
//  - 'heroic': clear one of the five on Heroic (its final boss falls on Heroic);
//  - 'task': see one of the dungeons' encounter skill tasks through (the very conditions the
//    Book of Deeds' encounter deeds test, src/sim/deeds.ts), repeatable week on week.
// A contract pays Lantern Seals, the guild's own currency, spent only at the quartermaster,
// whose stock is cosmetic only: titles, carried by Book of Deeds feats
// (src/sim/content/deeds.ts), the guild's own war horse (its reins) and the guild's weapon
// appearance (an account-wide weapon skin: its sword). Nothing the guild
// hands out is power: the horse travels at its catalog tier like every special mount, and a skin
// changes only a look.
//
// The week is the realm's weekly reset week (src/sim/weekly_quests.ts weeklyQuestWeekForResetDay),
// and the week's three are picked from the pools by its number alone: no randomness, so every
// host posts the same board and no seeded roll anywhere moves.

import type { ItemDef } from '../types';

export const LANTERN_SEAL_ITEM_ID = 'lantern_seal';

/** The guild's war horse (content/mounts.ts) and the reins that carry it. */
export const LANTERN_HALL_DESTRIER_KEY = 'lantern_hall_destrier';
export const LANTERN_HALL_DESTRIER_REINS_ID = 'reins_lantern_hall_destrier';
/** The guild's sword appearance (content/weapon_skins.ts). */
export const LANTERN_HALL_SWORD_SKIN_ID = 'lantern_hall_sword';

/** Garrick's prices for the horse and the sword, in Lantern Seals. PROVISIONAL: Jose's opening
 *  numbers (40 and 20), kept here so a retune is one line each. At the board's seven seals a
 *  week they are some six and three weeks of every contract. */
export const LANTERN_HALL_DESTRIER_SEALS = 40;
export const LANTERN_HALL_SWORD_SEALS = 20;

/** The currency's item def, RETIRED as a bag item: seals are a PlayerMeta counter
 *  (src/sim/lantern_seals.ts) like Heroic Marks, and the hub credits this id there. The def
 *  stays (a shipped id is never deleted) for its name and icon and so a legacy bag or bank
 *  stack still loads before it is folded into the balance. */
export const GUILD_CONTRACT_ITEMS: Record<string, ItemDef> = {
  [LANTERN_SEAL_ITEM_ID]: {
    id: LANTERN_SEAL_ITEM_ID,
    name: 'Lantern Seal',
    kind: 'tool',
    quality: 'rare',
    // a season's seals in one bag slot
    stackSize: 100,
    sellValue: 0,
    // bound to the earner: seals are spent at Lantern Hall's quartermaster, never traded,
    // mailed, listed or destroyed
    soulbound: true,
    noDiscard: true,
  },
  // Lantern Hall's war horse. Reins follow the player-mount policy (tests/mounts.test.ts): kept
  // (never discarded or sold to a vendor), unbound, the reins quality matching the catalog
  // rarity. No buyValue: the only price is the quartermaster's seals.
  [LANTERN_HALL_DESTRIER_REINS_ID]: {
    id: LANTERN_HALL_DESTRIER_REINS_ID,
    name: 'Reins of the Lantern Hall Destrier',
    kind: 'mount',
    mount: LANTERN_HALL_DESTRIER_KEY,
    quality: 'uncommon',
    noVendorSell: true,
    noDiscard: true,
    sellValue: 0,
  },
};

export type GuildContractKind = 'boss' | 'heroic' | 'task';

export interface GuildContractDef {
  id: string;
  kind: GuildContractKind;
  /** The five-player dungeon it sends you to (DUNGEONS id). */
  dungeonId: string;
  /** 'boss' and 'task': the boss whose death credits it (a MobTemplate id). 'heroic': the
   *  dungeon's final boss. */
  mobId: string;
  /** 'task': the encounter deed whose condition the kill must meet (src/sim/deeds.ts). */
  taskDeedId?: string;
  /** Lantern Seals paid on completion. */
  seals: number;
}

/** Seals by kind: a named boss is an evening, a heroic clear or a clean execution a night. */
export const GUILD_CONTRACT_SEALS: Readonly<Record<GuildContractKind, number>> = {
  boss: 1,
  heroic: 3,
  task: 3,
};

const boss = (dungeonId: string, mobId: string): GuildContractDef => ({
  id: `gc_boss_${mobId}`,
  kind: 'boss',
  dungeonId,
  mobId,
  seals: GUILD_CONTRACT_SEALS.boss,
});

/** The named bosses of the five dungeons (src/sim/content/dungeon_finder.ts encounter order).
 *  The Mere Hydra is left out: its heads die one by one and only the last fells it. */
export const GUILD_BOSS_CONTRACTS: readonly GuildContractDef[] = [
  boss('hollow_crypt', 'sexton_marrow'),
  boss('hollow_crypt', 'rimeweb'),
  boss('hollow_crypt', 'cantor_ilvane'),
  boss('hollow_crypt', 'morthen'),
  boss('sunken_bastion', 'knight_commander_olen'),
  boss('sunken_bastion', 'gaol_turnkey'),
  boss('sunken_bastion', 'gaoler_ossick'),
  boss('sunken_bastion', 'vael_the_mistcaller'),
  boss('drowned_temple', 'choirmother_selthe'),
  boss('drowned_temple', 'tideglass_colossus'),
  boss('drowned_temple', 'ysolei'),
  boss('gravewyrm_sanctum', 'korgath_the_bound'),
  boss('gravewyrm_sanctum', 'grand_necromancer_velkhar'),
  boss('gravewyrm_sanctum', 'korzul_the_gravewyrm'),
  boss('wildheart_basin', 'wildheart_beastmaster'),
  boss('wildheart_basin', 'the_gorgebloom'),
  boss('wildheart_basin', 'wildheart_high_priest'),
];

const heroic = (dungeonId: string, mobId: string): GuildContractDef => ({
  id: `gc_heroic_${dungeonId}`,
  kind: 'heroic',
  dungeonId,
  mobId,
  seals: GUILD_CONTRACT_SEALS.heroic,
});

/** One Heroic clear per dungeon, credited on its final boss (deeds.ts FINAL_BOSS_DUNGEONS). */
export const GUILD_HEROIC_CONTRACTS: readonly GuildContractDef[] = [
  heroic('hollow_crypt', 'morthen'),
  heroic('sunken_bastion', 'vael_the_mistcaller'),
  heroic('drowned_temple', 'ysolei'),
  heroic('gravewyrm_sanctum', 'korzul_the_gravewyrm'),
  heroic('wildheart_basin', 'wildheart_high_priest'),
];

const task = (dungeonId: string, mobId: string, taskDeedId: string): GuildContractDef => ({
  id: `gc_task_${taskDeedId}`,
  kind: 'task',
  dungeonId,
  mobId,
  taskDeedId,
  seals: GUILD_CONTRACT_SEALS.task,
});

/** The five dungeons' encounter skill tasks the deeds evaluator already judges at the boss's
 *  death (deeds.ts FLAWLESS_TASKS, ADD_TASKS, SPLASH_TASKS). */
export const GUILD_TASK_CONTRACTS: readonly GuildContractDef[] = [
  task('hollow_crypt', 'morthen', 'dgn_morthen_flawless'),
  task('sunken_bastion', 'knight_commander_olen', 'dgn_olen_arc'),
  task('sunken_bastion', 'vael_the_mistcaller', 'dgn_vael_thralls'),
  task('drowned_temple', 'ysolei', 'dgn_ysolei_moonspawn'),
  task('drowned_temple', 'ysolei', 'dgn_ysolei_flawless'),
  task('gravewyrm_sanctum', 'grand_necromancer_velkhar', 'dgn_velkhar_bonewalkers'),
  task('gravewyrm_sanctum', 'korzul_the_gravewyrm', 'dgn_korzul_flawless'),
];

export const GUILD_CONTRACTS: readonly GuildContractDef[] = [
  ...GUILD_BOSS_CONTRACTS,
  ...GUILD_HEROIC_CONTRACTS,
  ...GUILD_TASK_CONTRACTS,
];

export const GUILD_CONTRACTS_BY_ID: Readonly<Record<string, GuildContractDef>> = Object.freeze(
  Object.fromEntries(GUILD_CONTRACTS.map((contract) => [contract.id, contract])),
);

/** The contracts-completed milestones the Book of Deeds records (content/deeds.ts). */
export const GUILD_CONTRACT_MILESTONES: readonly { count: number; deedId: string }[] = [
  { count: 1, deedId: 'dgn_guild_first_contract' },
  { count: 10, deedId: 'dgn_guild_ten_contracts' },
  { count: 50, deedId: 'dgn_guild_fifty_contracts' },
];

/** One thing Garrick sells. Every arm costs seals and is cosmetic; what it grants differs:
 *  - 'title': a Book of Deeds feat whose reward is the title (deeds.ts grantDeed);
 *  - 'mount': a reins item into the bags (the mount is owned while the reins are held);
 *  - 'weaponSkin': an ACCOUNT-wide weapon appearance (the host owns that ledger, see
 *    src/sim/guild_quartermaster.ts GuildAccountPort). */
export type GuildQuartermasterOffer =
  | { id: string; kind: 'title'; deedId: string; seals: number }
  | { id: string; kind: 'mount'; itemId: string; seals: number }
  | { id: string; kind: 'weaponSkin'; skinId: string; seals: number };

/** Garrick Holt's stock: three titles cheapest first, then the guild's sword and its horse. The
 *  titles are some six weeks of every contract (seven seals a week). The four elemental arms
 *  once sold here (Hearthbrand, Squallcrest, Rimelight, Duskwick) are RESERVED as loot for a
 *  future raid (content/weapon_skins.ts earnedFrom 'future_raid') and are not stocked. */
export const GUILD_QUARTERMASTER_STOCK: readonly GuildQuartermasterOffer[] = [
  { id: 'title_writ_runner', kind: 'title', deedId: 'feat_guild_writ_runner', seals: 6 },
  { id: 'title_hallsworn', kind: 'title', deedId: 'feat_guild_hallsworn', seals: 14 },
  { id: 'title_of_lantern_hall', kind: 'title', deedId: 'feat_guild_of_lantern_hall', seals: 24 },
  {
    id: 'weapon_skin_lantern_hall_sword',
    kind: 'weaponSkin',
    skinId: LANTERN_HALL_SWORD_SKIN_ID,
    seals: LANTERN_HALL_SWORD_SEALS,
  },
  {
    id: 'mount_lantern_hall_destrier',
    kind: 'mount',
    itemId: LANTERN_HALL_DESTRIER_REINS_ID,
    seals: LANTERN_HALL_DESTRIER_SEALS,
  },
];

export const GUILD_QUARTERMASTER_STOCK_BY_ID: Readonly<Record<string, GuildQuartermasterOffer>> =
  Object.freeze(Object.fromEntries(GUILD_QUARTERMASTER_STOCK.map((offer) => [offer.id, offer])));
