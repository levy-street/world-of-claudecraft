// The world scatter boulders' instance tint as plain numbers: the per-biome
// stone colour, the peaks foothills' warm field stone, and the Cinderscar's
// pale blue-grey basalt. Three-free so a Vitest pins it; foliage.ts is the consumer
// that softens the colour toward white by `soften` and jitters it per rock.

import { inCinderscar } from '../sim/quartered_landmarks';
import type { BiomeId } from '../sim/types';

const ROCK_TINT: Record<BiomeId, number> = {
  vale: 0x989a94,
  marsh: 0x989a94,
  peaks: 0x949ca8,
  beach: 0xc2b89e,
  desert: 0xb08d6a,
  volcano: 0x4a4038,
  cave: 0x6a6a66,
  dusk: 0x8f88a6,
  ember: 0x9a7a62,
  frost: 0x9aa8b8,
  amber: 0x9a8a70,
  fen: 0x8e9688,
  night: 0xa094c8,
  haunt: 0x565a50,
  jungle: 0x7e8a6a,
  garden: 0xa2a49c, // marble and pale stone
  gale: 0x929698, // salt-grey sea rock
  quartered: 0x948c84, // heaved, weathered stone
};

/** Low-altitude peaks rocks drop the icy blue-gray for a warm field stone:
 *  pale rocks on green foothill grass read as eggs. */
const PEAKS_FOOTHILL_TINT = 0x82847c;
/** The share of white every ordinary rock tint is softened by. */
export const ROCK_TINT_SOFTEN = 0.45;
/** The Cinderscar's basalt: the fire inspiration's pale blue-grey column
 *  stone against the red ground. Softened less than ordinary rock, so the
 *  blue survives the lift toward white. */
export const CINDERSCAR_ROCK_TINT = 0x9aa2bc;
export const CINDERSCAR_ROCK_SOFTEN = 0.15;

export interface ScatterRockTint {
  hex: number;
  /** the share of white to lerp toward before the per-rock jitter */
  soften: number;
}

/** The tint a scatter boulder of `biome` at (x, z) wears; `snowy` is true
 *  above the terrain snowline. */
export function scatterRockTint(
  biome: BiomeId,
  x: number,
  z: number,
  snowy: boolean,
): ScatterRockTint {
  if (biome === 'quartered' && inCinderscar(x, z))
    return { hex: CINDERSCAR_ROCK_TINT, soften: CINDERSCAR_ROCK_SOFTEN };
  if (biome === 'peaks' && !snowy) return { hex: PEAKS_FOOTHILL_TINT, soften: ROCK_TINT_SOFTEN };
  return { hex: ROCK_TINT[biome], soften: ROCK_TINT_SOFTEN };
}
