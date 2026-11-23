// The Fenbridge muster grapnel contract: ONE GLB under one scene root.
//
// The node NAMES are the runtime contract: the renderer loads
// `/models/vfx/muster_grapnel.glb` and flies the root along the healer's throw. The root's
// ORIGIN is the ring eye's centre, where the procedurally drawn rope ties on; the head
// hangs down -Y from it and the four prongs sit at the -Y end, their polished points
// curling back up toward +Y. `Grapnel_Hook` is the one mesh child. The shipped file is
// meshopt-quantized, which bakes a dequantizing translation and scale onto the MESH node:
// take the NODES (world transforms included), never the bare geometry. The factory is
// scripts/assets/muster_grapnel/model.py (Blender, run by export_muster_grapnel.mjs); the
// shipped file is pinned byte for byte by tests/muster_grapnel_asset.test.ts.

/** Everything the exporter verifies and the test pins, in the glTF frame (+Y up, +Z front). */
export const MUSTER_GRAPNEL = Object.freeze({
  /** The one shipped file, relative to public/. */
  file: 'models/vfx/muster_grapnel.glb',
  /** The raw export the factory writes under tmp/asset_src/muster_grapnel/. */
  rawName: 'muster_grapnel.glb',
  /** The factory's stdout report markers. */
  reportTag: 'MUSTER_GRAPNEL_REPORT',
  /** The scene root that carries the sculptRuntime extras. */
  root: 'Muster_Grapnel',
  assetId: 'muster-grapnel',
  /** The Blender release the raw export was authored and verified with. */
  blenderVersion: '5.2.1',
  /** Byte ceiling for the optimized GLB. */
  maxBytes: 24 * 1024,
  /** Triangle ceiling for the whole grapnel. */
  maxTriangles: 500,
  /** Material buckets the factory may emit (distinct PBR values each, so dedup keeps them). */
  materials: Object.freeze(['MusterIron', 'MusterSteel', 'MusterCloth', 'MusterRope']),
  /** Materials the renderer makes emissive: none on the grapnel. */
  glowMaterials: Object.freeze([]),
  /** Every named node, its parent, whether it carries a mesh, and its triangle ceiling. */
  nodes: Object.freeze([
    { name: 'Grapnel_Hook', parent: 'Muster_Grapnel', mesh: true, maxTriangles: 500 },
  ]),
  /** Empty pivots and sockets whose translation is load-bearing (parent frame). */
  anchors: Object.freeze({}),
  /** The whole grapnel's world bounds: the ring round the origin, about 0.7 long down -Y. */
  bounds: Object.freeze({
    min: [-0.174, -0.626, -0.174],
    max: [0.174, 0.06, 0.174],
    tolerance: 0.01,
  }),
});
