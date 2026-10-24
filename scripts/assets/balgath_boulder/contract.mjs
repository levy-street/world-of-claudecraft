// The Balgath Boulder Toss VFX kit contract: ONE GLB, eleven named mesh nodes.
//
// The node NAMES are the runtime contract: the renderer loads
// `/models/vfx/balgath_boulder.glb` and reads each piece by name (the hero boulder he
// hurls, the six shatter chunks it bursts into, and the four splinters of the vortex
// over a marked player). The factory is scripts/assets/balgath_boulder/model.py
// (Blender, run by export_balgath_boulder.mjs); the shipped file is pinned byte for
// byte by tests/balgath_boulder_asset.test.ts.
//
// Every node sits at the origin in its own frame and is centred on its own AREA-WEIGHTED
// SURFACE CENTROID, so a renderer that spins a node spins it about its middle. The
// shipped file is meshopt-quantized, which bakes a dequantizing translation and scale
// onto each mesh node: take the NODE (its world transform included), never the bare
// geometry, or every piece comes out at the size of a unit cube.
//
// Sizes are normalized so the renderer owns the world scale: the boulder's bounding
// radius (farthest vertex from its centroid) is 1, a chunk's 0.25 to 0.45, a shard's
// longest bounding-box side 0.5.

/** The one shipped file, relative to public/. */
export const BALGATH_BOULDER_FILE = 'models/vfx/balgath_boulder.glb';

/** The scene root that carries the sculptRuntime extras; every piece is its child. */
export const BALGATH_BOULDER_ROOT = 'BalgathBoulderKit';

/** Material buckets the factory may emit. */
export const BALGATH_BOULDER_MATERIALS = Object.freeze(['granite', 'moss', 'soil']);

/** The Blender release the raw export was authored and verified with. */
export const BALGATH_BOULDER_BLENDER_VERSION = '5.2.1';

/** Byte ceiling for the whole optimized GLB. Flat per-face colour splits most vertices
 *  (that is the crisp faceted look), so this sits above the muster pieces per triangle. */
export const BALGATH_BOULDER_MAX_BYTES = 144 * 1024;

/**
 * One row per named node. `minRadius`/`maxRadius` bound the farthest vertex from the
 * node's centroid; `minLength`/`maxLength` (shards only) bound the longest side of its
 * bounding box.
 */
export const BALGATH_BOULDER_NODES = Object.freeze([
  { name: 'boulder', role: 'hero', maxTriangles: 2500, minRadius: 0.97, maxRadius: 1.03 },
  { name: 'chunk_0', role: 'chunk', maxTriangles: 250, minRadius: 0.25, maxRadius: 0.45 },
  { name: 'chunk_1', role: 'chunk', maxTriangles: 250, minRadius: 0.25, maxRadius: 0.45 },
  { name: 'chunk_2', role: 'chunk', maxTriangles: 250, minRadius: 0.25, maxRadius: 0.45 },
  { name: 'chunk_3', role: 'chunk', maxTriangles: 250, minRadius: 0.25, maxRadius: 0.45 },
  { name: 'chunk_4', role: 'chunk', maxTriangles: 250, minRadius: 0.25, maxRadius: 0.45 },
  { name: 'chunk_5', role: 'chunk', maxTriangles: 250, minRadius: 0.25, maxRadius: 0.45 },
  { name: 'shard_0', role: 'shard', maxTriangles: 80, minLength: 0.47, maxLength: 0.53 },
  { name: 'shard_1', role: 'shard', maxTriangles: 80, minLength: 0.47, maxLength: 0.53 },
  { name: 'shard_2', role: 'shard', maxTriangles: 80, minLength: 0.47, maxLength: 0.53 },
  { name: 'shard_3', role: 'shard', maxTriangles: 80, minLength: 0.47, maxLength: 0.53 },
]);

/** How far a node's surface centroid may sit from its origin, as a fraction of its size. */
export const BALGATH_BOULDER_CENTRE_TOLERANCE = 0.02;
