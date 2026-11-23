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
    grass: 0x72b444,
    grassDark: 0x468844,
    grassYellow: 0xadd058,
    dirt: 0xb49668,
    sand: 0xe4d4a8,
  },
  marsh: {
    grass: 0x72b444,
    grassDark: 0x468844,
    grassYellow: 0xadd058,
    dirt: 0xb49668,
    sand: 0xe4d4a8,
  },
  peaks: {
    grass: 0x6aa04e,
    grassDark: 0x3e6e4a,
    grassYellow: 0xa6b866,
    dirt: 0x8a765a,
    sand: 0xc8bea4,
  },
  // Paint-only biomes (editor brush): flat palettes, no zone-band blend.
  // Coastal green-blue, brighter sand than the desert's.
  beach: {
    grass: 0x8cc45e,
    grassDark: 0x689e4e,
    grassYellow: 0xb8d070,
    dirt: 0xc8ac7c,
    sand: 0xf4e8c4,
  },
  // Warmer and browner than the beach, less green. Pushed further orange
  // than a first pass to separate it clearly from the beach at a glance.
  desert: {
    grass: 0xd0b062,
    grassDark: 0xac904a,
    grassYellow: 0xe6c874,
    dirt: 0xc89854,
    sand: 0xf0d098,
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
  // dusk: Rosewater Twilight (pink-mauve dusk over snow-pale stone, violet shade)
  dusk: {
    grass: 0x7a8a72,
    grassDark: 0x52566a,
    grassYellow: 0xa89a8a,
    dirt: 0x806874,
    sand: 0xc6aebc,
  },
  // ember: Ashfall (grey ash world where only fire keeps its colour)
  ember: {
    grass: 0x7a706a,
    grassDark: 0x4e4848,
    grassYellow: 0x8e827a,
    dirt: 0x4a4040,
    sand: 0x8a8078,
  },
  // frost: Glacier Teal (aqua ice and teal air, cold and clean)
  frost: {
    grass: 0xe6f6f6,
    grassDark: 0xbcdee4,
    grassYellow: 0xd4ecec,
    dirt: 0x86aab4,
    sand: 0xdcf0f0,
  },
  // amber: Sky Island Gold (saturated yellow canopies and gold grass under a cyan sky)
  amber: {
    grass: 0xd6b23a,
    grassDark: 0xa88430,
    grassYellow: 0xf0cc48,
    dirt: 0x9a7a52,
    sand: 0xe8d29a,
  },
  // fen: Spring Watercolour (pastel spring greens and pale blue water)
  fen: {
    grass: 0x8ec270,
    grassDark: 0x5e9a66,
    grassYellow: 0xc0d886,
    dirt: 0xa8987a,
    sand: 0xe0dcc0,
  },
  // night: Fae Pink (candy pink-violet fairy dusk; pastel and glowing)
  night: {
    grass: 0xd88ad8,
    grassDark: 0x9a5ab8,
    grassYellow: 0xf0b0e0,
    dirt: 0x9a6ab0,
    sand: 0xf0c8ec,
  },
  // haunt: dead mossy floor, cold wet earth, everything a shade too dark
  haunt: {
    grass: 0x46543e,
    grassDark: 0x2e382c,
    grassYellow: 0x5a6644,
    dirt: 0x453c34,
    sand: 0x6b6754,
  },
  // jungle: Lagoon Turquoise (bleached sand, glowing turquoise water, airy bright noon)
  jungle: {
    grass: 0x5cb05a,
    grassDark: 0x2e8050,
    grassYellow: 0xa0d070,
    dirt: 0xb09468,
    sand: 0xfaf0d0,
  },
  // garden: Afternoon Reverie (pastel hand-painted afternoon)
  garden: {
    grass: 0x7cbc5c,
    grassDark: 0x4e9058,
    grassYellow: 0xb8d47a,
    dirt: 0xb09c7c,
    sand: 0xeee4c8,
  },
  // gale: Skyward Isles (high-key, airy, pale cyan air and bright cloud)
  gale: {
    grass: 0x84b44a,
    grassDark: 0x4c884a,
    grassYellow: 0xcace6a,
    dirt: 0xa88e66,
    sand: 0xe6dcb8,
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
  dirtDark: 0xa88a5e,
  rock: 0x9ea4a8,
  wetRock: 0x686e6c, // wet-rock shoreline (peaks/volcano/cave)
  hazyPeak: 0x94c2ec, // world-rim mountains, atmospheric
  emberForest: 0x76a250, // the Drakelands' green gatewood
  emberScorch: 0x6a4a40, // volcanic ground near the Drakemaw
  emberBasalt: 0x4e3c34, // the cones' dark volcanic rock (never snow-capped)
  cobble: 0x9c988e, // the Amberfall's laid stone
  snowCap: 0xf2f7fc,
} as const;
