// Convert standalone character skin/cosmetic atlas PNGs to KTX2/Basis so they
// stay GPU-compressed in memory instead of decoding to full RGBA bitmaps, the
// same win compress_glb_textures.mjs already banks for embedded GLB textures.
//
// loadTexture() (src/render/assets/loader.ts) has no compressed-texture path:
// every standalone image, including the ~34 1024x1024 player skin atlases
// under public/textures/skins/, decodes to a full RGBA bitmap. That boot-time
// sweep alone is well over 100 MB of RGBA (see the eagerSkinAtlases comment in
// src/render/characters/assets.ts). ETC1S/Basis-LZ uploads as-is at roughly an
// eighth of the RGBA size, on the CPU and GPU side, same as the GLB path.
//
// Usage: node scripts/assets/compress_standalone_textures.mjs [options] [files...]
//   --dir <path>   directory to scan for .png files (default public/textures/skins)
//   --dry-run      report what would be converted, write nothing
//   --jobs <n>     file-level parallelism (default 4)
// With explicit [files...] arguments only those PNGs are processed.
//
// `base.png` is skipped everywhere it is found: it is the raw thumbnail
// source skinThumbUrl() falls back to, never a URL SKINS/SKIN_EMISSIVE point
// at, so loadSkinTexInto never requests it and there is nothing to compress.
//
// Emits a `.ktx2` SIBLING next to each source PNG. The PNG is never deleted
// or replaced: tests/visual_manifest.test.ts pins the raw fernando.png path,
// and loadSkinTexInto (src/render/characters/assets.ts) is what switches to
// requesting the sibling instead, only for atlases under textures/skins/.
//
// Requires the `ktx` tool from KhronosGroup/KTX-Software 4.3+ on PATH (see
// scripts/assets/compress_glb_textures.mjs for install notes).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  buildKtxCreateArgs,
  isConvertibleSkinPng,
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

function* walkPngs(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkPngs(p);
    else if (e.isFile() && isConvertibleSkinPng(e.name)) yield p;
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

async function convertFile(file, { dryRun }) {
  const dst = ktx2SiblingPath(file);
  const before = fs.statSync(file).size;
  if (dryRun) return { file, dst, status: 'would-convert', before, after: before };

  const meta = await sharp(file).metadata();
  const args = buildKtxCreateArgs({ hasAlpha: !!meta.hasAlpha, srcPath: file, dstPath: dst });
  const { code, stderr } = await runKtx(args);
  if (code !== 0) {
    return { file, dst, status: 'failed', reason: stderr.trim(), before, after: before };
  }
  const after = fs.statSync(dst).size;
  return { file, dst, status: 'converted', before, after };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dryRun) await checkKtxTool();
  const files = opts.files.length ? opts.files : [...walkPngs(opts.dir)];

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
