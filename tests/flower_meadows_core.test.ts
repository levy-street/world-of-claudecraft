// The authored flower-meadow registry (src/render/flower_meadows_core.ts):
// biome-to-table mapping plus the chunk overlap filter the foliage ring uses
// both to size a chunk's flower buffer and to scatter its blooms.
import { describe, expect, it } from 'vitest';
import { flowerMeadowsForBiome, flowerMeadowsInChunk } from '../src/render/flower_meadows_core';
import { DRAKELANDS_FLOWER_MEADOWS } from '../src/sim/content/drakelands';
import { GALECREST_FLOWER_MEADOWS } from '../src/sim/content/galecrest';
import { REALM_FLOWER_MEADOWS } from '../src/sim/content/realm';
import { ZONE1_FLOWER_MEADOWS } from '../src/sim/content/zone1';

describe('flowerMeadowsForBiome', () => {
  it('maps each authored biome to its own meadow table and nothing else', () => {
    expect(flowerMeadowsForBiome('dusk')).toBe(REALM_FLOWER_MEADOWS);
    expect(flowerMeadowsForBiome('gale')).toBe(GALECREST_FLOWER_MEADOWS);
    expect(flowerMeadowsForBiome('ember')).toBe(DRAKELANDS_FLOWER_MEADOWS);
    expect(flowerMeadowsForBiome('vale')).toBe(ZONE1_FLOWER_MEADOWS);
    for (const meadowless of ['frost', 'haunt', 'garden', 'fen', 'night', 'amber', '']) {
      expect(flowerMeadowsForBiome(meadowless)).toBeNull();
    }
  });

  it("keeps New Eastbrook's street-verge drifts on dry authored circles", () => {
    // The round-3 verges plus the round-4 Wolf Run meadows: positive radii,
    // all on dry vale ground (the strand runs south of z -130; every circle
    // stays north of it).
    expect(ZONE1_FLOWER_MEADOWS.length).toBeGreaterThanOrEqual(4);
    for (const meadow of ZONE1_FLOWER_MEADOWS) {
      expect(meadow.r).toBeGreaterThan(0);
      expect(meadow.z).toBeGreaterThan(-130);
    }
  });
});

describe('flowerMeadowsInChunk', () => {
  it('returns exactly the circles overlapping the chunk bounds', () => {
    const [first] = ZONE1_FLOWER_MEADOWS;
    const inside = flowerMeadowsInChunk('vale', first.x - 1, first.x + 1, first.z - 1, first.z + 1);
    expect(inside).toContain(first);
    // A chunk fully past the circle's reach on one axis sees nothing of it.
    const outside = flowerMeadowsInChunk(
      'vale',
      first.x + first.r + 1,
      first.x + first.r + 33,
      first.z - 1,
      first.z + 1,
    );
    expect(outside).not.toContain(first);
  });

  it('is empty for a meadowless biome regardless of bounds', () => {
    expect(flowerMeadowsInChunk('frost', -1e9, 1e9, -1e9, 1e9)).toEqual([]);
  });
});
