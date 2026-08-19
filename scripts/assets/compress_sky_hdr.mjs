// Convert the biome sky HDRIs under public/env to KTX2 (UASTC HDR 4x4), the
// HDR twin of compress_standalone_textures.mjs.
//
// A Radiance sky used to be fetched whole (8.4 MB at 2k), RGBE-decoded in a
// worker, and uploaded as a half-float RGBA DataTexture: about 16.8 MB of CPU
// pixels plus the same again on the GPU, per resident biome, plus a second
// smaller texture for the PMREM source. UASTC HDR is one byte per pixel: the
// same 2k dome is 2 MB on the GPU where the device exposes ASTC HDR or BC6H,
// there is no CPU float buffer to keep, and no RGBE decode step at all. On a
// device with neither format three transcodes to RGBA half, which costs what
// the Radiance path already cost.
//
// Usage: node scripts/assets/compress_sky_hdr.mjs [options] [stems...]
//   --dir <path>   directory holding the sky .hdr sources (default public/env)
//   --dry-run      report what would be converted, write nothing
//   --jobs <n>     file-level parallelism (default 4)
// With explicit [stems...] arguments only those skies are re-encoded (e.g.
// `node scripts/assets/compress_sky_hdr.mjs ember_storm`), which is how a
// single repainted sky is refreshed without touching the other committed
// outputs.
//
// Emits three `.ktx2` files per sky next to the sources: `_2k` and `_1k` for
// the two dome tiers and `_512` for the PMREM prefilter source. The `.hdr`
// sources are never deleted or replaced: they are the only HDR masters in the
// repo (skies_in/ holds LDR PNGs and the PNG-to-Radiance step is a local tool),
// so they stay committed as the encoder's input.
//
// Requires `basisu` from BinomialLLC/basis_universal v1.50 or newer on PATH.
// KTX-Software's `ktx` CANNOT stand in: through 4.4 its `create --encode` takes
// only `basis-lz` and `uastc` (both LDR) and it rejects `--format
// ASTC_4x4_SFLOAT_BLOCK` outright, so it cannot write a UASTC HDR payload at
// all. Build the encoder with:
//   git clone --depth 1 --branch v1_60 https://github.com/BinomialLLC/basis_universal
//   cmake -S basis_universal -B basis_universal/build -DCMAKE_BUILD_TYPE=Release
//   cmake --build basis_universal/build -j
// then put basis_universal/bin on PATH. The encode is deterministic (verified
// byte-identical across repeat runs and with multithreading on or off), so a
// re-run of an unchanged sky reproduces the committed bytes.
//
// After a run, regenerate the media manifest:
//   node scripts/build_media_manifest.mjs generate
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBasisuHdrArgs,
  parseArgs as parseArgsCore,
  SKY_HDR_STEMS,
  skyKtx2Jobs,
  skyKtx2Paths,
} from './lib/sky_hdr_compression_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DIR = path.join(ROOT, 'public', 'env');

export function parseArgs(argv) {
  const opts = parseArgsCore(argv, DEFAULT_DIR);
  opts.dir = path.resolve(opts.dir);
  return opts;
}

function runBasisu(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('basisu', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    // basisu reports encode failures on stdout with a zero exit code in some
    // modes, so the caller checks the output file too.
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function checkBasisuTool() {
  const { code } = await runBasisu(['-version']).catch(() => ({ code: -1 }));
  if (code !== 0) {
    throw new Error(
      'Command "basisu" not found or not runnable. Build BinomialLLC/basis_universal ' +
        "v1.50 or newer and put its bin/ on PATH (see this file's header; the " +
        'KTX-Software "ktx" tool cannot write UASTC HDR).',
    );
  }
}

function basisuFailureReason(stdout, stderr, fallback) {
  return (stderr.trim() || stdout.trim()).split('\n').slice(-1)[0] || fallback;
}

function makeTempOutputPath(dstPath) {
  const dstDir = path.dirname(dstPath);
  const stagingDir = fs.mkdtempSync(path.join(dstDir, `.${path.basename(dstPath)}-`));
  return { stagingDir, tmpPath: path.join(stagingDir, path.basename(dstPath)) };
}

export async function convertJob(job, { dir, dryRun, runBasisuCommand = runBasisu }) {
  const { srcPath, dstPath } = skyKtx2Paths(job, dir);
  if (!fs.existsSync(srcPath)) {
    return { job, status: 'failed', reason: `missing source ${job.source}`, before: 0, after: 0 };
  }
  const before = fs.statSync(srcPath).size;
  if (dryRun) return { job, status: 'would-convert', before, after: before };

  const { stagingDir, tmpPath } = makeTempOutputPath(dstPath);
  try {
    const { code, stdout, stderr } = await runBasisuCommand(
      buildBasisuHdrArgs({ srcPath, dstPath: tmpPath, resample: job.resample }),
    );
    if (code !== 0 || !fs.existsSync(tmpPath)) {
      const reason = basisuFailureReason(stdout, stderr, `encoder did not write ${job.target}`);
      return { job, status: 'failed', reason, before, after: before };
    }
    fs.renameSync(tmpPath, dstPath);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  return { job, status: 'converted', before, after: fs.statSync(dstPath).size };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dryRun) await checkBasisuTool();
  const unknown = opts.stems.filter((s) => !SKY_HDR_STEMS.includes(s));
  if (unknown.length) {
    throw new Error(
      `unknown sky stem(s): ${unknown.join(', ')}. Known: ${SKY_HDR_STEMS.join(', ')}`,
    );
  }
  const jobs = skyKtx2Jobs(opts.stems.length ? opts.stems : SKY_HDR_STEMS);

  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const r = await convertJob(job, opts);
        results.push(r);
        const delta = `${(r.before / 1024).toFixed(0)}K -> ${(r.after / 1024).toFixed(0)}K`;
        console.log(
          `${r.status.padEnd(14)} ${delta.padStart(16)}  ${r.job.target}${r.reason ? `  (${r.reason})` : ''}`,
        );
      } catch (err) {
        results.push({ job, status: 'failed', reason: String(err), before: 0, after: 0 });
        console.error(`failed         ${job.target}: ${err}`);
      }
    }
  }
  await Promise.all(Array.from({ length: opts.jobs }, worker));

  const by = (s) => results.filter((r) => r.status === s);
  const converted = by('converted');
  const beforeTotal = converted.reduce((s, r) => s + r.before, 0);
  const afterTotal = converted.reduce((s, r) => s + r.after, 0);
  console.log(
    `\n${converted.length} converted (${(beforeTotal / 1024).toFixed(0)} K -> ${(afterTotal / 1024).toFixed(0)} K on disk), ` +
      `${by('would-convert').length} pending (dry run), ${by('failed').length} failed`,
  );
  if (by('failed').length) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
