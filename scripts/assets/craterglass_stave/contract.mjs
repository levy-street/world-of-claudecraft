// The Craterglass Stave contract: ONE held-weapon GLB under one scene root.
//
// The stave is HELD: src/render/characters/manifest.ts attaches
// `models/weapons/craterglass_stave.glb` to the right hand through the VAR_STAFF grip
// family, which attaches at the ORIGIN and never rescales a staff under 2.4 long. So the
// origin IS the grip, the staff runs along +Y with the head up, and it spans y -0.912 to
// 1.368 (2.28 long, grip 40 percent up), exactly the measured staff convention
// (scripts/asset_pipeline/lib/families.mjs `staff`, the shipped knotted_oak_stave.glb and
// forgeheart_stave.glb). The head's wide axis lies on X. The root is an empty (the held
// loader flattens the scene's one child and zeroes its transform, so no mesh may sit on
// the root); `Stave_Shaft` and `Stave_Head` are its mesh children and `Socket_Core`
// marks the star-glint core. The material whose name contains `StaveGlow` is emissive.
// The factory is scripts/assets/craterglass_stave/model.py (Blender, run by
// export_craterglass_stave.mjs); the shipped file is pinned byte for byte by
// tests/craterglass_stave_asset.test.ts.

/** Everything the exporter verifies and the test pins, in the glTF frame (+Y up, +Z front). */
export const CRATERGLASS_STAVE = Object.freeze({
  /** The one shipped file, relative to public/. */
  file: 'models/weapons/craterglass_stave.glb',
  /** The raw export the factory writes under tmp/asset_src/craterglass_stave/. */
  rawName: 'craterglass_stave.glb',
  /** The factory's stdout report markers. */
  reportTag: 'CRATERGLASS_STAVE_REPORT',
  /** The scene root that carries the sculptRuntime extras. */
  root: 'Craterglass_Stave',
  assetId: 'craterglass-stave',
  /** The Blender release the raw export was authored and verified with. */
  blenderVersion: '5.2.1',
  /** Byte ceiling for the optimized GLB. */
  maxBytes: 64 * 1024,
  /** Triangle ceiling for the whole stave. */
  maxTriangles: 1800,
  /** Material buckets the factory may emit (distinct PBR values each, so dedup keeps them). */
  materials: Object.freeze([
    'StaveBogOak',
    'StaveIron',
    'StaveBronze',
    'StaveLeather',
    'StaveGlass',
    'StaveGlow',
  ]),
  /** Materials the renderer makes emissive (shipped with an emissive factor already). */
  glowMaterials: Object.freeze(['StaveGlow']),
  /** Every named node, its parent, whether it carries a mesh, and its triangle ceiling. */
  nodes: Object.freeze([
    { name: 'Stave_Shaft', parent: 'Craterglass_Stave', mesh: true, maxTriangles: 900 },
    { name: 'Stave_Head', parent: 'Craterglass_Stave', mesh: true, maxTriangles: 600 },
    { name: 'Socket_Core', parent: 'Craterglass_Stave', mesh: false },
  ]),
  /** Empty pivots and sockets whose translation is load-bearing (parent frame). */
  anchors: Object.freeze({ Socket_Core: Object.freeze([0.00041, 1.17, 0.002701]) }),
  /** The staff convention: butt at -0.912, tallest shard point at 1.368, head wide on X. */
  bounds: Object.freeze({
    min: [-0.154, -0.912, -0.099],
    max: [0.156, 1.368, 0.129],
    tolerance: 0.005,
  }),
});
