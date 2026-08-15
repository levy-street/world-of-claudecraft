// Convert embedded GLB textures to KTX2/Basis (KHR_texture_basisu) so they stay
// GPU-compressed in memory instead of decoding to full RGBA bitmaps. A ~2 KB
// flat-color webp atlas decodes to width*height*4 bytes plus mipmaps; across the
// full model set that decode amplification was the bulk of the WKWebView
// WebContent process footprint that got the native iOS client jetsam-killed at
// world entry (iPhone 17 Pro, killed at 1.54 GB resident). ETC1S/UASTC textures
// upload as-is at roughly an eighth of the RGBA size, on the CPU and GPU side.
//
// Usage: node scripts/assets/compress_glb_textures.mjs [options] [files...]
//   --dir <path>   directory to scan for .glb files (default public/models)
//   --dry-run      report what would be converted, write nothing
//   --jobs <n>     file-level parallelism (default 4)
// With explicit [files...] arguments only those GLBs are processed.
//
// Requires the `ktx` tool from KhronosGroup/KTX-Software 4.3+ on PATH (the
// gltf-transform toktx transform spawns it). No sudo needed: expand the release
// pkg with `pkgutil --expand-full` and add its bin/ to PATH.
//
// Per file: webp textures are first transcoded to png (toktx cannot read webp),
// then normal/occlusion slots go to UASTC (quality) and everything else to
// ETC1S (size), then meshopt is re-applied when the source file used
// EXT_meshopt_compression (reading decodes it; without re-encoding the file
// would grow). Files whose embedded textures are already all KTX2, and files
// with no embedded textures at all (e.g. the Eastbrook kit, which uses a shared
// external atlas and carries provenance extras), are skipped without a write.
// After transforming, the script asserts the structural invariants (skins,
// animations, meshes, nodes, extras-bearing nodes) match the source and aborts
// the file on any mismatch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mode, toktx } from '@gltf-transform/cli';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import {
  classifyGlb,
  glbJsonChunk,
  snapshotMismatch,
  structuralSnapshot,
  weaponVfxModelKeys,
} from './lib/glb_texture_compression_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DIR = path.join(ROOT, 'public', 'models');

// Slots that favor UASTC's higher quality over ETC1S's smaller size.
const UASTC_SLOTS = /^(normalTexture|occlusionTexture)$/;

function excludedGlbPaths() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'render', 'weapon_vfx.ts'), 'utf8');
  return new Set(
    weaponVfxModelKeys(source).map((k) =>
      path.join(ROOT, 'public', 'models', 'weapons', `${k}.glb`),
    ),
  );
}

export function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, dryRun: false, jobs: 4, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = path.resolve(argv[++i]);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]) || 4);
    else opts.files.push(path.resolve(a));
  }
  return opts;
}

function* walkGlbs(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkGlbs(p);
    else if (e.name.endsWith('.glb')) yield p;
  }
}

async function convertFile(io, file, { dryRun }) {
  const srcBuf = fs.readFileSync(file);
  const srcJson = glbJsonChunk(srcBuf);
  const cls = classifyGlb(srcJson);
  if (cls.skip) return { file, status: 'skipped', before: srcBuf.length, after: srcBuf.length };
  if (dryRun) return { file, status: 'would-convert', before: srcBuf.length, after: srcBuf.length };

  const doc = await io.readBinary(srcBuf);
  const transforms = [
    textureCompress({ encoder: sharp, targetFormat: 'png', formats: /^image\/webp$/ }),
    // encoder feeds the transform's own resize path: ktx requires dimensions
    // that are multiples of four, and NPOT sources get resized via sharp first.
    toktx({ mode: Mode.UASTC, slots: UASTC_SLOTS, jobs: 2, encoder: sharp }),
    toktx({ mode: Mode.ETC1S, jobs: 2, encoder: sharp }),
  ];
  if (cls.hadMeshopt) transforms.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...transforms);
  const outBuf = Buffer.from(await io.writeBinary(doc));

  const outJson = glbJsonChunk(outBuf);
  const bad = snapshotMismatch(structuralSnapshot(srcJson), structuralSnapshot(outJson));
  if (bad)
    return {
      file,
      status: 'aborted',
      reason: `structure changed: ${bad.join(', ')}`,
      before: srcBuf.length,
      after: srcBuf.length,
    };
  const leftover = (outJson.images ?? []).filter((i) => i.mimeType !== 'image/ktx2').length;
  if (leftover > 0)
    return {
      file,
      status: 'aborted',
      reason: `${leftover} textures not converted`,
      before: srcBuf.length,
      after: srcBuf.length,
    };

  fs.writeFileSync(file, outBuf);
  return { file, status: 'converted', before: srcBuf.length, after: outBuf.length };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const excluded = excludedGlbPaths();
  const files = (opts.files.length ? opts.files : [...walkGlbs(opts.dir)]).filter((f) => {
    if (!excluded.has(path.resolve(f))) return true;
    console.log(`excluded        ${path.relative(ROOT, f)} (WEAPON_VFX skin, stays webp)`);
    return false;
  });
  // The meshopt WASM instantiates lazily; gltf-transform does not await it, so
  // a decode reached before readiness dies with "reading 'exports'".
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });

  const results = [];
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      try {
        const r = await convertFile(io, file, opts);
        results.push(r);
        if (r.status === 'converted' || r.status === 'would-convert' || r.status === 'aborted') {
          const rel = path.relative(ROOT, r.file);
          const delta = `${(r.before / 1024).toFixed(0)}K -> ${(r.after / 1024).toFixed(0)}K`;
          console.log(
            `${r.status.padEnd(14)} ${delta.padStart(16)}  ${rel}${r.reason ? `  (${r.reason})` : ''}`,
          );
        }
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
    `\n${converted.length} converted (${(beforeTotal / 1048576).toFixed(1)} MB -> ${(afterTotal / 1048576).toFixed(1)} MB), ` +
      `${by('would-convert').length} pending (dry run), ${by('skipped').length} skipped, ` +
      `${by('aborted').length} aborted, ${by('failed').length} failed`,
  );
  if (by('aborted').length || by('failed').length) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
