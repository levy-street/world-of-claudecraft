// Normalize the built-in terrain PBR texture library to 512x512 WebP.
//
// The ambientCG/Yoge sets under public/textures/terrain/ ship as 1024^2 JPEGs
// (Color / NormalGL / Roughness / AmbientOcclusion per set). At the gameplay
// camera distance these tile far too finely to justify 1K: dropping to 512
// quarters both the decoded VRAM footprint (~5MB -> ~1.3MB each) and the decode
// cost, which is the actual runtime win, while WebP shrinks the shipped/on-disk
// bytes on top. Run:  npm run assets:terrain
//
// Each non-webp image is downscaled to TARGET_SIZE, encoded to a sibling
// <name>.webp, and the ORIGINAL is deleted, so the committed tree is WebP only
// (mirrors scripts/convert_item_icons_webp.mjs). WebP is the source of truth:
// no lossless original is kept, and nothing converts at build time. Re-running
// with everything already WebP is a no-op, so a later 1K JPEG import is
// normalized by dropping it in and re-running.
//
// Map-type-aware encoding: NormalGL maps carry direction vectors in RGB (X->R,
// Y->G, Z->B), so lossy WebP's YUV 4:2:0 chroma step is what wrecks them - it
// halves the resolution of exactly the R/G channels that hold surface tilt,
// flattening the relief and making the tile pattern show through on every
// surface. There is no true 4:4:4 lossy WebP in libwebp, so the fix is
// smartSubsample:true (analyses + minimises the chroma damage) at a HIGH quality
// (q95): that recovers almost all the relief a 768 downscale can hold, while
// staying ~0.4MB (pure lossless would preserve a hair more but costs ~1.1MB
// each). NOTE: smartSubsample:false is the WORST option - it does NOT disable
// subsampling, it just uses the crude non-smart 4:2:0. Color / Roughness /
// AmbientOcclusion tolerate lossy fine (verified pixel-identical means). No
// .toColorspace() call: the data maps keep their raw 8-bit values, and the
// source JPEGs are already plain sRGB.
//
// Flags:
//   --quality <n>         base quality for Color/Roughness/AO (default 82)
//   --normal-quality <n>  quality for NormalGL maps (default 92)
//   --size <n>            output square edge (default 512)

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const terrainDir = path.join(root, 'public/textures/terrain');

const SOURCE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.avif']);

function intFlag(name, dflt, lo, hi) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v < lo || v > hi) {
    console.error(`[assets:terrain] ${name} must be a number ${lo}..${hi}`);
    process.exit(1);
  }
  return v;
}

const quality = intFlag('--quality', 82, 1, 100);
const normalQuality = intFlag('--normal-quality', 95, 1, 100);
const size = intFlag('--size', 512, 16, 4096);

const rel = (p) => path.relative(terrainDir, p).split(path.sep).join('/');

// NormalGL maps: high quality, no chroma subsampling (preserve X/Z vectors).
// Everything else: standard quality, smartSubsample cleans up albedo edges.
function webpOptionsFor(name) {
  if (/_NormalGL\./i.test(name)) {
    // smartSubsample:true is REQUIRED here - it minimises the chroma-subsample
    // damage to the R/G (X/Y tilt) channels that keeps the surface relief.
    return { quality: normalQuality, smartSubsample: true, effort: 6 };
  }
  return { quality, smartSubsample: true, effort: 6 };
}

async function main() {
  if (!existsSync(terrainDir)) {
    console.error(`[assets:terrain] no terrain dir at ${path.relative(root, terrainDir)}`);
    process.exit(1);
  }

  const sources = readdirSync(terrainDir, { withFileTypes: true })
    .filter((ent) => ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name).toLowerCase()))
    .map((ent) => path.join(terrainDir, ent.name))
    .sort();

  if (sources.length === 0) {
    console.log('[assets:terrain] no non-webp images found; tree is already webp-only (no-op)');
    return;
  }

  // Refuse the whole batch on a destination collision before touching disk: two
  // foreign sources sharing a basename (foo.jpg + foo.png) both map to foo.webp,
  // so the second encode would clobber the first and both originals would be
  // unlinked (silent data loss). Hard-fail with the conflicting pair instead.
  const byDst = new Map();
  for (const src of sources) {
    const dst = `${src.slice(0, -path.extname(src).length)}.webp`;
    const list = byDst.get(dst) ?? [];
    list.push(src);
    byDst.set(dst, list);
  }
  const collisions = [...byDst.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length > 0) {
    console.error('[assets:terrain] refusing to convert: multiple sources map to the same .webp');
    for (const [dst, list] of collisions) {
      console.error(`  ${rel(dst)} <- ${list.map(rel).join(', ')}`);
    }
    process.exit(1);
  }

  let converted = 0;
  let srcBytes = 0;
  let webpBytes = 0;
  for (const src of sources) {
    const dst = `${src.slice(0, -path.extname(src).length)}.webp`;
    const before = statSync(src).size;
    // Encode FIRST, then delete the original only after a successful write, so a
    // failed encode never loses the source. fit:'inside' + withoutEnlargement is
    // a downscale-only resize (already-small art and re-runs are never upsampled).
    await sharp(src)
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp(webpOptionsFor(src))
      .toFile(dst);
    unlinkSync(src);
    const after = statSync(dst).size;
    srcBytes += before;
    webpBytes += after;
    converted++;
  }

  const mib = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
  const pct = srcBytes ? Math.round((webpBytes / srcBytes) * 100) : 0;
  console.log(
    `[assets:terrain] converted ${converted} image(s) to ${size}px webp ` +
      `(q${quality} maps / q${normalQuality} normals) and deleted the originals; ` +
      `${mib(srcBytes)} -> ${mib(webpBytes)} (${pct}% of source)`,
  );
  console.log('[assets:terrain] regenerate the media manifest before a prod build:');
  console.log('[assets:terrain]   node scripts/build_media_manifest.mjs generate');
}

main().catch((err) => {
  console.error('[assets:terrain] failed:', err);
  process.exit(1);
});
