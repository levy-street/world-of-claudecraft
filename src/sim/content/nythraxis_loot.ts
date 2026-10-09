// Two equipment slots per Nythraxis kill. Both difficulties share the first
// pool; Normal rolls the second epic pool, while Heroic replaces it with
// its existing exclusive weapon pool. Relative epic weights aggregate the
// old groups; both legendary chances remain exactly 3% in the shared slot.
//
// The raid keeps a short table: the two legendaries plus nine pieces. The
// nineteen low-weight pieces that once diluted it (the Roots' Bramblehide set,
// the rarer weapons and offhands, the Moonhide Cowl and the Stormhymn pair)
// moved to the dungeons: their Normal copies to the Gravewyrm Sanctum and
// Wildheart Basin bosses, their Heroic copies to the heroic five-man bosses
// (content/heroic_loot.ts). Pinned by tests/nythraxis_loot_budget.test.ts.
import { weightedLootGroup } from '../loot/weighted_loot_group';
import type { LootEntry } from '../types';

const EPIC_WEIGHTS = [
  ['crownforged_dreadhelm', 54],
  ['nighttalon_crown', 54],
  ['soulflame_cowl', 26],
  ['stormcallers_crown', 26],
  ['nighttalon_shoulderguards', 54],
  ['soulflame_mantle', 54],
  ['crownforged_warspaulders', 28],
  ['stormcallers_spaulders', 28],
  ['maul_of_the_scourged_wilds', 25],
] as const;

// The nineteen raid pieces relocated to the dungeons. They keep the raid tier
// they shipped at: item level 29 for the Normal copy and 33 for the Heroic
// copy, whatever boss now drops them (item_level.ts buildSourceIndex and
// content/heroic_variants.ts both anchor on this list), so no owned copy
// changes its level or stats.
export const NYTHRAXIS_RELOCATED_ITEM_IDS = [
  'bonewrought_greatsword',
  'bonewrought_bulwark',
  'wraithfire_orb',
  'direfang_quiver',
  'direfang_greatblade',
  'bramblehide_crown',
  'bramblehide_mantle',
  'bramblehide_harness',
  'bramblehide_cinch',
  'bramblehide_legguards',
  'bramblehide_grips',
  'bramblehide_treads',
  'courtiers_bonefang',
  'thornpeak_wardblade',
  'gravecourt_hewer',
  'votive_ward_of_the_deathless_court',
  'thornpeak_moonhide_cowl',
  'stormhymn_chain_grips',
  'stormhymn_chain_treads',
] as const;

// The four heroic raid trinkets relocated to heroic five-man bosses
// (content/heroic_loot.ts). Same promise: they keep the raid tier, item level 33.
export const NYTHRAXIS_RELOCATED_TRINKET_IDS = [
  'mooring_stone',
  'wellspring_seed',
  'hunters_tally',
  'echoing_lens',
] as const;

export const NYTHRAXIS_EQUIPMENT_LOOT: LootEntry[] = [
  ...weightedLootGroup('nythraxis_drop_1', EPIC_WEIGHTS, [
    { itemId: 'deathless_heartwood', chance: 0.03 },
    { itemId: 'kingsbane_last_oath', chance: 0.03 },
  ]),
  ...weightedLootGroup('nythraxis_drop_2', EPIC_WEIGHTS).map((entry) => ({
    ...entry,
    normalOnly: true as const,
  })),
];
