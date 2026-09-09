// Two equipment slots per Nythraxis kill. Both difficulties share the first
// pool; Normal rolls the second epic pool, while Heroic replaces it with
// its existing exclusive weapon pool. Relative epic weights aggregate the
// old groups; both legendary chances remain exactly 3% in the shared slot.
import { weightedLootGroup } from '../loot/weighted_loot_group';
import type { LootEntry } from '../types';

const EPIC_WEIGHTS = [
  ['bonewrought_greatsword', 13],
  ['crownforged_dreadhelm', 54],
  ['nighttalon_crown', 54],
  ['soulflame_cowl', 26],
  ['stormcallers_crown', 26],
  ['nighttalon_shoulderguards', 54],
  ['soulflame_mantle', 54],
  ['bonewrought_bulwark', 13],
  ['crownforged_warspaulders', 28],
  ['stormcallers_spaulders', 28],
  ['wraithfire_orb', 14],
  ['direfang_quiver', 14],
  ['direfang_greatblade', 16],
  ['maul_of_the_scourged_wilds', 25],
  ['bramblehide_crown', 8],
  ['bramblehide_mantle', 8],
  ['bramblehide_harness', 8],
  ['bramblehide_cinch', 8],
  ['bramblehide_legguards', 8],
  ['bramblehide_grips', 8],
  ['bramblehide_treads', 8],
  ['courtiers_bonefang', 15],
  ['thornpeak_wardblade', 15],
  ['gravecourt_hewer', 14],
  ['votive_ward_of_the_deathless_court', 14],
  ['thornpeak_moonhide_cowl', 14],
  ['stormhymn_chain_grips', 14],
  ['stormhymn_chain_treads', 14],
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
