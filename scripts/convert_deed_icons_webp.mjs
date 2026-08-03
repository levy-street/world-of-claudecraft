// Ingest the project's hand-reviewed Book of Deeds icon set to shipping WebP.
//
// The art delivery contains one 512x512 transparent-background PNG per deed, named
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

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
const SOURCE_SIZE = 512;
const SOURCE_ALPHA_THRESHOLD = 8;
const SOURCE_MIN_PADDING = 28;
const SOURCE_CENTER = (SOURCE_SIZE - 1) / 2;
const SOURCE_CENTER_TOLERANCE = 8;
const SOURCE_MIN_COVERAGE = 0.34;
const SOURCE_MAX_COVERAGE = 0.61;
const ENCODED_ALPHA_THRESHOLD = 8;
const ENCODED_MIN_PADDING = 7;
const ENCODED_CENTER = (TARGET - 1) / 2;
const ENCODED_CENTER_TOLERANCE = 2;
const ENCODED_MIN_COVERAGE = 0.35;
const ENCODED_MAX_COVERAGE = 0.6;

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
const duplicateDeliveredIds = [
  ...new Set(convertedIds.filter((id, index) => convertedIds.indexOf(id) !== index)),
];
if (duplicateDeliveredIds.length > 0) {
  console.error(
    `[assets:deeds] multiple delivered PNGs map to the same deed id: ${duplicateDeliveredIds.join(', ')}`,
  );
  process.exit(1);
}
const outputEntries = existsSync(OUT_DIR) ? readdirSync(OUT_DIR, { withFileTypes: true }) : [];
const moduleDir = path.dirname(MODULE_FILE);
const transactionResidues = [
  ...outputEntries
    .filter((entry) => entry.name.includes('.woc-txn-'))
    .map((entry) => path.join(OUT_DIR, entry.name)),
  ...(existsSync(moduleDir)
    ? readdirSync(moduleDir, { withFileTypes: true })
        .filter((entry) => entry.name.includes('.woc-txn-'))
        .map((entry) => path.join(moduleDir, entry.name))
    : []),
];
if (transactionResidues.length > 0) {
  console.error(
    `[assets:deeds] stranded transaction files require manual recovery: ${transactionResidues
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
      .sort()
      .join(', ')}`,
  );
  process.exit(1);
}
const malformedWebpEntries = outputEntries.filter(
  (entry) => path.extname(entry.name).toLowerCase() === '.webp' && !entry.isFile(),
);
if (malformedWebpEntries.length > 0) {
  console.error(
    `[assets:deeds] expected regular webp files, found: ${malformedWebpEntries
      .map((entry) => entry.name)
      .sort()
      .join(', ')}`,
  );
  process.exit(1);
}
const existingIds = outputEntries
  .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.webp')
  .map((entry) => path.basename(entry.name, '.webp'))
  .filter((id) => live.has(id));
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

const sourceName = (file) => path.basename(file);

async function validateSource(file) {
  let metadata;
  try {
    metadata = await sharp(file).metadata();
  } catch {
    throw new Error(`${sourceName(file)}: expected an actual PNG payload`);
  }
  if (metadata.format !== 'png') {
    throw new Error(
      `${sourceName(file)}: expected an actual PNG payload, decoded ${metadata.format ?? 'unknown'}`,
    );
  }
  if (metadata.width !== SOURCE_SIZE || metadata.height !== SOURCE_SIZE) {
    throw new Error(
      `${sourceName(file)}: expected exact ${SOURCE_SIZE}x${SOURCE_SIZE} dimensions, decoded ` +
        `${metadata.width ?? 'unknown'}x${metadata.height ?? 'unknown'}`,
    );
  }
  if (metadata.channels !== 4 || !metadata.hasAlpha) {
    throw new Error(
      `${sourceName(file)}: expected RGBA PNG with four channels and an alpha channel`,
    );
  }

  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SOURCE_SIZE || info.height !== SOURCE_SIZE || info.channels !== 4) {
    throw new Error(`${sourceName(file)}: decoded pixels do not match exact 512x512 RGBA`);
  }

  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  const corners = [
    ['top-left', 0, 0],
    ['top-right', info.width - 1, 0],
    ['bottom-left', 0, info.height - 1],
    ['bottom-right', info.width - 1, info.height - 1],
  ];
  const opaqueCorners = corners.filter(([, x, y]) => alphaAt(x, y) !== 0).map(([name]) => name);
  if (opaqueCorners.length > 0) {
    throw new Error(
      `${sourceName(file)}: all four corner pixels must be transparent (alpha 0); ` +
        `failed ${opaqueCorners.join(', ')}`,
    );
  }

  let hasOpaque = false;
  let visible = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = alphaAt(x, y);
      if (alpha === 255) hasOpaque = true;
      if (alpha < SOURCE_ALPHA_THRESHOLD) continue;
      visible++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!hasOpaque) {
    throw new Error(`${sourceName(file)}: expected at least one fully opaque pixel`);
  }
  if (visible === 0) {
    throw new Error(
      `${sourceName(file)}: alpha>=${SOURCE_ALPHA_THRESHOLD} geometry has no visible pixels`,
    );
  }

  const padding = {
    left: minX,
    top: minY,
    right: info.width - 1 - maxX,
    bottom: info.height - 1 - maxY,
  };
  const narrowSides = Object.entries(padding).filter(([, pixels]) => pixels < SOURCE_MIN_PADDING);
  if (narrowSides.length > 0) {
    throw new Error(
      `${sourceName(file)}: source padding must be at least ${SOURCE_MIN_PADDING}px on every side; ` +
        narrowSides.map(([side, pixels]) => `${side}=${pixels}px`).join(', '),
    );
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  if (
    Math.abs(centerX - SOURCE_CENTER) > SOURCE_CENTER_TOLERANCE ||
    Math.abs(centerY - SOURCE_CENTER) > SOURCE_CENTER_TOLERANCE
  ) {
    throw new Error(
      `${sourceName(file)}: alpha>=${SOURCE_ALPHA_THRESHOLD} bounds center must be within ` +
        `${SOURCE_CENTER_TOLERANCE}px of ${SOURCE_CENTER}; decoded (${centerX}, ${centerY})`,
    );
  }

  const coverage = visible / (info.width * info.height);
  if (coverage < SOURCE_MIN_COVERAGE || coverage > SOURCE_MAX_COVERAGE) {
    throw new Error(
      `${sourceName(file)}: alpha>=${SOURCE_ALPHA_THRESHOLD} coverage must be ` +
        `${SOURCE_MIN_COVERAGE}..${SOURCE_MAX_COVERAGE}; decoded ${coverage.toFixed(4)}`,
    );
  }
}

async function encode(file, quality) {
  // Delivery is already keyed and framed. Downscale the complete canvas directly:
  // no chroma key, trim, extraction, or optical re-centering belongs in this ingest.
  return sharp(file)
    .resize(TARGET, TARGET, { kernel: 'lanczos3' })
    .webp({ ...WEBP_OPTIONS, quality })
    .toBuffer();
}

async function validateEncodedWebp(id, buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new Error(`${id}: encoded payload is not a decodable webp`);
  }
  if (metadata.format !== 'webp') {
    throw new Error(
      `${id}: encoded payload format is ${metadata.format ?? 'unknown'}, expected webp`,
    );
  }
  if (metadata.width !== TARGET || metadata.height !== TARGET) {
    throw new Error(
      `${id}: encoded webp must be ${TARGET}x${TARGET}, decoded ` +
        `${metadata.width ?? 'unknown'}x${metadata.height ?? 'unknown'}`,
    );
  }
  if (!metadata.hasAlpha) {
    throw new Error(`${id}: encoded webp must retain an alpha channel`);
  }

  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  const corners = [
    ['top-left', 0, 0],
    ['top-right', info.width - 1, 0],
    ['bottom-left', 0, info.height - 1],
    ['bottom-right', info.width - 1, info.height - 1],
  ];
  const nonTransparentCorners = corners
    .filter(([, x, y]) => alphaAt(x, y) !== 0)
    .map(([name]) => name);
  if (nonTransparentCorners.length > 0) {
    throw new Error(
      `${id}: encoded webp corners must remain transparent; failed ` +
        nonTransparentCorners.join(', '),
    );
  }

  let transparent = false;
  let opaque = false;
  let visible = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = alphaAt(x, y);
      if (alpha === 0) transparent = true;
      if (alpha === 255) opaque = true;
      if (alpha < ENCODED_ALPHA_THRESHOLD) continue;
      visible++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!transparent || !opaque) {
    throw new Error(`${id}: encoded webp must contain both transparent and fully opaque pixels`);
  }
  if (visible === 0) {
    throw new Error(
      `${id}: encoded webp alpha>=${ENCODED_ALPHA_THRESHOLD} geometry has no visible pixels`,
    );
  }

  const padding = {
    left: minX,
    top: minY,
    right: info.width - 1 - maxX,
    bottom: info.height - 1 - maxY,
  };
  const narrowSides = Object.entries(padding).filter(([, pixels]) => pixels < ENCODED_MIN_PADDING);
  if (narrowSides.length > 0) {
    throw new Error(
      `${id}: encoded webp padding must be at least ${ENCODED_MIN_PADDING}px on every side; ` +
        narrowSides.map(([side, pixels]) => `${side}=${pixels}px`).join(', '),
    );
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  if (
    Math.abs(centerX - ENCODED_CENTER) > ENCODED_CENTER_TOLERANCE ||
    Math.abs(centerY - ENCODED_CENTER) > ENCODED_CENTER_TOLERANCE
  ) {
    throw new Error(
      `${id}: encoded webp center must be within ${ENCODED_CENTER_TOLERANCE}px of ` +
        `${ENCODED_CENTER}; decoded (${centerX}, ${centerY})`,
    );
  }

  const coverage = visible / (info.width * info.height);
  if (coverage < ENCODED_MIN_COVERAGE || coverage > ENCODED_MAX_COVERAGE) {
    throw new Error(
      `${id}: encoded webp coverage at alpha>=${ENCODED_ALPHA_THRESHOLD} must be ` +
        `${ENCODED_MIN_COVERAGE}..${ENCODED_MAX_COVERAGE}; decoded ${coverage.toFixed(4)}`,
    );
  }
}

// Validate and encode the entire delivery before mkdir, writes, stale cleanup, or registry
// regeneration. Any invalid source or over-cap q75 retry therefore leaves repository state
// untouched, while the external source PNGs remain read-only on every path.
let prepared;
try {
  for (const { file } of toConvert) await validateSource(file);
  prepared = [];
  for (const item of toConvert) {
    let buf = await encode(item.file, WEBP_OPTIONS.quality);
    let reencoded = false;
    if (buf.length > SIZE_CAP) {
      buf = await encode(item.file, FALLBACK_QUALITY);
      reencoded = true;
      if (buf.length > SIZE_CAP) {
        throw new Error(
          `${sourceName(item.file)}: q${FALLBACK_QUALITY} encode is ${buf.length} bytes and ` +
            `exceeds the 15 KiB cap`,
        );
      }
    }
    await validateEncodedWebp(item.id, buf);
    prepared.push({ ...item, buf, reencoded });
  }
} catch (err) {
  console.error(`[assets:deeds] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const injectedFailures = new Set(
  (process.env.WOC_TEST_CONVERTER_FAIL_AT ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const phaseCounts = new Map();

function runFsPhase(phase, operation) {
  const count = (phaseCounts.get(phase) ?? 0) + 1;
  phaseCounts.set(phase, count);
  if (injectedFailures.has(`${phase}:${count}`) || injectedFailures.has(`${phase}:*`)) {
    throw new Error(`injected ${phase} failure at operation ${count}`);
  }
  return operation();
}

const messageOf = (error) => (error instanceof Error ? error.message : String(error));
const relRepo = (file) => path.relative(root, file).split(path.sep).join('/');

function transactionSibling(file, transactionId, index, role) {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.woc-txn-${transactionId}-${index}-${role}`,
  );
}

function rollbackRepositoryChanges(writes, removals) {
  const errors = [];

  for (const write of [...writes].reverse()) {
    if (!write.installed || !existsSync(write.dst)) continue;
    try {
      runFsPhase('rollback-install', () => renameSync(write.dst, write.stage));
      write.installed = false;
      write.staged = true;
    } catch (error) {
      errors.push(`remove new destination ${relRepo(write.dst)}: ${messageOf(error)}`);
    }
  }

  for (const write of [...writes].reverse()) {
    if (!write.backedUp || !existsSync(write.backup)) continue;
    if (existsSync(write.dst)) {
      errors.push(`restore destination ${relRepo(write.dst)}: destination is still occupied`);
      continue;
    }
    try {
      runFsPhase('rollback-backup', () => renameSync(write.backup, write.dst));
      write.backedUp = false;
    } catch (error) {
      errors.push(`restore destination ${relRepo(write.dst)}: ${messageOf(error)}`);
    }
  }

  for (const removal of [...removals].reverse()) {
    if (!removal.moved || !existsSync(removal.quarantine)) continue;
    try {
      runFsPhase('rollback-remove', () => renameSync(removal.quarantine, removal.file));
      removal.moved = false;
    } catch (error) {
      errors.push(`restore stale ${relRepo(removal.file)}: ${messageOf(error)}`);
    }
  }

  for (const write of writes) {
    if (!existsSync(write.stage)) continue;
    try {
      runFsPhase('rollback-stage', () => unlinkSync(write.stage));
      write.staged = false;
    } catch (error) {
      errors.push(`clean staged ${relRepo(write.stage)}: ${messageOf(error)}`);
    }
  }

  return errors;
}

function removeCommittedTemp(file, recoveryDir) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!existsSync(file)) return null;
    try {
      runFsPhase('cleanup', () => unlinkSync(file));
      return null;
    } catch (error) {
      lastError = error;
    }
  }
  try {
    runFsPhase('recovery-mkdir', () => mkdirSync(recoveryDir, { recursive: true }));
    const recoveryFile = path.join(recoveryDir, path.basename(file));
    runFsPhase('recovery-move', () => renameSync(file, recoveryFile));
    return `${messageOf(lastError)}; preserved at ${relRepo(recoveryFile)}`;
  } catch (error) {
    return `${messageOf(lastError)}; recovery move failed: ${messageOf(error)}`;
  }
}

function commitRepositoryChanges(entries, staleFiles) {
  const transactionId = `${process.pid}-${randomUUID()}`;
  const recoveryDir = path.join(root, '.woc-converter-recovery', `assets-deeds-${transactionId}`);
  const writes = entries.map((entry, index) => ({
    ...entry,
    stage: transactionSibling(entry.dst, transactionId, index, 'new'),
    backup: transactionSibling(entry.dst, transactionId, index, 'old'),
    staged: false,
    backedUp: false,
    installed: false,
  }));
  const removals = staleFiles.map((file, index) => ({
    file,
    quarantine: transactionSibling(file, transactionId, index, 'stale'),
    moved: false,
  }));

  for (const target of [...writes.map((write) => write.dst), ...staleFiles]) {
    if (existsSync(target) && !lstatSync(target).isFile()) {
      throw new Error(`${relRepo(target)} exists and is not a regular file`);
    }
  }

  try {
    for (const write of writes) {
      runFsPhase('stage', () => writeFileSync(write.stage, write.buffer, { flag: 'wx' }));
      write.staged = true;
    }
    for (const write of writes) {
      if (!existsSync(write.dst)) continue;
      runFsPhase('backup', () => renameSync(write.dst, write.backup));
      write.backedUp = true;
    }
    for (const removal of removals) {
      runFsPhase('remove', () => renameSync(removal.file, removal.quarantine));
      removal.moved = true;
    }
    for (const write of writes) {
      runFsPhase('install', () => renameSync(write.stage, write.dst));
      write.staged = false;
      write.installed = true;
    }
  } catch (error) {
    const rollbackErrors = rollbackRepositoryChanges(writes, removals);
    const detail = rollbackErrors.length
      ? `; rollback incomplete: ${rollbackErrors.join('; ')}`
      : '';
    throw new Error(`${messageOf(error)}${detail}`);
  }

  const cleanupFailures = [];
  for (const write of writes) {
    if (!write.backedUp) continue;
    const error = removeCommittedTemp(write.backup, recoveryDir);
    if (error) cleanupFailures.push(`${relRepo(write.backup)}: ${error}`);
  }
  for (const removal of removals) {
    const error = removeCommittedTemp(removal.quarantine, recoveryDir);
    if (error) cleanupFailures.push(`${relRepo(removal.quarantine)}: ${error}`);
  }
  if (cleanupFailures.length > 0) {
    throw new Error(
      `repository changes committed, but recovery temp cleanup failed: ${cleanupFailures.join('; ')}`,
    );
  }
}

// Regenerate the checked-in id list. Emitted in the exact Biome shape (single quotes,
// 2-space, trailing comma) so the file is format-stable and re-runs are a no-op diff.
const idLines = finalIds.map((id) => `  '${id}',`).join('\n');
const moduleText = `// Deed ids with committed painted art under public/ui/deeds/<id>.webp (128px WebP,
// downscaled from reviewed 512px project sources by scripts/convert_deed_icons_webp.mjs).
// GENERATED: do not hand-edit; re-run the script to regenerate. Imported by both the icon
// system (icons.ts deedImageUrl, the static image branch) and the pure view core
// (deeds_view.ts deedCrestId), so it stays a plain literal Set with no DOM or fs at runtime.
// tests/deed_icons.test.ts gates this list against the committed .webp files (exact set
// equality, both directions), so a dropped file or an unwired id reds the suite.

export const DEED_IMAGE_IDS: ReadonlySet<string> = new Set([
${idLines}
]);
`;

// The overlay, stale removals, and generated registry are one transaction. Every new byte is
// staged beside its final path, every pre-existing byte is moved to a sibling backup, and the
// registry installs last. A caught failure restores the previous visible tree in reverse order.
// This does not claim crash recovery or coordinate concurrent converter processes; stranded
// siblings are detected on the next run.
const keep = new Set(finalIds.map((id) => `${id}.webp`));
const staleFiles = existsSync(OUT_DIR)
  ? readdirSync(OUT_DIR)
      .filter((file) => path.extname(file).toLowerCase() === '.webp' && !keep.has(file))
      .sort()
      .map((file) => path.join(OUT_DIR, file))
  : [];
const removed = staleFiles.map((file) => path.basename(file));
const outDirExisted = existsSync(OUT_DIR);
mkdirSync(OUT_DIR, { recursive: true });
try {
  commitRepositoryChanges(
    [
      ...prepared.map(({ id, buf }) => ({
        dst: path.join(OUT_DIR, `${id}.webp`),
        buffer: buf,
      })),
      { dst: MODULE_FILE, buffer: Buffer.from(moduleText) },
    ],
    staleFiles,
  );
} catch (error) {
  if (!outDirExisted && existsSync(OUT_DIR) && readdirSync(OUT_DIR).length === 0) {
    try {
      rmdirSync(OUT_DIR);
    } catch {
      // The conversion error remains primary; a newly-created non-empty directory is recoverable.
    }
  }
  console.error(`[assets:deeds] failed: ${messageOf(error)}`);
  process.exit(1);
}

let totalBytes = 0;
let heaviest = { id: '', bytes: 0 };
const requeued = [];
for (const { id, buf, reencoded } of prepared) {
  if (reencoded) requeued.push(id);
  totalBytes += buf.length;
  if (buf.length > heaviest.bytes) heaviest = { id, bytes: buf.length };
}

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
