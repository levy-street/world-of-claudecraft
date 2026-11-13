// Every BiomeId, as a runtime list. A ZONE's biome may be any of these, the
// realm biomes (frost, dusk, ember, ...) drive palettes, sky features (the
// Frostveil's aurora), and ambient weather, and a zone carrying one round-trips
// through a saved map even though no brush paints it. Validating a zone against
// BIOME_BY_ID instead silently downgraded every realm zone to 'vale' on export.
//
// The list is the key set of an exhaustive record, so a BiomeId added to the
// union without a row here fails the typecheck: a biome missing from this list
// is exactly the silent 'vale' downgrade on a saved-map round trip.

import type { BiomeId } from './types';

const BIOME_ID_ROWS: Record<BiomeId, true> = {
  vale: true,
  marsh: true,
  peaks: true,
  beach: true,
  desert: true,
  volcano: true,
  cave: true,
  dusk: true,
  ember: true,
  frost: true,
  amber: true,
  fen: true,
  night: true,
  haunt: true,
  jungle: true,
  garden: true,
  gale: true,
  quartered: true,
};

export const ALL_BIOME_IDS: readonly BiomeId[] = Object.keys(BIOME_ID_ROWS) as BiomeId[];
