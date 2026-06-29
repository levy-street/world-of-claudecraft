// Normalize hand-authored class ability icons to WebP.
//
// Drop a new icon into public/ui/skills/<class>/ in ANY common raster format
// (.png/.jpg/.jpeg/.gif/.bmp/.tif/.tiff/.avif), then run:  npm run assets:skills
// Each non-webp image is encoded to a sibling <name>.webp with the tuned options below
// and the ORIGINAL is deleted, so the committed tree is always WebP only (a fraction of
// PNG/JPG size, decoding on every supported browser and native WebView). WebP is the
// source of truth: no lossless original is kept, and nothing converts at build time (this
// is a pre-commit tool, NOT wired into `npm run build`, so CI never re-encodes). The guard
// in tests/skill_icons.test.ts fails if a non-webp image is ever committed. Re-running with
// everything already WebP is a no-op.
//
// Flag: --quality <n> overrides the default 82 (e.g. --quality 90 for finer art).

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const skillsDir = path.join(root, 'public/ui/skills');

// Foreign (non-webp) raster inputs we know how to convert. mapping.json and any .webp
// are left alone. Multi-frame inputs (animated .gif, multi-page .tif/.tiff) convert
// first-frame-only; the ability icon set is static, so that is the intended behavior.
const SOURCE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

const qFlag = process.argv.indexOf('--quality');
const quality = qFlag !== -1 ? Number(process.argv[qFlag + 1]) : 82;
if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
  console.error('[assets:skills] --quality must be a number 1..100');
  process.exit(1);
}

// smartSubsample defeats the 4:2:0 colored-halo artifact on the saturated edges of these
// icons (they are upscaled on 3x mobile, so subsampling shows). alphaQuality 100 keeps the
// transparent matte crisp. Metadata is stripped by default (sharp does not copy it),
// shrinking the file further.
const webpOptions = { quality, alphaQuality: 100, smartSubsample: true, effort: 6 };

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(skillsDir, p).split(path.sep).join('/');

async function main() {
  if (!existsSync(skillsDir)) {
    console.error(`[assets:skills] no skills dir at ${path.relative(root, skillsDir)}`);
    process.exit(1);
  }

  const sources = walk(skillsDir)
    .filter((p) => SOURCE_EXTS.has(path.extname(p).toLowerCase()))
    .sort();

  if (sources.length === 0) {
    console.log('[assets:skills] no non-webp images found; tree is already webp-only (no-op)');
    return;
  }

  // Refuse the whole batch on a destination collision before touching disk: two foreign
  // sources sharing a basename in one dir (foo.png + foo.jpg) both map to foo.webp, so the
  // second encode would overwrite the first and both originals would be unlinked (silent data
  // loss). Hard-fail with the conflicting pair instead.
  const byDst = new Map();
  for (const src of sources) {
    const dst = `${src.slice(0, -path.extname(src).length)}.webp`;
    const list = byDst.get(dst) ?? [];
    list.push(src);
    byDst.set(dst, list);
  }
  const collisions = [...byDst.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length > 0) {
    console.error('[assets:skills] refusing to convert: multiple sources map to the same .webp');
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
    // Encode FIRST, then delete the original only after a successful write, so a failed
    // encode never loses the source. .rotate() auto-orients from EXIF. .toColorspace('srgb')
    // flattens the working buffer to 8-bit sRGB; note it is NOT an ICC-managed conversion and
    // the source profile is stripped, so a profiled wide-gamut (Display-P3) input would be
    // reinterpreted, not color-converted. Inputs are expected to already be sRGB (the icon
    // packs are).
    await sharp(src).rotate().toColorspace('srgb').webp(webpOptions).toFile(dst);
    unlinkSync(src);
    const after = statSync(dst).size;
    srcBytes += before;
    webpBytes += after;
    converted++;
    console.log(
      `  ${rel(src)} -> ${rel(dst)}  (${before} -> ${after} B, ${Math.round((after / before) * 100)}%)`,
    );
  }

  const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
  const pct = srcBytes ? Math.round((webpBytes / srcBytes) * 100) : 0;
  console.log(
    `[assets:skills] converted ${converted} image(s) to webp at q${quality} and deleted the ` +
      `originals; ${kib(srcBytes)} -> ${kib(webpBytes)} (${pct}% of source)`,
  );
}

main().catch((err) => {
  console.error('[assets:skills] failed:', err);
  process.exit(1);
});
