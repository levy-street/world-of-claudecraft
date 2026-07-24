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
    weights: { common: 0.7, magic: 0.245, rare: 0.05, epic: 0.0048, legendary: 0.0002 },
  },
  initial_rare: {
    id: 'initial_rare',
    weights: { magic: 0.6, rare: 0.36, epic: 0.038, legendary: 0.002 },
  },
  initial_dungeon_boss: {
    id: 'initial_dungeon_boss',
    weights: { magic: 0.25, rare: 0.61, epic: 0.13, legendary: 0.01 },
  },
};
