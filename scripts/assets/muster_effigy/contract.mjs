// The muster training effigy and stake mallet contract: one row per shipped GLB.
//
// The factory is scripts/assets/muster_effigy/model.py (Blender, run by
// export_muster_effigy.mjs); the shipped files are pinned byte for byte by
// tests/muster_effigy_asset.test.ts. Budgets were set before the build and tightened
// after it (the image-to-glb skill, step 2).

/** Material buckets the factory may emit (names route the runtime surface detail and
 *  the lantern glow). */
export const MUSTER_EFFIGY_MATERIALS = Object.freeze([
  'EffigyWood',
  'EffigyStraw',
  'EffigyRope',
  'EffigyIron',
  'EffigyCloth',
  'EffigyGlass',
  'EffigyRock',
]);

/** The Blender release the raw export was authored and verified with. */
export const MUSTER_EFFIGY_BLENDER_VERSION = '5.2.1';

export const MUSTER_EFFIGY_PIECES = Object.freeze([
  {
    key: 'musterEffigy',
    file: 'muster_effigy',
    dir: 'models/creatures',
    maxTriangles: 9000,
    maxBytes: 180 * 1024,
  },
  {
    key: 'musterMallet',
    file: 'muster_mallet',
    dir: 'models/weapons',
    maxTriangles: 700,
    maxBytes: 24 * 1024,
  },
]);

/** The effigy stands about half Balgath's in-game height (yd, floor to crown). */
export const MUSTER_EFFIGY_HEIGHT = Object.freeze({ min: 6.6, max: 6.8 });

/** The lantern flame (the pike's target), yd above the seated base: the
 *  `LanternFlame` node sits exactly here and the root extras record it. */
export const MUSTER_EFFIGY_LANTERN_HEIGHT = 5.36;

/** How many detachable plank groups (`Plank_NN` nodes) the hide may carry. */
export const MUSTER_EFFIGY_PLANKS = Object.freeze({ min: 8, max: 16 });

/** The mallet is authored in the KayKit two-handed axe's grip frame
 *  (models/weapons/axe_2handed.glb): one mesh node, handle along +Y, butt and crown on
 *  the axe's (world y), centred on the handle axis. Meshopt quantization folds those
 *  bounds into the node, so the shipped node carries the axe's translation and
 *  uniform scale, which is what the runtime `2H_Axe` hand grip keys on. */
export const MUSTER_MALLET_GRIP = Object.freeze({
  reference: 'models/weapons/axe_2handed.glb',
  buttY: -0.433,
  crownY: 1.2916,
  translationY: 0.4293,
  scale: 0.8623,
});
