// The Balgath Starwake VFX kit contract: ONE GLB, seventeen named mesh nodes.
//
// The node NAMES are the runtime contract: the renderer loads
// `/models/vfx/balgath_starwake.glb` and reads each piece by name (the six glowing star
// crystals planted around the fallen star, the six lava gobbets a geyser throws, the four
// cooling-crust plates floating on a molten pool, and the geyser column itself). The
// factory is scripts/assets/balgath_starwake/model.py (Blender, run by
// export_balgath_starwake.mjs); the shipped file is pinned byte for byte by
// tests/balgath_starwake_asset.test.ts.
//
// Two pivots. BASE-anchored nodes (the crystals and the column) have their lowest point
// on y = 0 and their bounding box centred on the origin in x and z, so the renderer
// plants them on the ground. CENTROID nodes (the chunks and the crusts) sit centred on
// their own AREA-WEIGHTED SURFACE CENTROID, so a renderer that spins one spins it about
// its middle. The shipped file is meshopt-quantized, which bakes a dequantizing
// translation and scale onto each mesh node: take the NODE (its world transform
// included), never the bare geometry, or every piece comes out at the size of a unit cube.
//
// Sizes are normalized so the renderer owns the world scale: a crystal is 0.6 to 1.6
// tall, a chunk's bounding radius (farthest vertex from its centroid) 0.25 to 0.45, a
// crust's longest bounding-box side 0.9 to 1.3 with a thickness (its y extent) of 0.06
// to 0.14, and the column exactly 1 tall. A footprint is the widest horizontal
// bounding-box side over the node's height.

/** The one shipped file, relative to public/. */
export const BALGATH_STARWAKE_FILE = 'models/vfx/balgath_starwake.glb';

/** The scene root that carries the sculptRuntime extras; every piece is its child. */
export const BALGATH_STARWAKE_ROOT = 'BalgathStarwakeKit';

/** Material buckets the factory may emit. */
export const BALGATH_STARWAKE_MATERIALS = Object.freeze(['basalt', 'crystal', 'ember']);

/** The Blender release the raw export was authored and verified with. */
export const BALGATH_STARWAKE_BLENDER_VERSION = '5.2.1';

/** Byte ceiling for the whole optimized GLB. Per-corner colour splits most vertices (the
 *  crisp faceted look), so this is set from the measured file with modest headroom. */
export const BALGATH_STARWAKE_MAX_BYTES = 120 * 1024;

/** Triangle ceiling for the whole kit. */
export const BALGATH_STARWAKE_MAX_TRIANGLES = 4000;

const crystal = (name) => ({
  name,
  role: 'crystal',
  anchor: 'base',
  maxTriangles: 160,
  minHeight: 0.6,
  maxHeight: 1.6,
  minFootprint: 0.18,
  maxFootprint: 0.7,
});
const chunk = (name) => ({
  name,
  role: 'chunk',
  anchor: 'centroid',
  maxTriangles: 220,
  minRadius: 0.25,
  maxRadius: 0.45,
});
const crust = (name) => ({
  name,
  role: 'crust',
  anchor: 'centroid',
  maxTriangles: 200,
  minLength: 0.9,
  maxLength: 1.3,
  minThickness: 0.06,
  maxThickness: 0.14,
});

/**
 * One row per named node. Base-anchored rows bound `minHeight`/`maxHeight` (the y
 * extent) and `minFootprint`/`maxFootprint`; chunk rows bound the radius; crust rows
 * bound the longest side and the thickness.
 */
export const BALGATH_STARWAKE_NODES = Object.freeze([
  crystal('star_crystal_0'),
  crystal('star_crystal_1'),
  crystal('star_crystal_2'),
  crystal('star_crystal_3'),
  crystal('star_crystal_4'),
  crystal('star_crystal_5'),
  chunk('lava_chunk_0'),
  chunk('lava_chunk_1'),
  chunk('lava_chunk_2'),
  chunk('lava_chunk_3'),
  chunk('lava_chunk_4'),
  chunk('lava_chunk_5'),
  crust('pool_crust_0'),
  crust('pool_crust_1'),
  crust('pool_crust_2'),
  crust('pool_crust_3'),
  {
    name: 'geyser_column',
    role: 'column',
    anchor: 'base',
    maxTriangles: 700,
    minHeight: 0.99,
    maxHeight: 1.01,
    // the base is about 1 wide; the droplets thrown off the crown reach past it
    minFootprint: 1.2,
    maxFootprint: 1.6,
  },
]);

/** How far a node's pivot may sit off its origin, as a fraction of its size: the surface
 *  centroid for centroid nodes; the min y and the x/z bounding-box centre for base nodes. */
export const BALGATH_STARWAKE_CENTRE_TOLERANCE = 0.02;
