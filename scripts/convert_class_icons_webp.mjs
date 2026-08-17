// Normalize hand-authored class emblems to 256x256 WebP.
//
// Drop new art into public/ui/classes/ in ANY common raster format
// (.png/.jpg/.jpeg/.gif/.bmp/.tif/.tiff/.avif), named for the class id it belongs to
// (warrior.png, druid.png, ...), then run:  node scripts/convert_class_icons_webp.mjs
// Each non-webp image is downscaled to ICON_SIZE, encoded to a sibling <id>.webp with the
// tuned options below, and the ORIGINAL is deleted, so the committed tree is always WebP
// only (the guard in tests/class_icons.test.ts fails if a non-webp image is ever committed).
// WebP is the source of truth: no lossless original is kept, and nothing converts at build
// time (this is a pre-commit tool, NOT wired into `npm run build`, so CI never re-encodes).
// Re-running with everything already WebP is a byte-stable no-op.
//
// Sibling of scripts/convert_profession_icons_webp.mjs; behavior is identical except that
// the id set is CLOSED, there are exactly nine playable classes, so an unrecognized
// basename is a typo, not a new asset, and the batch is refused before touching disk.
//
// Flag: --quality <n> overrides the default 82 (e.g. --quality 90 for finer art).

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const classesDir = path.join(root, 'public/ui/classes');

// The served icon square. The class rail on the character screens draws these at 62 CSS px
// and the guide's class cards at 88, so 256 covers a 3x display with room for larger art
// surfaces later. Mirrors the size the source set ships at.
const ICON_SIZE = 256;

// The complete, closed id set: src/sim/types.ts ALL_CLASSES. tests/class_icons.test.ts
// re-derives it from the TypeScript source, so the two cannot drift silently.
const CLASS_IDS = new Set([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
]);

const SOURCE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

const qFlag = process.argv.indexOf('--quality');
const quality = qFlag !== -1 ? Number(process.argv[qFlag + 1]) : 82;
if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
  console.error('[assets:classes] --quality must be a number 1..100');
  process.exit(1);
}

// smartSubsample defeats the 4:2:0 colored-halo artifact on the saturated edges of these
// icons (they are all bright spell energy against a dark field, which is exactly where
// subsampling shows). alphaQuality 100 keeps any transparent matte crisp; the shipped set
// is opaque, and the rounded frame comes from CSS.
const webpOptions = { quality, alphaQuality: 100, smartSubsample: true, effort: 6 };

const rel = (p) => path.relative(classesDir, p).split(path.sep).join('/');

async function main() {
  if (!existsSync(classesDir)) {
    console.error(`[assets:classes] no classes dir at ${path.relative(root, classesDir)}`);
    process.exit(1);
  }

  const sources = readdirSync(classesDir, { withFileTypes: true })
    .filter((ent) => ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name).toLowerCase()))
    .map((ent) => path.join(classesDir, ent.name))
    .sort();

  if (sources.length === 0) {
    console.log('[assets:classes] no non-webp images found; tree is already webp-only');
    return;
  }

  // Refuse the whole batch before touching disk on either failure mode: a basename that is
  // not a class id (art that would never be reachable), or two foreign sources sharing one
  // basename (foo.png + foo.jpg both map to foo.webp, so the second encode overwrites the
  // first and both originals are unlinked, silent data loss).
  const unknown = sources.filter((src) => !CLASS_IDS.has(path.basename(src, path.extname(src))));
  if (unknown.length > 0) {
    console.error('[assets:classes] refusing to convert: basename is not a class id');
    for (const src of unknown) console.error(`  ${rel(src)}`);
    console.error(`  expected one of: ${[...CLASS_IDS].join(', ')}`);
    process.exit(1);
  }

  const byDst = new Map();
  for (const src of sources) {
    const dst = `${src.slice(0, -path.extname(src).length)}.webp`;
    const list = byDst.get(dst) ?? [];
    list.push(src);
    byDst.set(dst, list);
  }
  const collisions = [...byDst.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length > 0) {
    console.error('[assets:classes] refusing to convert: multiple sources map to the same .webp');
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
    // encode never loses the source. The resize is a downscale-only cover crop
    // (withoutEnlargement keeps already-small art untouched, so re-running never upsamples).
    await sharp(src)
      .rotate()
      .resize(ICON_SIZE, ICON_SIZE, { fit: 'cover', withoutEnlargement: true })
      .toColorspace('srgb')
      .webp(webpOptions)
      .toFile(dst);
    unlinkSync(src);
    const after = statSync(dst).size;
    srcBytes += before;
    webpBytes += after;
    converted++;
    console.log(`[assets:classes] ${rel(src)} -> ${rel(dst)}  ${before} -> ${after} bytes`);
  }

  console.log(
    `[assets:classes] converted ${converted} image(s) at q${quality}: ${srcBytes} -> ${webpBytes} bytes`,
  );
}

main().catch((err) => {
  console.error('[assets:classes]', err);
  process.exit(1);
});
