// Convert the PAINTED (LDR) equirect skies under skies_in/ to KTX2 (UASTC LDR, sRGB,
// zstd), the LDR twin of compress_sky_hdr.mjs.
//
// Sources: skies_in/vale_painted_day.png and skies_in/vale_painted_night.png, the
// hand-painted Eastbrook Vale day and night panoramas (generated with ChatGPT image
// generation, delivered 1774x887, exactly 2:1). They REPLACE the photographic vale_day
// HDRI as the vale (and beach) dome and IBL source; see src/render/sky.ts and
// src/render/sky_painted_core.ts. To repaint, overwrite the PNG and re-run:
//
//   node scripts/assets/compress_sky_ldr.mjs
//   node scripts/build_media_manifest.mjs generate
//
// then paste the printed `glow u` into sky.ts (HDRI_SUN_U for a day sky,
// PAINTED_NIGHT_GLOW_U for a night sky) if the painted sun or moonlit glow moved.
//
// Usage: node scripts/assets/compress_sky_ldr.mjs [options] [stems...]
//   --src <path>   directory holding the painted .png sources (default skies_in)
//   --out <path>   directory the .ktx2 files are written to (default public/env)
//   --dry-run      report what would be converted, write nothing
// With explicit [stems...] only those skies are re-encoded (e.g.
// `node scripts/assets/compress_sky_ldr.mjs vale_painted_night`).
//
// Per variant (`_2k` 2048x1024 and `_1k` 1024x512 for the two dome tiers, `_512`
// 512x256 for the PMREM prefilter source, day skies only), with sharp and the pure
// pre-process in lib/sky_ldr_compression_core.mjs:
//   1. an exact 2:1 resize (a non-2:1 source is stretched to fill, never cropped, and
//      the run log reports how far off 2:1 it was),
//   2. a horizontal wrap blend so the left and right edges meet with no seam line,
//   3. a soft fill of the zenith rows toward one colour so the pole does not pinch,
//   4. a vertical flip (three uploads compressed rows bottom first and ignores flipY),
//   plus, on the dome variants, a gentle brush edge boost (SKY_SHARPEN) so the clouds
//   and the milky glow read crisper magnified, and on the night the painted stars are
//   removed (the dome draws crisp procedural ones) with their density kept in alpha,
// then `ktx create` writes UASTC LDR + zstd with the sRGB transfer function. The
// codec choice and its banding measurements are recorded at buildKtxLdrSkyArgs.
//
// Requires the `ktx` tool from KhronosGroup/KTX-Software 4.3 or newer on PATH (see
// compress_glb_textures.mjs for install notes). The encode is deterministic on one
// toolchain: a re-run with the same sharp and ktx versions reproduces the bytes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  buildKtxLdrSkyArgs,
  equirectResizePlan,
  parseArgs as parseArgsCore,
  prepareSkyPixels,
  SKY_LDR_STEMS,
  skyLdrJobs,
  skyLdrPaths,
} from './lib/sky_ldr_compression_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_SRC_DIR = path.join(ROOT, 'skies_in');
const DEFAULT_OUT_DIR = path.join(ROOT, 'public', 'env');

export function parseArgs(argv) {
  const opts = parseArgsCore(argv, { srcDir: DEFAULT_SRC_DIR, outDir: DEFAULT_OUT_DIR });
  opts.srcDir = path.resolve(opts.srcDir);
  opts.outDir = path.resolve(opts.outDir);
  return opts;
}

function runKtx(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ktx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function checkKtxTool() {
  const { code } = await runKtx(['--version']).catch(() => ({ code: -1 }));
  if (code !== 0) {
    throw new Error(
      'Command "ktx" not found or not runnable. Install KTX-Software 4.3+ from ' +
        'https://github.com/KhronosGroup/KTX-Software and put its bin/ on PATH.',
    );
  }
}

function failureReason(stdout, stderr, fallback) {
  return (stderr.trim() || stdout.trim()).split('\n').slice(-1)[0] || fallback;
}

/** Resize one source to a variant and run the pure pre-process over it. */
export async function preparedVariant(srcPath, job) {
  const meta = await sharp(srcPath).metadata();
  const plan = equirectResizePlan(meta.width, meta.height, job.variant);
  const { data, info } = await sharp(srcPath)
    .toColourspace('srgb')
    .removeAlpha()
    .resize(plan.width, plan.height, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== plan.width || info.height !== plan.height || info.channels !== 3) {
    throw new Error(
      `resize produced ${info.width}x${info.height}x${info.channels}, expected ${plan.width}x${plan.height}x3`,
    );
  }
  return {
    plan,
    ...prepareSkyPixels(data, plan.width, plan.height, 3, {
      removeStars: job.removeStars,
      sharpen: job.sharpen,
    }),
  };
}

/**
 * Encode one job. The staging PNG (lossless, the pre-processed pixels) and the ktx
 * output both live in a private mkdtemp next to the destination, and the output is
 * renamed over the destination only after the encoder wrote it, so a failed encode can
 * never leave a stale or half-written file standing in for a fresh one.
 */
export async function convertJob(job, { srcDir, outDir, dryRun, runKtxCommand = runKtx }) {
  const { srcPath, dstPath } = skyLdrPaths(job, { srcDir, outDir });
  if (!fs.existsSync(srcPath)) {
    return { job, status: 'failed', reason: `missing source ${job.source}`, before: 0, after: 0 };
  }
  const before = fs.statSync(srcPath).size;
  if (dryRun) return { job, status: 'would-convert', before, after: before };

  const prepared = await preparedVariant(srcPath, job);
  fs.mkdirSync(outDir, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(outDir, `.${job.target}-`));
  try {
    const stagedPng = path.join(stagingDir, `${job.stem}_${job.variant}.png`);
    const tmpPath = path.join(stagingDir, job.target);
    await sharp(Buffer.from(prepared.pixels), {
      raw: {
        width: prepared.plan.width,
        height: prepared.plan.height,
        channels: prepared.channels,
      },
    })
      .png()
      .toFile(stagedPng);
    const { code, stdout, stderr } = await runKtxCommand(
      buildKtxLdrSkyArgs({ srcPath: stagedPng, dstPath: tmpPath, alpha: prepared.channels === 4 }),
    );
    if (code !== 0 || !fs.existsSync(tmpPath)) {
      const reason = failureReason(stdout, stderr, `encoder did not write ${job.target}`);
      return { job, status: 'failed', reason, before, after: before };
    }
    fs.renameSync(tmpPath, dstPath);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  return {
    job,
    status: 'converted',
    before,
    after: fs.statSync(dstPath).size,
    glowU: prepared.glowU,
    aspectError: prepared.plan.aspectError,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dryRun) await checkKtxTool();
  const unknown = opts.stems.filter((s) => !SKY_LDR_STEMS.includes(s));
  if (unknown.length) {
    throw new Error(
      `unknown painted sky stem(s): ${unknown.join(', ')}. Known: ${SKY_LDR_STEMS.join(', ')}`,
    );
  }
  const jobs = skyLdrJobs(opts.stems.length ? opts.stems : SKY_LDR_STEMS);
  const results = [];
  // Sequential on purpose: each encode is single-threaded for determinism, and the
  // whole set is five files.
  for (const job of jobs) {
    let r;
    try {
      r = await convertJob(job, opts);
    } catch (err) {
      r = { job, status: 'failed', reason: String(err), before: 0, after: 0 };
    }
    results.push(r);
    const delta = `${(r.before / 1024).toFixed(0)}K -> ${(r.after / 1024).toFixed(0)}K`;
    const glow = r.glowU === undefined ? '' : `  glow u ${r.glowU.toFixed(3)}`;
    const aspect =
      r.aspectError === undefined || Math.abs(r.aspectError) < 1e-3
        ? ''
        : `  (source is ${(r.aspectError * 100).toFixed(1)} percent off 2:1, stretched)`;
    console.log(
      `${r.status.padEnd(14)} ${delta.padStart(16)}  ${job.target}${glow}${aspect}${r.reason ? `  (${r.reason})` : ''}`,
    );
  }
  const count = (status) => results.filter((r) => r.status === status).length;
  console.log(
    `\n${count('converted')} converted, ${count('would-convert')} pending (dry run), ` +
      `${count('failed')} failed. After converting, regenerate the media manifest: ` +
      'node scripts/build_media_manifest.mjs generate',
  );
  if (count('failed')) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
