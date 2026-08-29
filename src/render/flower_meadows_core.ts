// The authored flower-meadow registry: which zone's meadow circles bloom in
// which grass-chunk biome, and which of them overlap one chunk's bounds.
// Pure decision logic extracted from the foliage monolith (the ratchet):
// foliage.ts consumes flowerMeadowsInChunk when it sizes a chunk's flower
// buffer and again when it scatters, so the buffer and the bloom can never
// disagree about the meadow set. A meadow circle means "guaranteed dense
// bloom": placement inside one still skips water, steep ground, and roads.
import { DRAKELANDS_FLOWER_MEADOWS } from '../sim/content/drakelands';
import { GALECREST_FLOWER_MEADOWS } from '../sim/content/galecrest';
import { REALM_FLOWER_MEADOWS } from '../sim/content/realm';
import { ZONE1_FLOWER_MEADOWS } from '../sim/content/zone1';

export interface FlowerMeadow {
  x: number;
  z: number;
  r: number;
}

/** The authored meadow circles for a grass-chunk biome: the dusk realm's
 *  meadow bowls, the Galecrest house gardens and tarn shore rings, the
 *  Drakelands' firebloom fields, and New Eastbrook's street verges (owner
 *  refinement round 3). Null for a biome with no authored meadows. */
export function flowerMeadowsForBiome(biome: string): readonly FlowerMeadow[] | null {
  switch (biome) {
    case 'dusk':
      return REALM_FLOWER_MEADOWS;
    case 'gale':
      return GALECREST_FLOWER_MEADOWS;
    case 'ember':
      return DRAKELANDS_FLOWER_MEADOWS;
    case 'vale':
      return ZONE1_FLOWER_MEADOWS;
    default:
      return null;
  }
}

/** The biome's meadows whose circles overlap one chunk's bounds; empty for a
 *  meadowless biome or a chunk no circle reaches. */
export function flowerMeadowsInChunk(
  biome: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): FlowerMeadow[] {
  const source = flowerMeadowsForBiome(biome);
  if (!source) return [];
  return source.filter(
    (meadow) =>
      meadow.x + meadow.r > minX &&
      meadow.x - meadow.r < maxX &&
      meadow.z + meadow.r > minZ &&
      meadow.z - meadow.r < maxZ,
  );
}
