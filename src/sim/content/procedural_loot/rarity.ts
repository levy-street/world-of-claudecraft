import type { RarityDefinition, RarityTable } from './types';

export const PROCEDURAL_RARITIES = {
  common: {
    id: 'common',
    affixCounts: [{ count: 0, weight: 1 }],
    budgetMultiplier: 0,
    rollFloor: 0,
  },
  magic: {
    id: 'magic',
    affixCounts: [
      { count: 1, weight: 0.55 },
      { count: 2, weight: 0.45 },
    ],
    budgetMultiplier: 0.7,
    rollFloor: 0,
  },
  rare: {
    id: 'rare',
    affixCounts: [
      { count: 3, weight: 0.65 },
      { count: 4, weight: 0.35 },
    ],
    budgetMultiplier: 1,
    rollFloor: 0.15,
  },
  epic: {
    id: 'epic',
    affixCounts: [
      { count: 4, weight: 0.55 },
      { count: 5, weight: 0.45 },
    ],
    budgetMultiplier: 1.25,
    rollFloor: 0.35,
  },
  legendary: {
    id: 'legendary',
    affixCounts: [
      { count: 3, weight: 0.65 },
      { count: 4, weight: 0.35 },
    ],
    budgetMultiplier: 1.2,
    rollFloor: 0.5,
  },
} as const satisfies Record<string, RarityDefinition>;

export const PROCEDURAL_RARITY_TABLES: Record<string, RarityTable> = {
  initial_world: {
    id: 'initial_world',
    // The deterministic contribution campaign gates this activation. Keep the
    // very rare world rate as broad-chase excitement without displacing normal
    // progression; dungeon bosses remain the primary legendary source.
    weights: { common: 0.7, magic: 0.245, rare: 0.05, epic: 0.00496, legendary: 0.00004 },
  },
  initial_rare: {
    id: 'initial_rare',
    weights: { magic: 0.6, rare: 0.36, epic: 0.039998, legendary: 0.000002 },
  },
  initial_delve_elite: {
    id: 'initial_delve_elite',
    // The 20% entry gate makes this a 0.0009% effective Legendary chance.
    weights: { magic: 0.6, rare: 0.36, epic: 0.039955, legendary: 0.000045 },
  },
  initial_dungeon_boss: {
    id: 'initial_dungeon_boss',
    // Dungeon and delve bosses always add one procedural entry. Authored normal
    // and Heroic loot still rolls independently from this 0.008% Legendary chase.
    weights: { magic: 0.25, rare: 0.6, epic: 0.14992, legendary: 0.00008 },
  },
  nythraxis_raid_normal: {
    id: 'nythraxis_raid_normal',
    // Normal Nythraxis is endgame content, so it cannot fall back to Magic gear.
    weights: { rare: 0.65, epic: 0.33, legendary: 0.02 },
  },
  nythraxis_raid_heroic: {
    id: 'nythraxis_raid_heroic',
    // Heroic is a real progression step: 2.5x the Normal Legendary rate and a
    // substantially stronger Epic share, while authored rewards roll beside it.
    weights: { rare: 0.4, epic: 0.55, legendary: 0.05 },
  },
};
