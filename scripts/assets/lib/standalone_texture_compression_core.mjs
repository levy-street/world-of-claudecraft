// Pure helpers for the standalone-image KTX2 conversion
// (scripts/assets/compress_standalone_textures.mjs) and its guard suite
// (tests/skin_atlas_ktx2_compression.test.ts). No sharp or child_process
// imports here: the test imports this module directly, so it must stay light.

/** `base.png` is the raw thumbnail source `skinThumbUrl()` falls back to; it
 *  is never a URL in SKINS/SKIN_EMISSIVE, so loadSkinTexInto never requests
 *  it and there is nothing to compress. Every OTHER png under the scanned
 *  directory is a real atlas some skin index points at. */
export function isConvertibleSkinPng(basename) {
  const lower = basename.toLowerCase();
  return lower.endsWith('.png') && lower !== 'base.png';
}

/** The KTX2 sibling loadSkinTexInto requests instead of the PNG: same
 *  directory, same basename, `.ktx2` extension. Never replaces the PNG,
 *  which stays on disk for tests/visual_manifest.test.ts and any future
 *  raw-image consumer. */
export function ktx2SiblingPath(pngPath) {
  if (!pngPath.toLowerCase().endsWith('.png')) {
    throw new Error(`not a .png path: ${pngPath}`);
  }
  return `${pngPath.slice(0, -4)}.ktx2`;
}

/** `ktx create` arguments for one atlas: Basis-LZ (ETC1S), the same
 *  non-normal-map "everything else" encode compress_glb_textures.mjs picks
 *  for GLB-embedded color textures, mipmapped, sRGB (every skin atlas is a
 *  color map, never a normal/occlusion slot), alpha-aware so an opaque
 *  atlas is not padded with an unused channel. */
export function buildKtxCreateArgs({ hasAlpha, srcPath, dstPath }) {
  return [
    'create',
    '--format',
    hasAlpha ? 'R8G8B8A8_SRGB' : 'R8G8B8_SRGB',
    '--encode',
    'basis-lz',
    '--generate-mipmap',
    '--assign-tf',
    'srgb',
    '--assign-primaries',
    'bt709',
    srcPath,
    dstPath,
  ];
}

export function parseArgs(argv, defaultDir) {
  const opts = { dir: defaultDir, dryRun: false, jobs: 4, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]) || 4);
    else opts.files.push(a);
  }
  return opts;
}
