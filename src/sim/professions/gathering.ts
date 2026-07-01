import type { Rng } from '../rng';
import type { ItemDef } from '../types';

type ItemQuality = NonNullable<ItemDef['quality']>;

export type GatheringMaterialRarity = Exclude<ItemQuality, 'poor'>;

export type GatheringRarityDistribution = Record<GatheringMaterialRarity, number>;

export const GATHERING_RARITY_PROFICIENCY_CAP = 300;

export const GATHERING_MATERIAL_RARITIES: readonly GatheringMaterialRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const;

interface RarityBand {
  proficiency: number;
  distribution: GatheringRarityDistribution;
}

export const GATHERING_RARITY_BANDS: readonly RarityBand[] = [
  {
    proficiency: 0,
    distribution: { common: 0.9, uncommon: 0.1, rare: 0, epic: 0, legendary: 0 },
  },
  {
    proficiency: 75,
    distribution: { common: 0.7, uncommon: 0.24, rare: 0.05, epic: 0.01, legendary: 0 },
  },
  {
    proficiency: 150,
    distribution: { common: 0.5, uncommon: 0.34, rare: 0.13, epic: 0.025, legendary: 0.005 },
  },
  {
    proficiency: 225,
    distribution: { common: 0.32, uncommon: 0.38, rare: 0.23, epic: 0.06, legendary: 0.01 },
  },
  {
    proficiency: GATHERING_RARITY_PROFICIENCY_CAP,
    distribution: { common: 0.2, uncommon: 0.4, rare: 0.28, epic: 0.1, legendary: 0.02 },
  },
] as const;

const ROLL_EDGE_EPSILON = 1e-12;

function clampProficiency(proficiency: number): number {
  if (!Number.isFinite(proficiency)) return 0;
  return Math.min(GATHERING_RARITY_PROFICIENCY_CAP, Math.max(0, proficiency));
}

function interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function gatheringRarityDistribution(proficiency: number): GatheringRarityDistribution {
  const p = clampProficiency(proficiency);

  for (let i = 0; i < GATHERING_RARITY_BANDS.length - 1; i++) {
    const from = GATHERING_RARITY_BANDS[i];
    const to = GATHERING_RARITY_BANDS[i + 1];
    if (p < to.proficiency) {
      const t = (p - from.proficiency) / (to.proficiency - from.proficiency);
      return {
        common: interpolate(from.distribution.common, to.distribution.common, t),
        uncommon: interpolate(from.distribution.uncommon, to.distribution.uncommon, t),
        rare: interpolate(from.distribution.rare, to.distribution.rare, t),
        epic: interpolate(from.distribution.epic, to.distribution.epic, t),
        legendary: interpolate(from.distribution.legendary, to.distribution.legendary, t),
      };
    }
  }

  return GATHERING_RARITY_BANDS[GATHERING_RARITY_BANDS.length - 1].distribution;
}

export function rollGatheringMaterialRarity(
  proficiency: number,
  rng: Pick<Rng, 'next'>,
): GatheringMaterialRarity {
  const distribution = gatheringRarityDistribution(proficiency);
  const roll = rng.next();
  let cumulative = 0;

  for (const rarity of GATHERING_MATERIAL_RARITIES) {
    cumulative += distribution[rarity];
    if (roll + ROLL_EDGE_EPSILON < cumulative) return rarity;
  }

  return 'legendary';
}
