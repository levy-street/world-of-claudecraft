// Shared terrain color data: the per-biome ground palette and the slope
// thresholds where rock takes over, plus the handful of fixed ground tones
// both terrain tiers tint toward. Split out of terrain_chunk_build.ts as
// PLAIN DATA (hex numbers, no Three) so the far-vista mesh
// (far_terrain_core.ts, a pure Node-tested core) colors distant ground from
// the exact same source the near splat/Lambert terrain uses, and the two can
// never drift apart.

import type { BiomeId } from '../sim/types';

// Ground colors per biome; boundaries blend across the same window as the
// heightfield's shape blend. This is the tint layer the splat albedo
// multiplies into (splat textures are authored near mid-gray).
export const BIOME_PALETTE: Record<
  BiomeId,
  { grass: number; grassDark: number; grassYellow: number; dirt: number; sand: number }
> = {
  vale: {
    grass: 0x548545,
    grassDark: 0x3e6635,
    grassYellow: 0x768c44,
    dirt: 0x8a6f47,
    sand: 0xc2b283,
  },
  marsh: {
    grass: 0x596d36,
    grassDark: 0x41522b,
    grassYellow: 0x71764a,
    dirt: 0x6e5a3e,
    sand: 0x8f7f5c,
  },
  peaks: {
    grass: 0x687a55,
    grassDark: 0x4d5c45,
    grassYellow: 0x8d9168,
    dirt: 0x7d6a50,
    sand: 0xb0a486,
  },
  // Paint-only biomes (editor brush): flat palettes, no zone-band blend.
  // Coastal green-blue, brighter sand than the desert's.
  beach: {
    grass: 0x9ab86a,
    grassDark: 0x7d9a5a,
    grassYellow: 0xb8c278,
    dirt: 0xc2a575,
    sand: 0xf0e4bc,
  },
  // Warmer and browner than the beach, less green. Pushed further orange
  // than a first pass to separate it clearly from the beach at a glance.
  desert: {
    grass: 0xcbaa5e,
    grassDark: 0xa88d48,
    grassYellow: 0xe0c070,
    dirt: 0xc08f4a,
    sand: 0xecc890,
  },
  // Dark, red-tinted ash rather than the cave's neutral grey. Pushed darker
  // still so it reads as scorched ground, not just "dirty".
  volcano: {
    grass: 0x3c2c28,
    grassDark: 0x281c18,
    grassYellow: 0x503830,
    dirt: 0x2c2018,
    sand: 0x4c342c,
  },
  // Neutral blue-grey stone, distinct from volcano's warm ash. Pushed cooler
  // and darker so it reads as underground rock, not daylight dirt.
  cave: {
    grass: 0x585e66,
    grassDark: 0x3e444c,
    grassYellow: 0x6a7078,
    dirt: 0x484e56,
    sand: 0x767c86,
  },
  // dusk: violet-cast glade greens with dusty rose soil
  dusk: {
    grass: 0x6d7566,
    grassDark: 0x4c4e58,
    grassYellow: 0x8c8078,
    dirt: 0x6e5a68,
    sand: 0xa593a2,
  },
  ember: {
    grass: 0xc9a86a,
    grassDark: 0xa8854f,
    grassYellow: 0xd8bc80,
    dirt: 0x9a6a44,
    sand: 0xe0c088,
  },
  frost: {
    grass: 0xeef4fa,
    grassDark: 0xd8e4f0,
    grassYellow: 0xcfdce8,
    dirt: 0x9fb0c0,
    sand: 0xdfe8f2,
  },
  amber: {
    grass: 0xc9a44e,
    grassDark: 0xa88438,
    grassYellow: 0xe0c060,
    dirt: 0x8a6a42,
    sand: 0xd8bc84,
  },
  fen: {
    grass: 0x7cab68,
    grassDark: 0x5c8a52,
    grassYellow: 0xa2c47a,
    dirt: 0x6e6448,
    sand: 0xb8bc8e,
  },
  // night: the Nightbloom dreams in violet. The splat textures are
  // green-authored, so these run hot and saturated or the meadow reads
  // green anyway (the amber realm's fire-orange needed the same push)
  night: {
    grass: 0xc06cf2,
    grassDark: 0x8f4ecc,
    grassYellow: 0xe08cf8,
    dirt: 0x8a5cb8,
    sand: 0xd8a8f0,
  },
  // haunt: dead mossy floor, cold wet earth, everything a shade too dark
  haunt: {
    grass: 0x46543e,
    grassDark: 0x2e382c,
    grassYellow: 0x5a6644,
    dirt: 0x453c34,
    sand: 0x6b6754,
  },
  // jungle: saturated tropical green over bright coral sand
  jungle: {
    grass: 0x3f9448,
    grassDark: 0x2c7038,
    grassYellow: 0x74b04e,
    dirt: 0x8a6e4a,
    sand: 0xf2e2b4,
  },
  // garden: mown lawn over warm gravel, tidy even where it has run wild
  garden: {
    grass: 0x58a04e,
    grassDark: 0x3f7e3c,
    grassYellow: 0x86b85c,
    dirt: 0x8a7a5a,
    sand: 0xd8cca8,
  },
  // gale: wind-dried sage downs over grey shingle
  gale: {
    grass: 0x6a9a62,
    grassDark: 0x4c7a4e,
    grassYellow: 0x9ab070,
    dirt: 0x7a6e58,
    sand: 0xd8d0b8,
  },
};

// rock starts creeping in at lower slopes in the peaks, later in the marsh
export const ROCK_SLOPE_START: Record<BiomeId, number> = {
  vale: 0.55,
  marsh: 0.62,
  peaks: 0.45,
  beach: 0.7,
  desert: 0.55,
  volcano: 0.35,
  cave: 0.4,
  dusk: 0.52,
  ember: 0.5,
  frost: 0.5,
  amber: 0.52,
  fen: 0.6,
  night: 0.55,
  haunt: 0.58,
  jungle: 0.6,
  garden: 0.6,
  gale: 0.5, // the cliffs crag early
};

// Fixed ground tones shared by the near splat tint pass and the far-vista
// color recipe (hex mirrors of terrain_chunk_build.ts's scratch colors).
export const TERRAIN_TONES = {
  dirtDark: 0x73592f,
  rock: 0x7a7a72,
  wetRock: 0x3f4442, // dark wet-rock shoreline (peaks/volcano/cave)
  hazyPeak: 0xa8bdd4, // world-rim mountains, atmospheric
  emberForest: 0x729a4e, // the Drakelands' green gatewood
  emberScorch: 0x6a4a40, // volcanic ground near the Drakemaw
  emberBasalt: 0x4e3c34, // the cones' dark volcanic rock (never snow-capped)
  cobble: 0x8f8c86, // the Amberfall's laid stone
  snowCap: 0xedf3fa,
} as const;
