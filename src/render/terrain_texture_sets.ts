// Built-in terrain PBR texture sets (public/textures/terrain/<Key>_*.jpg), the
// single registry behind every "pick a ground texture" UI: the Paint tool's
// built-in swatch library, the Rock tool's base-texture picker, and the Cave
// panel's interior-texture picker. Each set follows the AmbientCG-style file
// convention (Color / NormalGL / Roughness / AmbientOcclusion); `maps` lists
// which files actually exist so loaders never 404-probe.
//
// A paint swatch references a built-in set through the pseudo content hash
// `builtin:<Key>` (see ground_textures.ts): unlike an imported texture's
// sha256, a builtin sha resolves from the app bundle on EVERY machine, so
// maps painted with these swatches never lose their ground art.

export interface TerrainTextureSet {
  /** File-name stem under public/textures/terrain/ (e.g. 'Sand001'). */
  key: string;
  /** Display name (editor UI is English-only; see i18n deferral note). */
  name: string;
  /** Average albedo (0xRRGGBB): swatch fallback color + palette chip. */
  color: number;
  /** Which map files exist for this set. */
  maps: { color: true; normal?: true; rough?: true; ao?: true; emission?: true };
  /** Listed in the Paint tool's built-in texture library (default swatches). */
  paintDefault?: true;
  /** Object-material facts for the Build tool's material picker
   *  (render/model_materials.ts): the picker group, and the constant
   *  metalness/roughness the surface shades with (a set with no roughness map
   *  falls back to `roughness`). Sets without this still appear, grouped by
   *  their key prefix, as non-metals. */
  material?: { group: MaterialGroup; metalness?: number; roughness?: number };
}

/** Picker groups for object materials (render/model_materials.ts). */
export type MaterialGroup =
  | 'stone'
  | 'brick'
  | 'paving'
  | 'dirt'
  | 'sand'
  | 'grass'
  | 'snow'
  | 'wood'
  | 'metal'
  | 'plaster'
  | 'cloth'
  | 'lava';

const ALL4 = { color: true, normal: true, rough: true, ao: true } as const;
const CN = { color: true, normal: true } as const;
const CNR = { color: true, normal: true, rough: true } as const;
// Sets with a glow: the Emission map lights the molten parts through the
// terrain paint shader and the cave/carve interior materials.
const ALL4E = { ...ALL4, emission: true } as const;
const CNE = { ...CN, emission: true } as const;

export const TERRAIN_TEXTURE_SETS: readonly TerrainTextureSet[] = [
  // The default texture library: always-available paint swatches.
  { key: 'Grass002', name: 'Meadow Moss', color: 0x4f6b1c, maps: ALL4, paintDefault: true },
  { key: 'Grass003', name: 'Spring Sward', color: 0x637d21, maps: ALL4, paintDefault: true },
  { key: 'Sand001', name: 'Dune Ripples', color: 0x997957, maps: ALL4, paintDefault: true },
  { key: 'Sand002', name: 'Golden Dunes', color: 0xa47a42, maps: ALL4, paintDefault: true },
  { key: 'Sand003', name: 'Smooth Wastes', color: 0xa97348, maps: ALL4, paintDefault: true },
  { key: 'Sand004', name: 'Pebbled Sand', color: 0x985f3a, maps: ALL4, paintDefault: true },
  { key: 'Cliff001', name: 'Red Cliff', color: 0x5f4c38, maps: ALL4, paintDefault: true },
  { key: 'Cliff002', name: 'Mossy Crag', color: 0x3c3f37, maps: ALL4, paintDefault: true },
  // Second Yoge import: 2 more sets per source volume (grass / sand x2 / cliff /
  // ground / rock x2), compressed the same way as the paint sets above (1024
  // JPEG, GL-flipped normals, height-derived roughness). All paintable defaults.
  { key: 'Grass004', name: 'Wild Grass', color: 0x456624, maps: ALL4, paintDefault: true },
  { key: 'Grass005', name: 'Verdant Turf', color: 0x4e6b1c, maps: ALL4, paintDefault: true },
  { key: 'Sand005', name: 'Rippled Dune', color: 0xa9844d, maps: ALL4, paintDefault: true },
  { key: 'Sand006', name: 'Sunlit Sand', color: 0x9b7d42, maps: ALL4, paintDefault: true },
  { key: 'Sand007', name: 'Desert Drift', color: 0xa66c46, maps: ALL4, paintDefault: true },
  { key: 'Sand008', name: 'Amber Sand', color: 0x9d683e, maps: ALL4, paintDefault: true },
  { key: 'Cliff003', name: 'Craggy Rock', color: 0x65533e, maps: ALL4, paintDefault: true },
  { key: 'Cliff004', name: 'Weathered Bluff', color: 0x675340, maps: ALL4, paintDefault: true },
  { key: 'Ground100', name: 'Dark Earth', color: 0x27221e, maps: ALL4, paintDefault: true },
  { key: 'Ground101', name: 'Loam Bed', color: 0x20160d, maps: ALL4, paintDefault: true },
  { key: 'Rock052', name: 'Rugged Stone', color: 0x442b28, maps: ALL4, paintDefault: true },
  { key: 'Rock053', name: 'Ironrock', color: 0x422f2a, maps: ALL4, paintDefault: true },
  { key: 'Rock054', name: 'Sandstone Face', color: 0x7b5b48, maps: ALL4, paintDefault: true },
  { key: 'Rock055', name: 'Rust Rock', color: 0x936235, maps: ALL4, paintDefault: true },
  // Existing shipped sets (the splat/biome textures), pickable for rocks and
  // cave interiors; not repeated in the paint library (the biomes cover them).
  { key: 'Grass001', name: 'Vale Grass', color: 0x445b28, maps: ALL4 },
  { key: 'Ground048', name: 'Rich Soil', color: 0x533e32, maps: ALL4 },
  { key: 'Ground071', name: 'Marsh Mud', color: 0x806649, maps: ALL4 },
  { key: 'Ground080', name: 'Beach Sand', color: 0xb49e70, maps: ALL4 },
  { key: 'Rock029', name: 'Weathered Rock', color: 0x7a5337, maps: CN },
  { key: 'Rock035', name: 'Layered Stone', color: 0x0f191d, maps: CN },
  { key: 'Rock051', name: 'Granite', color: 0x757261, maps: ALL4 },
  { key: 'Gravel024', name: 'Gravel', color: 0x4b4946, maps: CN },
  { key: 'Lava004', name: 'Lava Rock', color: 0xac442e, maps: CNE },
  { key: 'Snow010A', name: 'Snow', color: 0xdeeefb, maps: ALL4 },
  { key: 'PavingStones046', name: 'Paving Stones', color: 0x999b99, maps: ALL4 },
  // Third Yoge import (Vols 76/117/156/180/184/256/259/270/283): 2 sets per
  // source volume (all uniform Ground sets from Vol117 + tileable Vol270),
  // compressed the same way (1024 JPEG, GL-flipped normals, height-derived
  // roughness ~0.87, AO). New categories: Roots / Wood / Cobblestone.
  { key: 'Roots001', name: 'Tangled Roots', color: 0x615c36, maps: ALL4, paintDefault: true },
  { key: 'Roots002', name: 'Living Roots', color: 0x48552d, maps: ALL4, paintDefault: true },
  { key: 'Rock056', name: 'Meadow Stones', color: 0x5d6d45, maps: ALL4, paintDefault: true },
  { key: 'Rock057', name: 'Veined Darkstone', color: 0x303a2d, maps: ALL4, paintDefault: true },
  { key: 'Cliff005', name: 'Strata Cliff', color: 0x493d31, maps: ALL4, paintDefault: true },
  { key: 'Cliff006', name: 'Sunbaked Cliff', color: 0x4a3e34, maps: ALL4, paintDefault: true },
  { key: 'Lava005', name: 'Molten Crust', color: 0x552325, maps: ALL4E, paintDefault: true },
  { key: 'Lava006', name: 'Magma Flow', color: 0x6d2015, maps: ALL4E, paintDefault: true },
  { key: 'Wood001', name: 'Oak Planks', color: 0x442f23, maps: ALL4, paintDefault: true },
  { key: 'Wood002', name: 'Pine Planks', color: 0x513824, maps: ALL4, paintDefault: true },
  { key: 'Wood003', name: 'Weathered Bark', color: 0x393432, maps: ALL4, paintDefault: true },
  { key: 'Wood004', name: 'Mossy Bark', color: 0x3f3a28, maps: ALL4, paintDefault: true },
  { key: 'Cobblestone001', name: 'Cobbled Road', color: 0x3f4046, maps: ALL4, paintDefault: true },
  {
    key: 'Cobblestone002',
    name: 'Old Cobblestone',
    color: 0x37363c,
    maps: ALL4,
    paintDefault: true,
  },
  // Dirt/earth grounds pruned 2026-07-25: the near-identical brown cracked-earth
  // run was cut down to the distinct tones below (Ground100/101 above + these 8
  // = 10 kept, ~half of the old 19). Ground103/107 double as the Auto-Retexture
  // tool's dirt band (see auto_retexture.ts), so they stay.
  { key: 'Ground103', name: 'Dry Dirt', color: 0x3d2d21, maps: ALL4, paintDefault: true },
  { key: 'Ground107', name: 'Dusty Earth', color: 0x3f2f22, maps: ALL4, paintDefault: true },
  { key: 'Ground111', name: 'Tan Dirt', color: 0x5e4431, maps: ALL4, paintDefault: true },
  { key: 'Ground113', name: 'Rust Earth', color: 0x4a382f, maps: ALL4, paintDefault: true },
  { key: 'Ground114', name: 'Mossy Soil', color: 0x4b3b25, maps: ALL4, paintDefault: true },
  { key: 'Ground115', name: 'Pebbled Ground', color: 0x4d4230, maps: ALL4, paintDefault: true },
  { key: 'Ground116', name: 'Stony Dirt', color: 0x3b362c, maps: ALL4, paintDefault: true },
  { key: 'Ground118', name: 'Shadowed Earth', color: 0x2b2c27, maps: ALL4, paintDefault: true },
  // Fourth Yoge import (2026-07-25, Vols 224 Tiles / 238+239 Snow / 271+278
  // Ground): 2 sets per source volume, compressed identically (1024 JPEG,
  // GL-flipped normals, height-derived roughness ~0.87, AO). New categories:
  // Tiles / Snow (paintable snowfields). Ground121/122 are stylized exotic
  // grounds (violet + azure) from Vol278.
  { key: 'Tiles001', name: 'Lichen Flagstones', color: 0x706f5e, maps: ALL4, paintDefault: true },
  { key: 'Tiles002', name: 'Slate Pavers', color: 0x68747d, maps: ALL4, paintDefault: true },
  { key: 'Snow001', name: 'Frosted Crust', color: 0xa7b7ca, maps: ALL4, paintDefault: true },
  { key: 'Snow002', name: 'Thawing Drift', color: 0xa1b4c7, maps: ALL4, paintDefault: true },
  { key: 'Snow003', name: 'Fresh Powder', color: 0xe0e5e3, maps: ALL4, paintDefault: true },
  { key: 'Snow004', name: 'Packed Snow', color: 0xc7d4da, maps: ALL4, paintDefault: true },
  { key: 'Ground119', name: 'Ironclay', color: 0x3e2321, maps: ALL4, paintDefault: true },
  { key: 'Ground120', name: 'Terracotta Earth', color: 0x5e2b21, maps: ALL4, paintDefault: true },
  { key: 'Ground121', name: 'Duskloam', color: 0x41375c, maps: ALL4, paintDefault: true },
  { key: 'Ground122', name: 'Azurite Gravel', color: 0x394b98, maps: ALL4, paintDefault: true },
  // ---- Object materials for the Build tool (CC0 from ambientCG.com, 1K,
  // converted like the Yoge sets: 1024 JPEG q85, GL normals). Not paint
  // swatches: they exist for built models (stairs, walls, props) through the
  // material picker, with hue / saturation / light adjustable per object.
  {
    key: 'Bricks076C',
    name: 'Mossy Brick',
    color: 0x53503c,
    maps: ALL4,
    material: { group: 'brick' },
  },
  {
    key: 'Concrete034',
    name: 'Cast Concrete',
    color: 0xb9b9b9,
    maps: CNR,
    material: { group: 'stone' },
  },
  {
    key: 'Marble012',
    name: 'Veined Marble',
    color: 0xadaeb6,
    maps: CNR,
    material: { group: 'stone' },
  },
  {
    key: 'PavingStones131',
    name: 'Mossy Setts',
    color: 0x9f9b7a,
    maps: ALL4,
    material: { group: 'paving' },
  },
  {
    key: 'Plaster001',
    name: 'Lime Plaster',
    color: 0xd7d3d0,
    maps: CNR,
    material: { group: 'plaster' },
  },
  {
    key: 'Metal032',
    name: 'Brushed Steel',
    color: 0x7d8994,
    maps: CNR,
    material: { group: 'metal', metalness: 0.9 },
  },
  {
    key: 'Metal034',
    name: 'Painted Steel',
    color: 0xe4b108,
    maps: CNR,
    material: { group: 'metal', metalness: 0.35 },
  },
  {
    key: 'Rust004',
    name: 'Rusted Iron',
    color: 0x482210,
    maps: CNR,
    material: { group: 'metal', metalness: 0.55 },
  },
  {
    key: 'Fabric030',
    name: 'Grey Weave',
    color: 0x5c5b5c,
    maps: ALL4,
    material: { group: 'cloth' },
  },
  {
    key: 'Leather037',
    name: 'Oxblood Leather',
    color: 0x633828,
    maps: CNR,
    material: { group: 'cloth' },
  },
];

const BY_KEY = new Map(TERRAIN_TEXTURE_SETS.map((s) => [s.key, s]));

export function terrainTextureSet(key: string): TerrainTextureSet | null {
  return BY_KEY.get(key) ?? null;
}

/** The always-available paint-library sets (built-in default swatches). */
export function paintDefaultSets(): readonly TerrainTextureSet[] {
  return TERRAIN_TEXTURE_SETS.filter((s) => s.paintDefault);
}

// ---- builtin pseudo content hashes (see ground_textures.ts) -----------------

export const BUILTIN_SHA_PREFIX = 'builtin:';

export function builtinShaFor(key: string): string {
  return `${BUILTIN_SHA_PREFIX}${key}`;
}

/** The set key of a builtin pseudo-sha, or null for a real content hash. */
export function builtinKeyOf(sha: string): string | null {
  if (!sha.startsWith(BUILTIN_SHA_PREFIX)) return null;
  const key = sha.slice(BUILTIN_SHA_PREFIX.length);
  return BY_KEY.has(key) ? key : null;
}

/** Relative asset path of one of a set's map files (under the media root). */
export function terrainTexturePath(
  key: string,
  map: 'color' | 'normal' | 'rough' | 'ao' | 'emission',
): string | null {
  const set = BY_KEY.get(key);
  if (!set) return null;
  const suffix =
    map === 'color'
      ? 'Color'
      : map === 'normal'
        ? 'NormalGL'
        : map === 'rough'
          ? 'Roughness'
          : map === 'emission'
            ? 'Emission'
            : 'AmbientOcclusion';
  const has =
    map === 'color'
      ? set.maps.color
      : map === 'normal'
        ? set.maps.normal
        : map === 'rough'
          ? set.maps.rough
          : map === 'emission'
            ? set.maps.emission
            : set.maps.ao;
  if (!has) return null;
  return `textures/terrain/${key}_${suffix}.jpg`;
}
