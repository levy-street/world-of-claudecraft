// Auto-Retexture: one-click, zone/elevation/water/path-aware ground painting.
//
// Produces a full biomePaint grid of CUSTOM swatches (so it retextures the
// ground WITHOUT changing terrain shape) using the shipped `builtin:` PBR
// texture library. The result is ordinary paint the maker can repaint over.
//
// Everything here is pure: `classifyCell` takes already-sampled terrain facts
// and returns a palette index; the editor (app.ts) does the live sampling via
// world.ts (terrainHeight/slope/biomeAt/roadDistance/waterLevel) and owns the
// undo/rebuild. Keeping it pure makes it unit-testable and side-effect-free.

export interface RetexSwatchDef {
  /** builtin terrain-texture set key (see terrain_texture_sets.ts). */
  key: string;
  /** English display label for the minted swatch. */
  label: string;
  /** Fallback albedo (0xRRGGBB) shown if the texture slot is unavailable. */
  color: number;
  /** Yards per texture repeat, tuned per surface so scale reads correctly. */
  tileSize: number;
}

const S = (key: string, label: string, color: number, tileSize: number): RetexSwatchDef => ({
  key,
  label,
  color,
  tileSize,
});

// The palette, in a FIXED order. The minted custom swatch at position i gets
// id = CUSTOM_PAINT_ID_MIN + i, so `classifyCell` returns these indices.
// 19 textured swatches, within the 24-slot custom-texture atlas cap.
export const RETEX_SWATCHES: readonly RetexSwatchDef[] = [
  // 0..3 grass variants (mid-elevation flats), larger repeats for a natural look
  S('Grass002', 'Meadow Moss', 0x4a6b2a, 16),
  S('Grass003', 'Spring Sward', 0x5c7d33, 16),
  S('Grass004', 'Wild Grass', 0x556b2f, 18),
  S('Grass005', 'Verdant Turf', 0x4f7a2e, 16),
  // 4..7 dirt/earth variants (patches, cliff bases, dry paths)
  S('Ground100', 'Dark Earth', 0x4a3a2a, 14),
  S('Ground103', 'Dry Dirt', 0x8a6b47, 13),
  S('Ground107', 'Dusty Earth', 0x9c7d55, 14),
  S('Ground111', 'Tan Dirt', 0xb09263, 14),
  // 8..10 desert sand (desert biome)
  S('Sand002', 'Golden Dunes', 0xd9b779, 22),
  S('Sand003', 'Smooth Wastes', 0xdcc38f, 22),
  S('Sand007', 'Desert Drift', 0xe0c48a, 20),
  // 11..12 beach sand (shorelines)
  S('Sand001', 'Dune Ripples', 0xd8c088, 15),
  S('Sand006', 'Sunlit Sand', 0xe8d5a0, 15),
  // 13..14 cliffs (steep walls)
  S('Cliff005', 'Strata Cliff', 0x8a7d6b, 10),
  S('Cliff006', 'Sunbaked Cliff', 0x9c8468, 10),
  // 15..16 rock (moderate slopes / scree)
  S('Rock056', 'Meadow Stones', 0x8f8a80, 11),
  S('Rock057', 'Veined Darkstone', 0x5c5852, 11),
  // 17 town cobble, 18 path cobble, small repeats so cobbles read
  S('Cobblestone002', 'Old Cobblestone', 0x7a746b, 5),
  S('Cobblestone001', 'Cobbled Road', 0x86807a, 5),
];

// Named palette indices used by classifyCell.
const GRASS = [0, 1, 2, 3];
const DIRT = [4, 5, 6, 7];
const DESERT_SAND = [8, 9, 10];
const BEACH_SAND = [11, 12];
const CLIFF = [13, 14];
const ROCK = [15, 16];
const TOWN_COBBLE = 17;
const PATH_COBBLE = 18;

// Slope is rise/run (resolution-independent). Flat ~0, gentle hills ~0.2-0.4,
// steep banks ~0.7-1.0, near-vertical walls > 1.1.
const CLIFF_SLOPE = 1.1;
const ROCK_SLOPE = 0.65;
/** Beach band: ground within this many yards above the water plane. */
const SHORE_BAND = 2.0;

export interface CellSample {
  /** terrainHeight at the cell center. */
  h: number;
  /** rise/run slope magnitude at the cell. */
  slope: number;
  /** the map's water plane level. */
  waterLevel: number;
  /** biomeAt(x,z), 'desert' triggers sand, others default to grass. */
  biome: string;
  /** distance in yards to the nearest road/path spline (Infinity if none). */
  roadDist: number;
  /** signed distance to the nearest town anchor: <= 0 means inside. */
  townDist: number;
  /** low-frequency variation noise in [0,1] (picks among same-family variants). */
  nVar: number;
  /** lower-frequency patch noise in [0,1] (sprinkles dirt patches). */
  nPatch: number;
}

/** Pick a palette index (into RETEX_SWATCHES) for one sampled cell. */
export function classifyCell(s: CellSample): number {
  const desert = s.biome === 'desert';
  const twoWay = (arr: number[]): number => arr[s.nVar < 0.5 ? 0 : 1];

  // 1. Cliffs: genuine walls. Highest priority so vertical faces always read as rock.
  if (s.slope > CLIFF_SLOPE) return twoWay(CLIFF);

  // 2. Moderate slopes: rocky/scree, with some earthy mixing for variety.
  if (s.slope > ROCK_SLOPE) {
    if (s.nPatch < 0.35) return desert ? DIRT[1] : ROCK[s.nVar < 0.5 ? 0 : 1];
    return twoWay(ROCK);
  }

  // 3. Shorelines/beaches: gentle ground at or just above the waterline (and
  //    submerged lakebeds) get sand.
  if (s.h <= s.waterLevel + SHORE_BAND) return twoWay(BEACH_SAND);

  // 4. Roads/paths: cobbled near a town, dry dirt out in the wild.
  if (s.roadDist < 2.6) return s.townDist < 10 ? PATH_COBBLE : DIRT[1];

  // 5. Town plazas: cobblestone.
  if (s.townDist <= 0) return TOWN_COBBLE;

  // 6. Desert: sand fields with occasional cracked/dry-dirt patches.
  if (desert) {
    if (s.nPatch < 0.16) return DIRT[s.nVar < 0.5 ? 2 : 1];
    const k = s.nVar < 0.34 ? 0 : s.nVar < 0.67 ? 1 : 2;
    return DESERT_SAND[k];
  }

  // 7. Default grassland: 4 grass variants in soft noise patches, sprinkled
  //    with earthy dirt so it never reads as one flat tile.
  if (s.nPatch < 0.12) return DIRT[s.nVar < 0.5 ? 0 : 3];
  return GRASS[Math.min(3, Math.floor(s.nVar * 4))];
}

// ---- deterministic value noise (organic patches, stable per map seed) --------

function hashUnit(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = smooth(x - ix);
  const v = smooth(z - iz);
  return lerp(
    lerp(hashUnit(ix, iz, seed), hashUnit(ix + 1, iz, seed), u),
    lerp(hashUnit(ix, iz + 1, seed), hashUnit(ix + 1, iz + 1, seed), u),
    v,
  );
}

/** Returns `(x, z, freq) -> [0,1]` two-octave value noise seeded by the map. */
export function makeRetexNoise(seed: number): (x: number, z: number, freq: number) => number {
  return (x, z, freq) => {
    const a = valueNoise(x * freq, z * freq, seed);
    const b = valueNoise(x * freq * 2.3 + 100, z * freq * 2.3 + 100, seed ^ 0x1234);
    return a * 0.7 + b * 0.3;
  };
}

/** assetId substrings that mark a placement as a town structure (→ cobble). */
export const TOWN_STRUCTURE_KEYWORDS = [
  'house',
  'inn',
  'cottage',
  'hut',
  'well',
  'stall',
  'shop',
  'smithy',
  'forge',
  'chapel',
  'church',
  'tower',
  'tavern',
  'market',
  'barn',
  'windmill',
  'hall',
  'building',
  'bank',
  'store',
];

/** True if an asset id looks like a town building worth cobbling around. */
export function isTownStructure(assetId: string): boolean {
  const id = assetId.toLowerCase();
  return TOWN_STRUCTURE_KEYWORDS.some((k) => id.includes(k));
}
