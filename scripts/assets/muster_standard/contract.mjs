// The Fenbridge muster standard contract: ONE GLB under one scene root.
//
// The node NAMES are the runtime contract: the renderer loads
// `/models/vfx/muster_standard.glb`, plants the root (origin at the iron spike point,
// +Y up, the banner facing +Z) and sways the cloth by rotating the `Standard_Banner`
// node about its local X axis. `Standard_Banner` is an EMPTY pivot sitting exactly on
// the crossbar axis; the cloth mesh is its child `Standard_Banner_Cloth`. The pivot is
// an empty because the shipped file is meshopt-quantized, which bakes a dequantizing
// translation and scale onto every MESH node: take the NODES (world transforms
// included), never the bare geometry. The factory is
// scripts/assets/muster_standard/model.py (Blender, run by export_muster_standard.mjs);
// the shipped file is pinned byte for byte by tests/muster_standard_asset.test.ts.

/** Everything the exporter verifies and the test pins, in the glTF frame (+Y up, +Z front). */
export const MUSTER_STANDARD = Object.freeze({
  /** The one shipped file, relative to public/. */
  file: 'models/vfx/muster_standard.glb',
  /** The raw export the factory writes under tmp/asset_src/muster_standard/. */
  rawName: 'muster_standard.glb',
  /** The factory's stdout report markers. */
  reportTag: 'MUSTER_STANDARD_REPORT',
  /** The scene root that carries the sculptRuntime extras. */
  root: 'Muster_Standard',
  assetId: 'muster-standard',
  /** The Blender release the raw export was authored and verified with. */
  blenderVersion: '5.2.1',
  /** Byte ceiling for the optimized GLB. */
  maxBytes: 64 * 1024,
  /** Triangle ceiling for the whole standard. */
  maxTriangles: 1700,
  /** Material buckets the factory may emit (distinct PBR values each, so dedup keeps them). */
  materials: Object.freeze([
    'MusterOak',
    'MusterIron',
    'MusterBrass',
    'MusterLeather',
    'MusterCloth',
  ]),
  /** Materials the renderer makes emissive: none on the standard. */
  glowMaterials: Object.freeze([]),
  /** Every named node, its parent, whether it carries a mesh, and its triangle ceiling. */
  nodes: Object.freeze([
    { name: 'Standard_Pole', parent: 'Muster_Standard', mesh: true, maxTriangles: 800 },
    { name: 'Standard_Banner', parent: 'Muster_Standard', mesh: false },
    { name: 'Standard_Banner_Cloth', parent: 'Standard_Banner', mesh: true, maxTriangles: 820 },
    { name: 'Standard_Finial', parent: 'Muster_Standard', mesh: true, maxTriangles: 160 },
  ]),
  /** Empty pivots and sockets whose translation is load-bearing (parent frame). */
  anchors: Object.freeze({ Standard_Banner: Object.freeze([0, 2.85, 0.074]) }),
  /** The whole standard's world bounds: spike point at y 0, finial tip at 3.3. */
  bounds: Object.freeze({ min: [-0.735, 0, -0.223], max: [0.735, 3.3, 0.149], tolerance: 0.01 }),
});
