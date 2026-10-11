// Treasure maps and vaults (world quests, Stage 3): the daily board's reward is
// a treasure map of a rolled rarity. Reading it marks a dig site; digging there
// opens a private vault (a short procedural Rift instance, src/sim/rift/) whose
// boss pays every entrant. The rarity picks the Rift rank, so a common map is a
// solo errand and a legendary one is worth calling friends for.
//
// Data-as-code. The engine is src/sim/treasure_vault.ts; every number below is
// a WORKING RULE to tune in playtests, never a classic-era formula.

import type { RiftTier } from '../types';

export const TREASURE_MAP_RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type TreasureMapRarity = (typeof TREASURE_MAP_RARITIES)[number];

export function isTreasureMapRarity(value: unknown): value is TreasureMapRarity {
  return (TREASURE_MAP_RARITIES as readonly unknown[]).includes(value);
}

/** The bag item for each rarity (ids are frozen once shipped). */
export const TREASURE_MAP_ITEM_IDS: Readonly<Record<TreasureMapRarity, string>> = Object.freeze({
  common: 'treasure_map_common',
  rare: 'treasure_map_rare',
  epic: 'treasure_map_epic',
  legendary: 'treasure_map_legendary',
});

/** The Rift rank a map's vault runs at. */
export const TREASURE_MAP_RIFT_TIER: Readonly<Record<TreasureMapRarity, RiftTier>> = Object.freeze({
  common: 'C',
  rare: 'B',
  epic: 'A',
  legendary: 'S',
});

/** Odds (out of 100) of each rarity when the daily board pays a map. */
export const TREASURE_MAP_DROP_WEIGHTS: Readonly<Record<TreasureMapRarity, number>> = Object.freeze(
  { common: 40, rare: 35, epic: 20, legendary: 5 },
);

/** The next rarity up, or null at the top. */
export function nextTreasureMapRarity(rarity: TreasureMapRarity): TreasureMapRarity | null {
  const index = TREASURE_MAP_RARITIES.indexOf(rarity);
  return TREASURE_MAP_RARITIES[index + 1] ?? null;
}

/** Cartographer's Ink: sold by every faction quartermaster for their own
 *  currency (src/sim/content/faction_vendors.ts); using it redraws the READ map
 *  one rarity finer. A higher-band world quest pays 10 currency, so a full day
 *  is about 140: two inks. */
export const CARTOGRAPHERS_INK_ITEM_ID = 'cartographers_ink';
export const CARTOGRAPHERS_INK_CURRENCY_COST = 60;
/** Inks one redraw spends, by the map's CURRENT rarity. Epic to legendary is the
 *  steep one (15 inks, about a week of full world-quest days): a legendary hoard
 *  pays a guaranteed piece above everything outside a raid. */
export const TREASURE_MAP_UPGRADE_INKS: Readonly<Record<TreasureMapRarity, number>> = Object.freeze(
  { common: 1, rare: 3, epic: 15, legendary: 0 },
);

/** The lowest level a Buried Hoard admits (the daily board's higher bracket). */
export const HOARD_MIN_LEVEL = 16;
/** How close (yards) the reader must stand to the X to dig. */
export const TREASURE_DIG_RADIUS = 12;
/** A vault portal nobody entered closes after this long (seconds). */
export const VAULT_PORTAL_LIFETIME = 600;
/** Vaults a character may be paid for as a GUEST (not the map's owner) per
 *  world-quest cycle. The owner's own maps are never capped. */
export const VAULT_GUEST_PAYOUTS_PER_CYCLE = 3;
/** Copper bonus the map's owner earns on top of the shared payout. */
export const VAULT_OWNER_COPPER_BONUS = 0.5;

/** Mob scaling by head count (1 to 5), applied on top of the Rift rank tuning,
 *  which is balanced for a full party: a solo reader fights roughly open-world
 *  strength, a full party the rank as authored. */
export function vaultHealthFactor(headCount: number): number {
  return 0.4 + 0.15 * (clampHeadCount(headCount) - 1);
}
export function vaultDamageFactor(headCount: number): number {
  return 0.3 + 0.175 * (clampHeadCount(headCount) - 1);
}
function clampHeadCount(headCount: number): number {
  return Math.max(1, Math.min(5, Math.floor(headCount) || 1));
}

export interface VaultPayoutDef {
  /** Multiplier on the level-scaled casket copper (src/sim/clue_casket.ts). */
  copperMult: number;
  /** Units of one top-tier gathered material. */
  materials: number;
  /** Odds the map's OWNER takes one piece off the fallen boss's own table
   *  (content/hoard_loot.ts), at the tier the map's rarity buys. */
  gearChance: number;
  /** Odds of a Heroic Mark stack, and its size. */
  markChance: number;
  marks: number;
  /** Odds of Grumbol the Lanternback (the vault-exclusive mount). */
  mountChance: number;
  /** Odds the boss also hides a map one rarity up. */
  nextMapChance: number;
}

/** What a cleared vault pays each entrant, by the map's rarity. The mount odds
 *  average about 1.3% across the drop weights above. */
export const VAULT_PAYOUTS: Readonly<Record<TreasureMapRarity, VaultPayoutDef>> = Object.freeze({
  common: {
    copperMult: 0.3,
    materials: 4,
    gearChance: 0.1,
    markChance: 0.05,
    marks: 2,
    mountChance: 0.01,
    nextMapChance: 0.15,
  },
  rare: {
    copperMult: 0.6,
    materials: 6,
    gearChance: 0.3,
    markChance: 0.1,
    marks: 2,
    mountChance: 0.015,
    nextMapChance: 0.1,
  },
  epic: {
    copperMult: 0.9,
    materials: 8,
    gearChance: 0.5,
    markChance: 0.25,
    marks: 3,
    mountChance: 0.025,
    nextMapChance: 0.05,
  },
  legendary: {
    copperMult: 1.3,
    materials: 12,
    gearChance: 1,
    markChance: 1,
    marks: 5,
    mountChance: 0.05,
    nextMapChance: 0,
  },
});

/** The same roll for a GUEST (anyone in the hoard who did not read the map):
 *  the owner paid for the map, so the owner's odds are the map's headline. */
export const VAULT_GUEST_GEAR_CHANCE: Readonly<Record<TreasureMapRarity, number>> = Object.freeze({
  common: 0.05,
  rare: 0.1,
  epic: 0.2,
  legendary: 0.4,
});

export interface TreasureSiteDef {
  id: string;
  zoneId: string;
  x: number;
  z: number;
}

/** The dig sites a map can mark: hidden spots near (never on) landmarks of the
 *  level 16+ zones, the same ground the clue hunts dig in. Ids are frozen once
 *  shipped (a read map persists its site id). */
export const TREASURE_SITES: readonly TreasureSiteDef[] = Object.freeze([
  { id: 'site_drakelands_ash_dunes', zoneId: 'drakelands', x: 350, z: 2085 },
  { id: 'site_frostveil_flat_snow', zoneId: 'frostveil', x: 118, z: 1790 },
  { id: 'site_amberfall_leaf_ring', zoneId: 'amberfall', x: -412, z: 2228 },
  { id: 'site_willowfen_dry_hummock', zoneId: 'willowfen', x: -266, z: 268 },
  { id: 'site_nightbloom_gloamfield', zoneId: 'nightbloom', x: -424, z: 1478 },
  { id: 'site_wraithwood_clearing', zoneId: 'wraithwood', x: 398, z: 1662 },
  { id: 'site_palmreach_heaped_sand', zoneId: 'palmreach', x: -402, z: 750 },
  { id: 'site_galecrest_cut_turf', zoneId: 'galecrest', x: 480, z: 326 },
]);

export const TREASURE_SITES_BY_ID: Readonly<Record<string, TreasureSiteDef>> = Object.freeze(
  Object.fromEntries(TREASURE_SITES.map((site) => [site.id, site])),
);

/** The map a character has read and not yet dug up. */
export interface TreasureMapProgress {
  rarity: TreasureMapRarity;
  siteId: string;
  /** The vault's Rift seed, fixed when the map is read (and re-picked on an
   *  upgrade, since the floor count depends on the rank). */
  seed: number;
}
