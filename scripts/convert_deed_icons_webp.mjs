// Ingest the maintainer's hand-reviewed Book of Deeds icon set to shipping WebP.
//
// The maintainer delivers one 512x512 transparent-background PNG per deed, named
// exactly `<deed_id>.png`. This tool downscales each to a 128px WebP under
// public/ui/deeds/<deed_id>.webp (the raw unhashed /ui path, like the class-ability
// icons) and regenerates src/ui/deed_image_ids.ts (the checked-in id list the icon
// system and the pure view core both import). WebP is the committed source of truth;
// the 512px PNGs are sources and are never committed (the skill-icon precedent in
// scripts/convert_skill_icons_webp.mjs).
//
// Usage:  node scripts/convert_deed_icons_webp.mjs <source-dir>
//   <source-dir> holds delivered <deed_id>.png files (it lives outside the repo;
//   the tool only reads it). Each run overlays that delivery onto the committed live
//   set, so later commissions do not need the earlier source PNGs. Files whose id is
//   not a live deed in DEED_ORDER are skipped with a log (the orphan guard: deferred
//   and cut ids ship no art). Live deeds with neither existing art nor a delivered PNG
//   are reported as missing and keep the procedural category crest via the fallback.
//
// The content module is loaded through esbuild exactly like scripts/wiki/build_content.mjs
// (never import raw .ts under node). Deterministic and idempotent: same sources in,
// byte-identical WebP and id list out, so re-running is a no-op diff. Gated by
// tests/deed_icons.test.ts (DEED_IMAGE_IDS is an exact bijection with the committed files).

import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import sharp from 'sharp';

const root = process.cwd();
const OUT_DIR = path.join(root, 'public/ui/deeds');
const MODULE_FILE = path.join(root, 'src/ui/deed_image_ids.ts');

const TARGET = 128; // downscale 512 -> 128 (crisp in the 40px card box at 3x)
// smartSubsample defeats the 4:2:0 colored-halo on saturated icon edges; alphaQuality 100
// keeps the transparent matte crisp. Identical to the skill-icon settings.
const WEBP_OPTIONS = { quality: 82, alphaQuality: 100, smartSubsample: true, effort: 6 };
const FALLBACK_QUALITY = 75; // a single over-cap file is re-encoded once at this quality
const SIZE_CAP = 15 * 1024; // per-file weight cap (bytes) before the q75 re-encode

const srcArg = process.argv[2];
if (!srcArg) {
  console.error('[assets:deeds] usage: node scripts/convert_deed_icons_webp.mjs <source-dir>');
  process.exit(1);
}
const srcDir = path.resolve(srcArg);
if (!existsSync(srcDir)) {
  console.error(`[assets:deeds] source dir not found: ${srcDir}`);
  process.exit(1);
}

// Load DEED_ORDER from the sim source of truth via an esbuild bundle (the
// build_content.mjs pattern: never import raw .ts under node).
const built = await esbuild.build({
  stdin: {
    contents: `export { DEED_ORDER } from './src/sim/content/deeds.ts';`,
    resolveDir: root,
    sourcefile: 'deeds-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const { DEED_ORDER } = await import(dataUrl);
const live = new Set(DEED_ORDER);

// Classify the delivered PNGs against the live catalog.
const sourcePngs = readdirSync(srcDir)
  .filter((f) => path.extname(f).toLowerCase() === '.png')
  .sort();
const toConvert = [];
const orphans = [];
for (const f of sourcePngs) {
  const id = path.basename(f, path.extname(f));
  if (live.has(id)) toConvert.push({ id, file: path.join(srcDir, f) });
  else orphans.push(id);
}
toConvert.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const convertedIds = toConvert.map((x) => x.id);
const existingIds = existsSync(OUT_DIR)
  ? readdirSync(OUT_DIR)
      .filter((f) => path.extname(f).toLowerCase() === '.webp')
      .map((f) => path.basename(f, '.webp'))
      .filter((id) => live.has(id))
  : [];
const finalIds = [...new Set([...existingIds, ...convertedIds])].sort();
const finalSet = new Set(finalIds);
// Live deeds with neither committed art nor a delivered PNG are expected, not an
// error. They keep the procedural category crest via the fallback.
const missing = DEED_ORDER.filter((id) => !finalSet.has(id));

// A source dir with zero matching deeds is a mistake (wrong path): refuse to touch
// the tree rather than nuke the committed set to empty.
if (convertedIds.length === 0) {
  console.error(`[assets:deeds] no delivered PNG matched a live deed id in ${srcDir}; aborting`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

async function encode(file, quality) {
  return sharp(file)
    .resize(TARGET, TARGET, { kernel: 'lanczos3' })
    .webp({ ...WEBP_OPTIONS, quality })
    .toBuffer();
}

let totalBytes = 0;
let heaviest = { id: '', bytes: 0 };
const requeued = [];
for (const { id, file } of toConvert) {
  let buf = await encode(file, WEBP_OPTIONS.quality);
  if (buf.length > SIZE_CAP) {
    const smaller = await encode(file, FALLBACK_QUALITY);
    if (smaller.length < buf.length) {
      buf = smaller;
      requeued.push(id);
    }
  }
  writeFileSync(path.join(OUT_DIR, `${id}.webp`), buf);
  totalBytes += buf.length;
  if (buf.length > heaviest.bytes) heaviest = { id, bytes: buf.length };
}

// Drop stale WebPs whose ids are no longer live deeds. Existing art for a live deed
// stays when a later delivery omits its source PNG.
const keep = new Set(finalIds.map((id) => `${id}.webp`));
const removed = [];
for (const f of readdirSync(OUT_DIR)) {
  if (path.extname(f).toLowerCase() === '.webp' && !keep.has(f)) {
    unlinkSync(path.join(OUT_DIR, f));
    removed.push(f);
  }
}

// Regenerate the checked-in id list. Emitted in the exact Biome shape (single quotes,
// 2-space, trailing comma) so the file is format-stable and re-runs are a no-op diff.
const idLines = finalIds.map((id) => `  '${id}',`).join('\n');
const moduleText = `// Deed ids with committed painted art under public/ui/deeds/<id>.webp (128px WebP,
// downscaled from the maintainer's 512px source set by scripts/convert_deed_icons_webp.mjs).
// GENERATED: do not hand-edit; re-run the script to regenerate. Imported by both the icon
// system (icons.ts deedImageUrl, the static image branch) and the pure view core
// (deeds_view.ts deedCrestId), so it stays a plain literal Set with no DOM or fs at runtime.
// tests/deed_icons.test.ts gates this list against the committed .webp files (exact set
// equality, both directions), so a dropped file or an unwired id reds the suite.

export const DEED_IMAGE_IDS: ReadonlySet<string> = new Set([
${idLines}
]);
`;
writeFileSync(MODULE_FILE, moduleText);

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
console.log(
  `[assets:deeds] converted ${convertedIds.length}, skipped ${orphans.length} orphan(s), ` +
    `missing art for ${missing.length} live deed(s)`,
);
if (orphans.length) console.log(`  orphans (no art shipped): ${orphans.sort().join(', ')}`);
if (missing.length) console.log(`  missing art (procedural crest fallback): ${missing.join(', ')}`);
if (removed.length) console.log(`  removed stale webp: ${removed.sort().join(', ')}`);
if (requeued.length)
  console.log(`  re-encoded at q${FALLBACK_QUALITY} (over cap): ${requeued.join(', ')}`);
console.log(
  `  converted weight ${kib(totalBytes)} across ${convertedIds.length} files; ` +
    `heaviest ${heaviest.id} at ${heaviest.bytes} B`,
);
