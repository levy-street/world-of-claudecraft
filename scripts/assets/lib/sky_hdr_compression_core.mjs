// Pure helpers for the biome sky KTX2 conversion (scripts/assets/
// compress_sky_hdr.mjs) and its guard suite (tests/sky_ktx2_assets.test.ts).
// No child_process imports here: the tests import this module directly, so it
// must stay light.
import path from 'node:path';

/**
 * The equirect sky sources under public/env that src/render/sky.ts references,
 * one stem per shipped sky. Restated here rather than derived because the
 * encoder is a plain Node script and cannot import the TypeScript tables;
 * tests/sky_ktx2_assets.test.ts pins this list against the urls sky.ts
 * actually asks for, so a new sky fails that suite until it is encoded.
 *
 * `night_*.hdr` is deliberately absent: it is an orphan on disk that no sky
 * table points at (the Nightbloom uses nightbloom_dream), so encoding it would
 * ship dead bytes.
 */
export const SKY_HDR_STEMS = [
  'amber_sunset',
  'ember_storm',
  'evergarden_day',
  'farshore_day',
  'fen_day',
  'frost_twilight',
  'galecrest_day',
  'hollow_dusk',
  'marsh_overcast',
  'nightbloom_dream',
  'palmreach_day',
  'peaks_dawn',
  'vale_day',
  'wraithwood_gloom',
];

/**
 * The three KTX2 variants each sky ships, and which `.hdr` each is encoded
 * from. The two dome variants mirror the tiers sky.ts already picks between
 * (BIOME_SKY_2K on the full tier, BIOME_SKY_1K on the lite one). The `512`
 * variant is the PMREM prefilter source: a CompressedTexture cannot be resized
 * at runtime the way loadHdr's `maxWidth` resampled the decoded pixels, so the
 * downscale is baked here, from the 1k source and to the same 512x256 the
 * runtime produced.
 */
export const SKY_KTX2_VARIANTS = [
  { suffix: '2k', source: '2k', resample: null },
  { suffix: '1k', source: '1k', resample: null },
  { suffix: '512', source: '1k', resample: { width: 512, height: 256 } },
];

/** UASTC HDR encoding level. Levels 1 through 3 measured within noise of each
 *  other on the widest-range skies (about 61 dB BC6H PSNR on the ember storm,
 *  the error concentrated in the sun disc the dome shader clamps anyway), so
 *  this matches the `--uastc-quality 2` the LDR standalone pipeline uses rather
 *  than paying for a level whose benefit did not measure. */
export const SKY_UASTC_LEVEL = 2;

/** Zstandard supercompression level, matching the LDR standalone pipeline's
 *  `--zstd 18`. A 2k dome lands near 1.8 MB, against 8.4 MB as Radiance. */
export const SKY_ZSTD_LEVEL = 18;

/** The `.hdr` file one variant is encoded from. */
export function skyHdrSourceName(stem, variant) {
  return `${stem}_${variant.source}.hdr`;
}

/** The `.ktx2` file one variant writes. */
export function skyKtx2Name(stem, variant) {
  return `${stem}_${variant.suffix}.ktx2`;
}

/** Every (source, target) pair the converter runs, in a stable order. */
export function skyKtx2Jobs(stems = SKY_HDR_STEMS, variants = SKY_KTX2_VARIANTS) {
  const jobs = [];
  for (const stem of stems) {
    for (const variant of variants) {
      jobs.push({
        stem,
        variant: variant.suffix,
        source: skyHdrSourceName(stem, variant),
        target: skyKtx2Name(stem, variant),
        resample: variant.resample,
      });
    }
  }
  return jobs;
}

/**
 * `basisu` arguments for one sky.
 *
 * `-hdr` selects UASTC HDR 4x4, which writes vkFormat ASTC_4x4_SFLOAT_BLOCK
 * with DFD colorModel 0xA7. That pair is exactly what three's KTX2Loader
 * recognizes as Basis HDR, so the file uploads as native ASTC HDR where the
 * GPU exposes the profile and transcodes to BC6H (or RGBA half) where it does
 * not. A plain `--format ASTC_4x4_SFLOAT_BLOCK` encode carries the ASTC color
 * model instead and three would upload it raw on EVERY device, with no
 * fallback for the ones that cannot sample it.
 *
 * `-y_flip` is load-bearing. The Radiance path decoded top-row-first and let
 * `flipY = true` flip at upload time; three ignores flipY for compressed
 * uploads, so the flip is baked in here or the whole sky samples upside down.
 *
 * No `-mipmap`: the dome and the PMREM source both sampled a single level with
 * LinearFilter before, and a mip chain would only add bytes nothing reads.
 */
export function buildBasisuHdrArgs({
  srcPath,
  dstPath,
  resample = null,
  uastcLevel = SKY_UASTC_LEVEL,
  zstdLevel = SKY_ZSTD_LEVEL,
}) {
  const args = [
    '-hdr',
    '-ktx2',
    '-uastc_level',
    String(uastcLevel),
    '-ktx2_zstandard_level',
    String(zstdLevel),
    '-y_flip',
  ];
  if (resample) args.push('-resample', String(resample.width), String(resample.height));
  args.push('-output_file', dstPath, srcPath);
  return args;
}

/** Absolute paths for one job, against the directory holding the sources. */
export function skyKtx2Paths(job, dir) {
  return { srcPath: path.join(dir, job.source), dstPath: path.join(dir, job.target) };
}

export function parseArgs(argv, defaultDir) {
  const opts = { dir: defaultDir, dryRun: false, jobs: 4, stems: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]) || 4);
    else opts.stems.push(a);
  }
  return opts;
}
