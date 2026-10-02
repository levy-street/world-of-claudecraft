// The Guttered Eye contract: ONE GLB under one scene root.
//
// The node NAMES are the runtime contract: the renderer loads
// `/models/vfx/guttered_eye.glb`, floats the root above the wearer (origin at the lens
// centre, +Y up) and fires the turquoise beam from `Socket_Beam` along +Z, the way the
// lens faces. `Eye_Lens` carries the glowing crystal (the material whose name contains
// `EyeGlow`, the one the renderer makes emissive) plus the dark burnt pupil and crack
// lines; `Eye_Cage` is the blackened iron socket, its claws and the torn sinew. The
// shipped file is meshopt-quantized, which bakes a dequantizing translation and scale
// onto every MESH node: take the NODES (world transforms included), never the bare
// geometry. The factory is scripts/assets/guttered_eye/model.py (Blender, run by
// export_guttered_eye.mjs); the shipped file is pinned byte for byte by
// tests/guttered_eye_asset.test.ts.

/** Everything the exporter verifies and the test pins, in the glTF frame (+Y up, +Z front). */
export const GUTTERED_EYE = Object.freeze({
  /** The one shipped file, relative to public/. */
  file: 'models/vfx/guttered_eye.glb',
  /** The raw export the factory writes under tmp/asset_src/guttered_eye/. */
  rawName: 'guttered_eye.glb',
  /** The factory's stdout report markers. */
  reportTag: 'GUTTERED_EYE_REPORT',
  /** The scene root that carries the sculptRuntime extras. */
  root: 'Guttered_Eye',
  assetId: 'guttered-eye',
  /** The Blender release the raw export was authored and verified with. */
  blenderVersion: '5.2.1',
  /** Byte ceiling for the optimized GLB. */
  maxBytes: 40 * 1024,
  /** Triangle ceiling for the whole eye. */
  maxTriangles: 780,
  /** Material buckets the factory may emit (distinct PBR values each, so dedup keeps them). */
  materials: Object.freeze([
    'GutteredEyeGlow',
    'GutteredEyeCrack',
    'GutteredEyeIron',
    'GutteredEyeSinew',
  ]),
  /** Materials the renderer makes emissive (shipped with an emissive factor already). */
  glowMaterials: Object.freeze(['GutteredEyeGlow']),
  /** Every named node, its parent, whether it carries a mesh, and its triangle ceiling. */
  nodes: Object.freeze([
    { name: 'Eye_Lens', parent: 'Guttered_Eye', mesh: true, maxTriangles: 200 },
    { name: 'Eye_Cage', parent: 'Guttered_Eye', mesh: true, maxTriangles: 590 },
    { name: 'Socket_Beam', parent: 'Guttered_Eye', mesh: false },
  ]),
  /** Empty pivots and sockets whose translation is load-bearing (parent frame). */
  anchors: Object.freeze({ Socket_Beam: Object.freeze([0, 0, 0.144]) }),
  /** The whole eye's world bounds: about 0.55 across, the sinew hanging below. */
  bounds: Object.freeze({
    min: [-0.272, -0.52, -0.216],
    max: [0.269, 0.304, 0.15],
    tolerance: 0.01,
  }),
});
