// Limited relics: true-scarcity drops with a HARD global supply cap. Each item
// here sets ItemDef.limitedSupply, so every dropped copy mints a 1-based
// ItemInstancePayload.serial (loot/limited_gate.ts) and, once the cap is
// exhausted anywhere in the world (the server's cross-realm serial ledger, or a
// single offline world's ledger), the item never drops again: the loot roll
// substitutes the registered LIMITED_FALLBACK instead. Unlike the standard
// heroic set, these relics sit OFF the epic-armor ladder (a legendary weapon,
// jewelry, a trophy helm), so they deliberately live in this separate table
// (consulted by loot/loot_roll.ts appendLimitedDrops as an append-only roll
// phase) rather than in a boss's main loot array or HEROIC_BOSS_LOOT: the
// existing tables and their parity goldens / item-level sweep stay untouched.
//
// Stat budgets are derived from the repo's own item-level pipeline
// (item_level.ts / item_budget.ts), not invented: each item is registered at a
// source level in LIMITED_ITEM_SOURCE below, and its primary-stat sum equals
// primaryStatBudget(itemLevel, quality, slot). The math is spelled out per item.
// Ratings (hit/crit/haste) sit OFF the primary-stat budget, matching the
// heroic-vendor jewelry and raid-weapon convention.

import type { ItemDef } from '../types';

// Combat rating seeds, matching the established tiers: the ilvl-26 heroic-vendor
// jewelry uses 25 (2.5%); the ilvl-29 raid gear seeds 20 (2.0%). Off the primary
// budget (like spellPower/hitRating elsewhere), so stat sums stay budget-exact.
const RELIC_JEWELRY_RATING = 25; // 25 rating = 2.5%
const RELIC_RAID_RATING = 20; // 20 rating = 2.0%

// Broad melee class list for the flagship weapon: str/agi wielders, mirroring the
// existing legendary kingsbane_last_oath (warrior/rogue/hunter/shaman/paladin).
const MELEE_WIELDERS = [
  'warrior',
  'paladin',
  'rogue',
  'hunter',
  'shaman',
] as ItemDef['requiredClass'];
const CASTERS = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];
const HEAL_HYBRID = ['paladin', 'priest', 'shaman', 'druid'] as ItemDef['requiredClass'];

export const LIMITED_ITEMS: Record<string, ItemDef> = {
  // ================= Emberfall Edge (heroic Nythraxis, 25 will ever exist) =====
  // Legendary one-hand sword, source level 27 (the heroic raid tier), legendary
  // ilvl bonus +10 -> item level 37. primaryStatBudget(37, legendary, mainhand)
  // = round(37 x 1.9 x 1.0 x 0.7) = round(49.21) = 49 primary points (one-hand,
  // no two-hand multiplier). weaponDpsBudget(37) = 6.7 + 0.3 x 37 = 17.8 dps: at
  // speed 2.6 the avg swing is 17.8 x 2.6 = 46.3, so min 37 / max 56 (avg 46.5 ->
  // 17.88 dps, within scaleWeaponDamage rounding). The definitive melee weapon in
  // the game, gated behind the hardest content and a supply of 25.
  emberfall_edge: {
    id: 'emberfall_edge',
    name: 'Emberfall Edge',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'legendary',
    heroic: true,
    limitedSupply: 25,
    requiredLevel: 20,
    weapon: { min: 37, max: 56, speed: 2.6 },
    // 49-point legendary mainhand budget: a str-forward melee identity (str 24,
    // agi 10, sta 15) that stays usable across the MELEE_WIELDERS group.
    stats: { str: 24, agi: 10, sta: 15 },
    hitRating: RELIC_RAID_RATING,
    critRating: RELIC_RAID_RATING,
    sellValue: 30000,
    requiredClass: MELEE_WIELDERS,
    // Emberfall: a weapon strike may erupt in fire that leaps to nearby foes and
    // leaves a burn, one tier above kingsbane's Chain Arc (nature 42, ilvl 33).
    weaponProcs: [
      {
        id: 'emberfall_burst',
        name: 'Emberfall',
        trigger: 'weaponHit',
        chance: 0.12,
        effects: [
          { kind: 'chainArc', school: 'fire', damage: 50, jumps: 3, falloff: 0.6, radius: 8 },
          { kind: 'dot', name: 'Emberburn', school: 'fire', perTick: 14, interval: 2, duration: 8 },
        ],
      },
    ],
  },

  // ========= Crown of the Thornpeak Scourge (Nythraxis, 100 will ever exist) ===
  // Epic cloth helmet, source level 20 with the raid flag: epic bonus +6 plus the
  // raid item-level bonus +3 -> item level 29 (the Nythraxis raid epic tier).
  // primaryStatBudget(29, epic, helmet) = round(29 x 1.0 x 0.85 x 0.7) =
  // round(17.255) = 17 primary points (int 10 + sta 7). Fills the caster crown
  // niche the raid otherwise lacks; drops on BOTH normal and heroic Nythraxis.
  crown_of_the_thornpeak_scourge: {
    id: 'crown_of_the_thornpeak_scourge',
    name: 'Crown of the Thornpeak Scourge',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'epic',
    limitedSupply: 100,
    requiredLevel: 20,
    // Cloth helmet armor at this tier (soulflame cloth line ~120 at ilvl 29).
    stats: { armor: 120, int: 10, sta: 7 },
    critRating: RELIC_RAID_RATING,
    sellValue: 15000,
    requiredClass: CASTERS,
  },

  // ============ Thunzharr's Stormheart (world boss, 150 will ever exist) =======
  // Epic neck, source level 20 with the raid flag (a world boss is raid-tier) ->
  // item level 29. Jewelry carries no armor. primaryStatBudget(29, epic, neck) =
  // round(29 x 1.0 x 0.65 x 0.7) = round(13.195) = 13 primary points (agi 8 +
  // sta 5). A storm-charged agility neck; haste rating fits the lightning theme.
  thunzharrs_stormheart: {
    id: 'thunzharrs_stormheart',
    name: "Thunzharr's Stormheart",
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    limitedSupply: 150,
    requiredLevel: 20,
    stats: { agi: 8, sta: 5 },
    hasteRating: RELIC_JEWELRY_RATING,
    sellValue: 15000,
  },

  // =============== Sealed Vault Signets (heroic dungeons, 200 each) ============
  // Epic rings, source level 25 (the five-man heroic tier) -> item level 31.
  // primaryStatBudget(31, epic, ring) = round(31 x 1.0 x 0.6 x 0.7) =
  // round(13.02) = 13 primary points each. One per heroic dungeon final boss,
  // each a distinct archetype identity, heroic-only, 200 copies apiece.
  sealed_vault_signet_crypt: {
    id: 'sealed_vault_signet_crypt',
    name: 'Sealed Signet of the Hollow Crypt',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    heroic: true,
    limitedSupply: 200,
    requiredLevel: 20,
    stats: { str: 8, sta: 5 },
    hitRating: RELIC_JEWELRY_RATING,
    sellValue: 12000,
  },
  sealed_vault_signet_bastion: {
    id: 'sealed_vault_signet_bastion',
    name: 'Sealed Signet of the Sunken Bastion',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    heroic: true,
    limitedSupply: 200,
    requiredLevel: 20,
    stats: { int: 8, sta: 5 },
    critRating: RELIC_JEWELRY_RATING,
    sellValue: 12000,
  },
  sealed_vault_signet_temple: {
    id: 'sealed_vault_signet_temple',
    name: 'Sealed Signet of the Drowned Temple',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    heroic: true,
    limitedSupply: 200,
    requiredLevel: 20,
    stats: { int: 7, spi: 6 },
    hasteRating: RELIC_JEWELRY_RATING,
    sellValue: 12000,
    requiredClass: HEAL_HYBRID,
  },
  sealed_vault_signet_sanctum: {
    id: 'sealed_vault_signet_sanctum',
    name: 'Sealed Signet of the Gravewyrm Sanctum',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    heroic: true,
    limitedSupply: 200,
    requiredLevel: 20,
    stats: { agi: 8, sta: 5 },
    hitRating: RELIC_JEWELRY_RATING,
    sellValue: 12000,
  },
};

// Where each relic registers in the item-level source index (item_level.ts reads
// this so a relic's tooltip item level and budget derive like any other drop):
// the level of the content it drops from, plus whether that source is a raid.
export const LIMITED_ITEM_SOURCE: Record<string, { level: number; raid: boolean }> = {
  emberfall_edge: { level: 27, raid: false }, // heroic raid tier -> ilvl 37 (legendary)
  crown_of_the_thornpeak_scourge: { level: 20, raid: true }, // Nythraxis raid epic -> ilvl 29
  thunzharrs_stormheart: { level: 20, raid: true }, // world boss raid tier -> ilvl 29
  sealed_vault_signet_crypt: { level: 25, raid: false }, // five-man heroic -> ilvl 31
  sealed_vault_signet_bastion: { level: 25, raid: false },
  sealed_vault_signet_temple: { level: 25, raid: false },
  sealed_vault_signet_sanctum: { level: 25, raid: false },
};

// The non-limited consolation each relic degrades to once its supply is spent.
// Every fallback is an existing epic from the SAME boss's pool, so an exhausted
// relic still drops a comparable, tier-appropriate reward rather than nothing.
export const LIMITED_FALLBACK: Record<string, string> = {
  emberfall_edge: 'deathless_greatblade', // heroic Nythraxis epic 2H weapon
  crown_of_the_thornpeak_scourge: 'crownforged_dreadhelm', // Nythraxis raid epic helm
  thunzharrs_stormheart: 'nighttalon_grips', // Thunzharr agile epic glove
  sealed_vault_signet_crypt: 'morthens_cryptforged_hauberk', // Morthen heroic epic
  sealed_vault_signet_bastion: 'tidebound_spaulders', // Vael heroic epic
  sealed_vault_signet_temple: 'tidewoven_trousers', // Ysolei heroic epic
  sealed_vault_signet_sanctum: 'shroud_of_the_gravewyrm', // Korzul heroic epic
};

// A single limited-relic drop attached to a boss. Independent of that boss's
// main loot table: appendLimitedDrops rolls each entry with one ctx.rng.chance
// AFTER every normal/heroic draw, and a win is gated by the global supply.
export interface LimitedDropEntry {
  itemId: string;
  chance: number; // 0..1, per kill (per contributor for a world boss)
  // Only rolls when the kill is a heroic claim (the heroic dungeon / raid
  // relics). Skipped WITHOUT drawing rng otherwise, so a normal kill's draw
  // order never depends on it.
  heroicOnly?: boolean;
}

// Keyed by the boss's mob templateId (the same ids HEROIC_BOSS_LOOT uses for the
// dungeon final bosses). Chances are deliberately low: these are the rarest
// drops in the game, and the hard cap is the real gate.
export const LIMITED_DROPS: Record<string, LimitedDropEntry[]> = {
  nythraxis_scourge_of_thornpeak: [
    { itemId: 'crown_of_the_thornpeak_scourge', chance: 0.1 },
    { itemId: 'emberfall_edge', chance: 0.05, heroicOnly: true },
  ],
  thunzharr_waking_peak: [{ itemId: 'thunzharrs_stormheart', chance: 0.04 }],
  morthen: [{ itemId: 'sealed_vault_signet_crypt', chance: 0.06, heroicOnly: true }],
  vael_the_mistcaller: [{ itemId: 'sealed_vault_signet_bastion', chance: 0.06, heroicOnly: true }],
  ysolei: [{ itemId: 'sealed_vault_signet_temple', chance: 0.06, heroicOnly: true }],
  korzul_the_gravewyrm: [{ itemId: 'sealed_vault_signet_sanctum', chance: 0.06, heroicOnly: true }],
};
