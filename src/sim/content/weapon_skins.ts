// Season 1 Armory: purchasable weapon-skin cosmetics (paid tiers only; the free
// Wrought Iron commons are not sold and are not listed here). Source of truth for
// the mechanical catalog. Player-visible names, looks, and lore live in
// src/ui/i18n.catalog/armory.ts. The economy service is authoritative for price
// and availability. Skins are ACCOUNT-wide unlocks bought
// with Claudium through the economy service; the skin id doubles as the economy
// SKU item id (kind 'skin'), so ids here must stay in lockstep with the service
// catalog. Cosmetic only: a skin never changes weapon stats, reach, or speed.
//
// `model` is the held-model basename under public/models/weapons/<model>.glb
// (registered in src/render/characters/assets.ts and, for rare and above, in the
// WEAPON_VFX spec map in src/render/weapon_vfx.ts). The sim never loads models;
// it carries the key so server and clients agree on what everyone sees.

import type { WeaponSkinType } from '../types';

export type { WeaponSkinType } from '../types';

export type WeaponSkinRarity = 'uncommon' | 'rare' | 'epic' | 'legendary';
export type WeaponSkinCollection =
  | 'guildmark'
  | 'emberwrought'
  | 'hoarfrost'
  | 'fallen_star'
  | 'lantern_hall'
  | 'smiths_heart';

/** The Smith's Heart encounter that awards a raid skin: the Hammer Council, the three guardians
 *  of the Breath, the Quench and the Heat, and the Masterless Strength on the Anvil. Each names
 *  the boss templates of content/smith_heart.ts (pinned in tests/smith_heart_raid_arms.test.ts),
 *  for the encounter feats that grant them (content/smith_heart_rewards.ts). */
export type SmithsHeartEncounter = 'hammer_council' | 'breath' | 'quench' | 'heat' | 'masterless';

export interface WeaponSkinDef {
  /** Store SKU / economy-service item id (kind 'skin'). */
  id: string;
  /** Stable collection id (one per rarity in Season 1). */
  collection: WeaponSkinCollection;
  rarity: WeaponSkinRarity;
  weaponType: WeaponSkinType;
  /** Held-model basename under public/models/weapons/. */
  model: string;
  season: 1;
  /** Collection flagship (epic) or hero (legendary) callout. */
  badge?: 'flagship' | 'hero';
  /** Ranged handling override: a bow-slot skin held and fired like a crossbow
   *  (the class's authored shoulder-aim attack, right-hand attach) instead of
   *  the drawn bow. Guns and launchers aim; they are not drawn. Cosmetic only:
   *  the sim never reads it. */
  handling?: 'crossbow';
  /** Earned in the world instead of sold in the Claudium Armory: the skin has no economy SKU
   *  and stays out of the store (STORE_WEAPON_SKIN_LIST). 'lantern_hall': Lantern Hall's
   *  quartermaster sells it for Lantern Seals (content/guild_contracts.ts). 'smiths_heart':
   *  earned in the Smith's Heart raid by the feat of the encounter `raidEncounter` names
   *  (src/sim/smith_heart_feat_rewards.ts): no store, vendor or drop, and no Reliquary row
   *  while the raid is dev-gated (RESERVED_WEAPON_SKIN_IDS, isGrantableWeaponSkin). */
  earnedFrom?: 'lantern_hall' | 'smiths_heart';
  /** For a Smith's Heart skin: the encounter whose defeat awards it. */
  raidEncounter?: SmithsHeartEncounter;
}

export const WEAPON_SKIN_TYPES: readonly WeaponSkinType[] = [
  'sword',
  'axe',
  'mace',
  'dagger',
  'staff',
  'wand',
  'bow',
  'crossbow',
];

export function isWeaponSkinType(value: string): value is WeaponSkinType {
  return (WEAPON_SKIN_TYPES as readonly string[]).includes(value);
}

export const WEAPON_SKIN_RARITY_ORDER: readonly WeaponSkinRarity[] = [
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

const S1 = {
  guildmark: 'guildmark',
  emberwrought: 'emberwrought',
  hoarfrost: 'hoarfrost',
  fallenStar: 'fallen_star',
} satisfies Record<string, WeaponSkinCollection>;

export const WEAPON_SKINS: Record<string, WeaponSkinDef> = {
  // ── Guildmark (Uncommon): signed armorer work, no enchantment ──
  guildmark_arming_sword: {
    id: 'guildmark_arming_sword',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'sword',
    model: 'guildmark_arming_sword',
    season: 1,
  },
  brasscap_axe: {
    id: 'brasscap_axe',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'axe',
    model: 'brasscap_hatchet',
    season: 1,
  },
  tempered_flanged_mace: {
    id: 'tempered_flanged_mace',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'mace',
    model: 'tempered_flanged_mace',
    season: 1,
  },
  guildmark_dirk: {
    id: 'guildmark_dirk',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'dagger',
    model: 'guildmark_dirk',
    season: 1,
  },
  brasscrown_staff: {
    id: 'brasscrown_staff',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'staff',
    model: 'brasscrown_walking_staff',
    season: 1,
  },
  lacquered_wand: {
    id: 'lacquered_wand',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'wand',
    model: 'lacquered_rod',
    season: 1,
  },
  fletcher_s_guild_bow: {
    id: 'fletcher_s_guild_bow',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'bow',
    model: 'fletcher_s_guild_bow',
    season: 1,
  },

  // ── Emberwrought (Rare): mountain-fire banked into the metal ──
  cinderbrand_sword: {
    id: 'cinderbrand_sword',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'sword',
    model: 'cinderbrand',
    season: 1,
  },
  emberbite_axe: {
    id: 'emberbite_axe',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'axe',
    model: 'emberbite',
    season: 1,
  },
  smoulderfall_mace: {
    id: 'smoulderfall_mace',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'mace',
    model: 'smoulderfall',
    season: 1,
  },
  ashspark_dagger: {
    id: 'ashspark_dagger',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'dagger',
    model: 'ashspark_shiv',
    season: 1,
  },
  forgeheart_staff: {
    id: 'forgeheart_staff',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'staff',
    model: 'forgeheart_stave',
    season: 1,
  },
  emberwrought_wand: {
    id: 'emberwrought_wand',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'wand',
    model: 'emberwrought_wand',
    season: 1,
  },
  cinderlatch_crossbow: {
    id: 'cinderlatch_crossbow',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'crossbow',
    model: 'cinderlatch',
    season: 1,
  },

  // ── Hoarfrost (Epic): carved and grown from Thornpeak glacier ──
  ice_fang_sword: {
    id: 'ice_fang_sword',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'sword',
    model: 'ice_fang',
    season: 1,
    badge: 'flagship',
  },
  glaciersplit_axe: {
    id: 'glaciersplit_axe',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'axe',
    model: 'glaciersplit',
    season: 1,
  },
  rimecrusher_mace: {
    id: 'rimecrusher_mace',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'mace',
    model: 'rimecrusher',
    season: 1,
  },
  frostbite_dagger: {
    id: 'frostbite_dagger',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'dagger',
    model: 'frostbite',
    season: 1,
  },
  hoarfrost_vigil_staff: {
    id: 'hoarfrost_vigil_staff',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'staff',
    model: 'hoarfrost_vigil',
    season: 1,
  },
  everwinter_wand: {
    id: 'everwinter_wand',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'wand',
    model: 'shard_of_everwinter',
    season: 1,
  },
  winterbite: {
    id: 'winterbite',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'bow',
    model: 'winterbite',
    season: 1,
  },

  // ── Fallen Star (Legendary): worked from the Mirefen crater ──
  solheim_sword: {
    id: 'solheim_sword',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'sword',
    model: 'solheim_last_light_of_the_dawn',
    season: 1,
    badge: 'hero',
  },
  skyrender_axe: {
    id: 'skyrender_axe',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'axe',
    model: 'skyrender_the_firmament_s_wound',
    season: 1,
  },
  starfall_mace: {
    id: 'starfall_mace',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'mace',
    model: 'starfall_judgment_of_the_heavens',
    season: 1,
  },
  astravyr_dagger: {
    id: 'astravyr_dagger',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'dagger',
    model: 'astravyr_fang_of_the_fallen_star',
    season: 1,
  },
  cosmarch_staff: {
    id: 'cosmarch_staff',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'staff',
    model: 'cosmarch_spire_of_the_endless_void',
    season: 1,
  },
  emberwish_wand: {
    id: 'emberwish_wand',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'wand',
    model: 'emberwish_mote_of_the_dying_sun',
    season: 1,
  },
  encore_bow: {
    id: 'encore_bow',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'bow',
    model: 'encore_the_second_falling_star',
    handling: 'crossbow',
    season: 1,
  },
  meteorlatch_crossbow: {
    id: 'meteorlatch_crossbow',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'crossbow',
    model: 'meteorlatch_the_sky_s_last_judgment',
    season: 1,
  },

  // ── Lantern Hall (earned): the guild's own arms, bought for Lantern Seals ──
  // Rare, so it carries the rare tier's banked-fire weapon glow (src/render/weapon_vfx.ts).
  lantern_hall_sword: {
    id: 'lantern_hall_sword',
    collection: 'lantern_hall',
    rarity: 'rare',
    weaponType: 'sword',
    model: 'lantern_hall_sword',
    season: 1,
    earnedFrom: 'lantern_hall',
  },
  // ── Smith's Heart (earned): one appearance per encounter of the raid ──
  // Built by scripts/assets/smith_heart_arms/, each with its element's VFX row
  // (src/render/weapon_vfx.ts). Hearthbrand, Squallcrest, the Rimelight Staff and the
  // duskwick_staff model were first made for Lantern Hall and held back for this raid; the raid
  // reforged them, and the ids stay frozen (duskwick_staff is now the Heartmeld Staff).
  seamcaller_maul: {
    id: 'seamcaller_maul',
    collection: 'smiths_heart',
    rarity: 'epic',
    weaponType: 'mace',
    model: 'seamcaller_maul',
    season: 1,
    earnedFrom: 'smiths_heart',
    raidEncounter: 'hammer_council',
  },
  squallcrest_sword: {
    id: 'squallcrest_sword',
    collection: 'smiths_heart',
    rarity: 'epic',
    weaponType: 'sword',
    model: 'squallcrest',
    season: 1,
    earnedFrom: 'smiths_heart',
    raidEncounter: 'breath',
  },
  rimelight_staff: {
    id: 'rimelight_staff',
    collection: 'smiths_heart',
    rarity: 'epic',
    weaponType: 'staff',
    model: 'rimelight_staff',
    season: 1,
    earnedFrom: 'smiths_heart',
    raidEncounter: 'quench',
  },
  hearthbrand_sword: {
    id: 'hearthbrand_sword',
    collection: 'smiths_heart',
    rarity: 'epic',
    weaponType: 'sword',
    model: 'hearthbrand',
    season: 1,
    earnedFrom: 'smiths_heart',
    raidEncounter: 'heat',
  },
  // The final encounter's staff is the set's legendary: the four elements together.
  duskwick_staff: {
    id: 'duskwick_staff',
    collection: 'smiths_heart',
    rarity: 'legendary',
    weaponType: 'staff',
    model: 'duskwick_staff',
    season: 1,
    earnedFrom: 'smiths_heart',
    raidEncounter: 'masterless',
  },
};

export const WEAPON_SKIN_LIST: readonly WeaponSkinDef[] = Object.values(WEAPON_SKINS);

/** The Smith's Heart skins: in the catalog (so the renderer, previews and VFX carry them),
 *  earned ONLY through the raid's encounter feats (src/sim/smith_heart_feat_rewards.ts, the
 *  server's AccountCosmeticsService.grantDeedRewardSkins). Every store list leaves them out. */
export const RESERVED_WEAPON_SKIN_IDS: readonly string[] = WEAPON_SKIN_LIST.filter(
  (skin) => skin.earnedFrom === 'smiths_heart',
).map((skin) => skin.id);

/** Which skin each Smith's Heart encounter awards, in encounter order. */
export const SMITHS_HEART_WEAPON_SKINS: Readonly<Record<SmithsHeartEncounter, string>> = {
  hammer_council: 'seamcaller_maul',
  breath: 'squallcrest_sword',
  quench: 'rimelight_staff',
  heat: 'hearthbrand_sword',
  masterless: 'duskwick_staff',
};

/** A catalog skin the economy and store paths may grant: every skin but the raid's, whose one
 *  lane is the deed-earned grant (the encounter feats). The server's economy grant and
 *  store-mirror paths gate on this, so an outside catalog can never hand one out. */
export function isGrantableWeaponSkin(skinId: string): boolean {
  return Object.hasOwn(WEAPON_SKINS, skinId) && WEAPON_SKINS[skinId].earnedFrom !== 'smiths_heart';
}

/** The skins the Claudium Armory sells: every skin that is not earned in the world. */
export const STORE_WEAPON_SKIN_LIST: readonly WeaponSkinDef[] = WEAPON_SKIN_LIST.filter(
  (skin) => !skin.earnedFrom,
);

/** The Armory's store collections, in shelf order (the earned Lantern Hall blade is not one). */
export const WEAPON_SKIN_COLLECTIONS: readonly WeaponSkinCollection[] = [
  S1.guildmark,
  S1.emberwrought,
  S1.hoarfrost,
  S1.fallenStar,
];
