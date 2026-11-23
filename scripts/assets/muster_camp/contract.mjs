// The Mirefen muster camp kit contract: one row per shipped GLB.
//
// Budgets were locked before the build and tightened after it (the image-to-glb
// skill, step 2). The factory is scripts/assets/muster_camp/model.py (Blender, run by
// export_muster_camp.mjs); the placement is src/render/muster_camps_core.ts; the
// shipped files are pinned byte for byte by tests/muster_camp_asset.test.ts.
//
// `tierClass` is each piece's DEFAULT graphics-tier class: `structure` draws on EVERY
// preset, `clutter` sheds on the low preset. The layout core
// (src/render/muster_camps_core.ts) owns the rule and may promote one placement (the
// command camp's gate torches) to structure.

/** Material buckets the factory may emit (names route the runtime surface detail). */
export const MUSTER_CAMP_MATERIALS = Object.freeze([
  'MusterWood',
  'MusterCloth',
  'MusterIron',
  'MusterRock',
  'MusterGlow',
  'MusterCrystal',
]);

/** The Blender release the raw export was authored and verified with. */
export const MUSTER_CAMP_BLENDER_VERSION = '5.2.1';

export const MUSTER_CAMP_PIECES = Object.freeze([
  {
    key: 'musterPalisade',
    file: 'muster_palisade',
    tierClass: 'structure',
    maxTriangles: 1700,
    maxBytes: 44 * 1024,
  },
  {
    key: 'musterBarricade',
    file: 'muster_barricade',
    tierClass: 'structure',
    maxTriangles: 2100,
    maxBytes: 50 * 1024,
  },
  {
    key: 'musterGate',
    file: 'muster_gate',
    tierClass: 'structure',
    maxTriangles: 3000,
    maxBytes: 64 * 1024,
  },
  {
    key: 'musterWatchtower',
    file: 'muster_watchtower',
    tierClass: 'structure',
    maxTriangles: 4000,
    maxBytes: 80 * 1024,
  },
  {
    key: 'musterTentLarge',
    file: 'muster_tent_large',
    tierClass: 'structure',
    maxTriangles: 900,
    maxBytes: 26 * 1024,
  },
  {
    key: 'musterTentSmall',
    file: 'muster_tent_small',
    tierClass: 'structure',
    maxTriangles: 900,
    maxBytes: 24 * 1024,
  },
  {
    key: 'musterWeaponRack',
    file: 'muster_weapon_rack',
    tierClass: 'structure',
    maxTriangles: 2100,
    maxBytes: 52 * 1024,
  },
  {
    key: 'musterLanternPost',
    file: 'muster_lantern_post',
    tierClass: 'structure',
    maxTriangles: 700,
    maxBytes: 24 * 1024,
  },
  {
    key: 'musterCrate',
    file: 'muster_crate',
    tierClass: 'clutter',
    maxTriangles: 700,
    maxBytes: 18 * 1024,
  },
  {
    key: 'musterBarrel',
    file: 'muster_barrel',
    tierClass: 'clutter',
    maxTriangles: 260,
    maxBytes: 10 * 1024,
  },
  {
    key: 'musterSacks',
    file: 'muster_sacks',
    tierClass: 'clutter',
    maxTriangles: 520,
    maxBytes: 14 * 1024,
  },
  {
    key: 'musterCartWheel',
    file: 'muster_cart_wheel',
    tierClass: 'clutter',
    maxTriangles: 760,
    maxBytes: 21 * 1024,
  },
  {
    key: 'musterTorch',
    file: 'muster_torch',
    tierClass: 'clutter',
    maxTriangles: 460,
    maxBytes: 22 * 1024,
  },
]);

/** The torch's flame socket height (yd above its seated base): the runtime flame in
 *  src/render/decor_torch_fx.ts sits exactly here. */
export const MUSTER_TORCH_FLAME_HEIGHT = 2.36;
