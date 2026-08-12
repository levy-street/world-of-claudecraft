// Pure helpers for the standalone-image KTX2 conversion (scripts/assets/
// compress_standalone_textures.mjs) and its guard suites
// (tests/skin_atlas_ktx2_compression.test.ts, tests/surface_texture_ktx2.test.ts).
// No sharp or child_process imports here: the tests import this module
// directly, so it must stay light.
import path from 'node:path';

/** `base.png` is the raw thumbnail source `skinThumbUrl()` falls back to; it
 *  is never a URL in SKINS/SKIN_EMISSIVE, so loadSkinTexInto never requests
 *  it and there is nothing to compress. */
const UNUSED_THUMBNAIL_SOURCE = 'base.png';

/** Source extensions that can carry a `.ktx2` sibling: the skin atlases ship
 *  as PNG, the ambientCG terrain/structure packs as JPG. */
const CONVERTIBLE_EXTENSIONS = ['.png', '.jpg'];

/** Every OTHER png under the scanned skins directory is a real atlas some skin
 *  index points at. */
export function isConvertibleSkinPng(basename) {
  const lower = basename.toLowerCase();
  return lower.endsWith('.png') && lower !== UNUSED_THUMBNAIL_SOURCE;
}

/** Directory-walk gate for the general case (skin atlases AND the ambientCG
 *  terrain/structure JPGs), same `base.png` carve-out. */
export function isConvertibleStandaloneImage(basename) {
  const lower = basename.toLowerCase();
  if (lower === UNUSED_THUMBNAIL_SOURCE) return false;
  return CONVERTIBLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** The KTX2 sibling the runtime requests instead of the source image: same
 *  directory, same basename, `.ktx2` extension. Never replaces the source,
 *  which stays on disk for tests/visual_manifest.test.ts, the voxel-terrain
 *  prototype, and any future raw-image consumer. */
export function ktx2SiblingPath(srcPath) {
  const lower = srcPath.toLowerCase();
  const ext = CONVERTIBLE_EXTENSIONS.find((e) => lower.endsWith(e));
  if (!ext) throw new Error(`not a convertible image path: ${srcPath}`);
  return `${srcPath.slice(0, -ext.length)}.ktx2`;
}

// ambientCG-style PBR channel suffix -> encoder + transfer function.
// NormalGL / AmbientOcclusion / Displacement carry per-texel GEOMETRY, and
// ETC1S's endpoint clustering is exactly what bands that kind of smooth
// gradient, so they take UASTC (the same split compress_glb_textures.mjs
// makes with its UASTC_SLOTS normal/occlusion filter) plus zstd
// supercompression to claw the payload back. `_Color` is an ordinary sRGB
// color map. `_Roughness` and `_Metalness` are single-signal linear masks
// whose ETC1S artifacts stay under the material response.
const CHANNEL_CLASSES = {
  normalgl: { encoding: 'uastc', transferFunction: 'linear' },
  ambientocclusion: { encoding: 'uastc', transferFunction: 'linear' },
  displacement: { encoding: 'uastc', transferFunction: 'linear' },
  color: { encoding: 'basis-lz', transferFunction: 'srgb' },
  roughness: { encoding: 'basis-lz', transferFunction: 'linear' },
  metalness: { encoding: 'basis-lz', transferFunction: 'linear' },
};

/** Character skin/cosmetic atlases carry no channel suffix at all; every one
 *  of them is a color map, which is what the pipeline shipped before the
 *  terrain/structure sets joined it. */
const UNSUFFIXED_CLASS = { encoding: 'basis-lz', transferFunction: 'srgb' };

/** Pick the encoder and transfer function for one standalone texture from its
 *  ambientCG channel suffix. `channel` is null for the unsuffixed atlases. */
export function classifyStandaloneTexture(basename) {
  const stem = basename.replace(/\.[^.]*$/, '');
  const cut = stem.lastIndexOf('_');
  const suffix = cut < 0 ? '' : stem.slice(cut + 1);
  const cls = CHANNEL_CLASSES[suffix.toLowerCase()];
  return cls ? { channel: suffix, ...cls } : { channel: null, ...UNSUFFIXED_CLASS };
}

/** `ktx create` arguments for one standalone texture. UASTC is linear-only
 *  here by construction (the classifier never pairs it with a color map), and
 *  the sRGB arm keeps the alpha-aware format selection so an opaque atlas is
 *  not padded with an unused channel. */
export function buildKtxCreateArgs({
  hasAlpha,
  srcPath,
  dstPath,
  encoding = 'basis-lz',
  transferFunction = 'srgb',
}) {
  // Both linear arms encode RGB only: every linear channel today is a JPG
  // (never alpha). Refuse loudly rather than silently dropping a channel if
  // a linear source with alpha ever appears (review round 1).
  if (hasAlpha && transferFunction === 'linear') {
    throw new Error(`linear arms encode RGB only, but ${srcPath} has alpha`);
  }
  if (encoding === 'uastc') {
    return [
      'create',
      '--format',
      'R8G8B8_UNORM',
      '--encode',
      'uastc',
      '--uastc-quality',
      '2',
      '--zstd',
      '18',
      '--generate-mipmap',
      '--assign-tf',
      'linear',
      srcPath,
      dstPath,
    ];
  }
  if (transferFunction === 'linear') {
    return [
      'create',
      '--format',
      'R8G8B8_UNORM',
      '--encode',
      'basis-lz',
      '--generate-mipmap',
      '--assign-tf',
      'linear',
      srcPath,
      dstPath,
    ];
  }
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

/** Where the `--flip` pass writes the vertically flipped copy `ktx create`
 *  actually reads. A CompressedTexture cannot honor `flipY` at runtime (three
 *  ignores it for compressed uploads), and the terrain/structure JPGs were
 *  consumed through TextureLoader with the default `flipY = true`, so the flip
 *  is baked at compress time to keep sampling pixel-identical to the raw path.
 *  Skin atlases are NOT flipped: they are consumed at `flipY = false`, the
 *  glTF UV convention their rigs are authored against.
 *  The name slugs the WHOLE source path, so two same-named channel maps from
 *  different pack directories cannot collide in one flat temp directory.
 *  The tmpDir the converter passes is a PRIVATE per-run mkdtemp (0700), never
 *  the shared os.tmpdir(): a predictable path in shared temp is pre-creatable
 *  and race-swappable by any local process (review round 2). */
export function flippedSourcePath(srcPath, tmpDir) {
  const slug = srcPath.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+/, '');
  return path.join(tmpDir, `${slug}.flip.png`);
}

/** `ktx create` rejects a source whose dimensions are not a multiple of the
 *  4x4 block the ETC1S/UASTC encoders work in. Returns null when the source is
 *  fine, otherwise the reason to report. */
export function blockAlignmentError(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return `unreadable image dimensions (${width}x${height})`;
  }
  if (width % 4 !== 0 || height % 4 !== 0) {
    return `dimensions ${width}x${height} are not multiples of 4 (ktx block size)`;
  }
  return null;
}

export function parseArgs(argv, defaultDir) {
  const opts = { dir: defaultDir, dryRun: false, flip: false, jobs: 4, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--flip') opts.flip = true;
    else if (a === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]) || 4);
    else opts.files.push(a);
  }
  return opts;
}
