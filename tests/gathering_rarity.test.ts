import { describe, expect, it } from 'vitest';
import {
  GATHERING_MATERIAL_RARITIES,
  type GatheringMaterialRarity,
  gatheringRarityDistribution,
  rollGatheringMaterialRarity,
} from '../src/sim/professions/gathering';
import { Rng } from '../src/sim/rng';

function stubRng(value: number): Pick<Rng, 'next'> {
  return { next: () => value };
}

function chanceAtLeast(
  distribution: Record<GatheringMaterialRarity, number>,
  rarity: GatheringMaterialRarity,
): number {
  const start = GATHERING_MATERIAL_RARITIES.indexOf(rarity);
  return GATHERING_MATERIAL_RARITIES.slice(start).reduce((sum, key) => sum + distribution[key], 0);
}

describe('professions gathering rarity roll', () => {
  it('pins the material rarity distribution at key proficiency bands', () => {
    expect(gatheringRarityDistribution(0)).toEqual({
      common: 0.9,
      uncommon: 0.1,
      rare: 0,
      epic: 0,
      legendary: 0,
    });
    expect(gatheringRarityDistribution(150)).toEqual({
      common: 0.5,
      uncommon: 0.34,
      rare: 0.13,
      epic: 0.025,
      legendary: 0.005,
    });
    expect(gatheringRarityDistribution(300)).toEqual({
      common: 0.2,
      uncommon: 0.4,
      rare: 0.28,
      epic: 0.1,
      legendary: 0.02,
    });
  });

  it('linearly interpolates between bands and clamps out-of-range proficiency', () => {
    expect(gatheringRarityDistribution(-25)).toEqual(gatheringRarityDistribution(0));
    expect(gatheringRarityDistribution(Number.NaN)).toEqual(gatheringRarityDistribution(0));
    expect(gatheringRarityDistribution(999)).toEqual(gatheringRarityDistribution(300));

    const mid = gatheringRarityDistribution(37.5);
    expect(mid.common).toBeCloseTo(0.8);
    expect(mid.uncommon).toBeCloseTo(0.17);
    expect(mid.rare).toBeCloseTo(0.025);
    expect(mid.epic).toBeCloseTo(0.005);
    expect(mid.legendary).toBe(0);
  });

  it('strictly does not lower the chance of any higher rarity as proficiency rises', () => {
    const thresholds: GatheringMaterialRarity[] = ['uncommon', 'rare', 'epic', 'legendary'];
    let previous = gatheringRarityDistribution(0);

    for (let proficiency = 15; proficiency <= 300; proficiency += 15) {
      const next = gatheringRarityDistribution(proficiency);
      for (const rarity of thresholds) {
        expect(chanceAtLeast(next, rarity), `${rarity}+ at ${proficiency}`).toBeGreaterThanOrEqual(
          chanceAtLeast(previous, rarity),
        );
      }
      previous = next;
    }
  });

  it('uses one Rng draw to choose the tier from the standard item rarity buckets', () => {
    let draws = 0;
    const rng = {
      next: () => {
        draws += 1;
        return 0.5;
      },
    };

    expect(rollGatheringMaterialRarity(300, rng)).toBe('uncommon');
    expect(draws).toBe(1);

    expect(rollGatheringMaterialRarity(300, stubRng(0))).toBe('common');
    expect(rollGatheringMaterialRarity(300, stubRng(0.19999))).toBe('common');
    expect(rollGatheringMaterialRarity(300, stubRng(0.2))).toBe('uncommon');
    expect(rollGatheringMaterialRarity(300, stubRng(0.59999))).toBe('uncommon');
    expect(rollGatheringMaterialRarity(300, stubRng(0.6))).toBe('rare');
    expect(rollGatheringMaterialRarity(300, stubRng(0.87999))).toBe('rare');
    expect(rollGatheringMaterialRarity(300, stubRng(0.88))).toBe('epic');
    expect(rollGatheringMaterialRarity(300, stubRng(0.97999))).toBe('epic');
    expect(rollGatheringMaterialRarity(300, stubRng(0.98))).toBe('legendary');
    expect(rollGatheringMaterialRarity(300, stubRng(0.99999))).toBe('legendary');
  });

  it('is deterministic with the shared sim Rng stream', () => {
    const a = new Rng(1122);
    const b = new Rng(1122);
    const sequenceA = Array.from({ length: 20 }, () => rollGatheringMaterialRarity(225, a));
    const sequenceB = Array.from({ length: 20 }, () => rollGatheringMaterialRarity(225, b));

    expect(sequenceA).toEqual(sequenceB);
  });
});
