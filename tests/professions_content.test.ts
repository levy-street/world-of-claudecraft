import { describe, expect, it } from 'vitest';
import {
  adjacentProductionCrafts,
  areAdjacentProductionCrafts,
  GATHERING_PROFESSION_ORDER,
  GATHERING_PROFESSIONS,
  oppositeProductionCraft,
  PRODUCTION_CRAFT_RING,
  PRODUCTION_CRAFTS,
  type ProductionCraftId,
  type ProductionCraftPole,
} from '../src/sim/content/professions';

const EXPECTED_RING: readonly ProductionCraftId[] = [
  'weaponcrafting',
  'armorcrafting',
  'engineering',
  'alchemy',
  'cooking',
  'leatherworking',
  'tailoring',
  'inscription',
  'enchanting',
  'jewelcrafting',
];

const EXPECTED_ADJACENCY: Record<
  ProductionCraftId,
  readonly [ProductionCraftId, ProductionCraftId]
> = {
  weaponcrafting: ['jewelcrafting', 'armorcrafting'],
  armorcrafting: ['weaponcrafting', 'engineering'],
  engineering: ['armorcrafting', 'alchemy'],
  alchemy: ['engineering', 'cooking'],
  cooking: ['alchemy', 'leatherworking'],
  leatherworking: ['cooking', 'tailoring'],
  tailoring: ['leatherworking', 'inscription'],
  inscription: ['tailoring', 'enchanting'],
  enchanting: ['inscription', 'jewelcrafting'],
  jewelcrafting: ['enchanting', 'weaponcrafting'],
};

const EXPECTED_OPPOSITES: Record<ProductionCraftId, ProductionCraftId> = {
  weaponcrafting: 'leatherworking',
  armorcrafting: 'tailoring',
  engineering: 'inscription',
  alchemy: 'enchanting',
  cooking: 'jewelcrafting',
  leatherworking: 'weaponcrafting',
  tailoring: 'armorcrafting',
  inscription: 'engineering',
  enchanting: 'alchemy',
  jewelcrafting: 'cooking',
};

const EXPECTED_POLES: Record<ProductionCraftPole, readonly ProductionCraftId[]> = {
  material: ['weaponcrafting', 'armorcrafting', 'leatherworking', 'tailoring'],
  experimental: ['engineering', 'alchemy'],
  formal: ['inscription', 'enchanting', 'jewelcrafting'],
  cross_cutting: ['cooking'],
};

describe('professions content', () => {
  it('defines the starter gathering professions independently from the craft ring', () => {
    expect(GATHERING_PROFESSION_ORDER).toEqual(['mining', 'logging', 'herbalism']);
    expect(Object.keys(GATHERING_PROFESSIONS)).toEqual([...GATHERING_PROFESSION_ORDER]);
    expect(Object.values(GATHERING_PROFESSIONS).map((profession) => profession.name)).toEqual([
      'Mining',
      'Logging',
      'Herbalism',
    ]);
  });

  it('defines the ten production crafts in the fixed ring order', () => {
    expect(PRODUCTION_CRAFT_RING).toEqual(EXPECTED_RING);
    expect(Object.keys(PRODUCTION_CRAFTS)).toEqual([...EXPECTED_RING]);
    expect(new Set(PRODUCTION_CRAFT_RING)).toHaveLength(10);
  });

  it('derives adjacent crafts from the ring, including wraparound edges', () => {
    for (const craft of PRODUCTION_CRAFT_RING) {
      expect(adjacentProductionCrafts(craft)).toEqual(EXPECTED_ADJACENCY[craft]);
      for (const neighbor of EXPECTED_ADJACENCY[craft]) {
        expect(areAdjacentProductionCrafts(craft, neighbor)).toBe(true);
      }
      expect(areAdjacentProductionCrafts(craft, oppositeProductionCraft(craft))).toBe(false);
    }
  });

  it('derives opposite crafts as the craft five positions around the ring', () => {
    for (const craft of PRODUCTION_CRAFT_RING) {
      const opposite = oppositeProductionCraft(craft);
      expect(opposite).toBe(EXPECTED_OPPOSITES[craft]);
      expect(oppositeProductionCraft(opposite)).toBe(craft);
    }
  });

  it('tags every production craft with its pole group', () => {
    const byPole = PRODUCTION_CRAFT_RING.reduce(
      (acc, craft) => {
        acc[PRODUCTION_CRAFTS[craft].pole].push(craft);
        return acc;
      },
      {
        material: [],
        experimental: [],
        formal: [],
        cross_cutting: [],
      } as Record<ProductionCraftPole, ProductionCraftId[]>,
    );
    expect(byPole).toEqual(EXPECTED_POLES);
  });
});
