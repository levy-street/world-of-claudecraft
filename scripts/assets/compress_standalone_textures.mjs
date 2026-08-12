// Convert standalone images the runtime loads by URL (character skin/cosmetic
// atlas PNGs, plus the ambientCG terrain and structure detail JPGs) to
// KTX2/Basis so they stay GPU-compressed in memory instead of decoding to full
// RGBA bitmaps, the same win compress_glb_textures.mjs already banks for
// embedded GLB textures.
//
// loadTexture() (src/render/assets/loader.ts) has no compressed-texture path:
// every standalone image, including the ~34 1024x1024 player skin atlases
// under public/textures/skins/ and the 1024x1024 terrain splat + surface
// detail sets, decodes to a full RGBA bitmap. The skin sweep alone is well
// over 100 MB of RGBA (see the eagerSkinAtlases comment in
// src/render/characters/assets.ts). ETC1S/Basis-LZ and UASTC upload as-is at
// roughly an eighth (ETC1S) or a quarter (UASTC) of the RGBA size, on the CPU
// and GPU side, same as the GLB path.
//
// Usage: node scripts/assets/compress_standalone_textures.mjs [options] [files...]
//   --dir <path>   directory to scan for .png/.jpg files (default public/textures/skins)
//   --dry-run      report what would be converted, write nothing
//   --flip         bake a vertical flip into the encoded image (see below)
//   --jobs <n>     file-level parallelism (default 4)
// With explicit [files...] arguments only those images are processed; that is
// how the terrain/structure sets are converted, so the unused pack files
// sitting beside them in the same directories stay raw.
//
// `base.png` is skipped everywhere it is found: it is the raw thumbnail
// source skinThumbUrl() falls back to, never a URL SKINS/SKIN_EMISSIVE point
// at, so loadSkinTexInto never requests it and there is nothing to compress.
//
// `--flip` exists because a CompressedTexture cannot honor `flipY` at runtime,
// and the terrain/structure JPGs are consumed through TextureLoader with the
// default `flipY = true`: baking the flip at compress time keeps sampling
// pixel-identical to the raw path. Skin atlases are consumed at
// `flipY = false` (the glTF UV convention) and are converted WITHOUT it.
//
// Emits a `.ktx2` SIBLING next to each source image. The source is never
// deleted or replaced: tests/visual_manifest.test.ts pins the raw
// fernando.png path, the voxel-terrain prototype still reads the raw terrain
// JPGs, and the runtime consumers (loadSkinTexInto, terrain.ts, worn_stone.ts,
// detail_normals.ts) are what switch to requesting the sibling.
//
// Requires the `ktx` tool from KhronosGroup/KTX-Software 4.3+ on PATH (see
// scripts/assets/compress_glb_textures.mjs for install notes).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  blockAlignmentError,
  buildKtxCreateArgs,
  classifyStandaloneTexture,
  flippedSourcePath,
  isConvertibleStandaloneImage,
  ktx2SiblingPath,
  parseArgs as parseArgsCore,
} from './lib/standalone_texture_compression_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DIR = path.join(ROOT, 'public', 'textures', 'skins');

export function parseArgs(argv) {
  const opts = parseArgsCore(argv, DEFAULT_DIR);
  opts.dir = path.resolve(opts.dir);
  opts.files = opts.files.map((f) => path.resolve(f));
  return opts;
}

function* walkImages(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkImages(p);
    else if (e.isFile() && isConvertibleStandaloneImage(e.name)) yield p;
  }
}

function runKtx(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ktx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
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

async function convertFile(file, { dryRun, flip }) {
  const dst = ktx2SiblingPath(file);
  const before = fs.statSync(file).size;
  if (dryRun) return { file, dst, status: 'would-convert', before, after: before };

  const meta = await sharp(file).metadata();
  const misaligned = blockAlignmentError(meta.width, meta.height);
  if (misaligned) {
    return { file, dst, status: 'failed', reason: misaligned, before, after: before };
  }

  const cls = classifyStandaloneTexture(path.basename(file));
  // The flipped copy is a lossless PNG so the flip itself costs no quality;
  // only the ktx encode is lossy, exactly as on the unflipped path. It stages
  // in a PRIVATE per-run mkdtemp directory (mode 0700), never bare os.tmpdir():
  // a deterministic path in a shared temp is pre-creatable and race-swappable
  // by any local process, symlink overwrite included (review round 2).
  const stagingDir = flip
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'woc-flip-'), { mode: 0o700 })
    : null;
  const flipped = stagingDir ? flippedSourcePath(file, stagingDir) : null;
  if (flipped) await sharp(file).flip().png().toFile(flipped);
  try {
    const args = buildKtxCreateArgs({
      hasAlpha: !!meta.hasAlpha,
      srcPath: flipped ?? file,
      dstPath: dst,
      encoding: cls.encoding,
      transferFunction: cls.transferFunction,
    });
    const { code, stderr } = await runKtx(args);
    if (code !== 0) {
      return { file, dst, status: 'failed', reason: stderr.trim(), before, after: before };
    }
  } finally {
    if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  const after = fs.statSync(dst).size;
  return { file, dst, status: 'converted', before, after };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dryRun) await checkKtxTool();
  const files = opts.files.length ? opts.files : [...walkImages(opts.dir)];

  const results = [];
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      try {
        const r = await convertFile(file, opts);
        results.push(r);
        const rel = path.relative(ROOT, r.file);
        const delta = `${(r.before / 1024).toFixed(0)}K -> ${(r.after / 1024).toFixed(0)}K`;
        console.log(
          `${r.status.padEnd(14)} ${delta.padStart(16)}  ${rel}${r.reason ? `  (${r.reason})` : ''}`,
        );
      } catch (err) {
        results.push({ file, status: 'failed', reason: String(err), before: 0, after: 0 });
        console.error(`failed         ${path.relative(ROOT, file)}: ${err}`);
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
