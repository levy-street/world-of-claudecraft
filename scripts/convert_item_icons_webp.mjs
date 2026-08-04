// Normalize hand-authored item icons to 128x128 WebP.
//
// Drop new art into public/ui/items/ in ANY common raster format
// (.png/.jpg/.jpeg/.gif/.bmp/.tif/.tiff/.avif), then run:  npm run assets:items
// Each non-webp image is normalized to the ICON_SIZE square declared in
// public/ui/items/mapping.json, encoded to a sibling <name>.webp with the tuned options
// below, and the ORIGINAL is deleted only after every input has produced an in-budget buffer,
// so the committed tree is always WebP only (the guard in tests/item_icons.test.ts fails if a
// non-webp image is ever committed). WebP is the source of truth: no lossless original is
// kept, and nothing converts at build time (this is a pre-commit tool, NOT wired into
// `npm run build`, so CI never re-encodes). The file basename IS the item id. ITEM_IMAGE_IDS
// derives every real non-weapon item from ITEMS; tests/item_icons.test.ts verifies that each
// derived id has art and provenance. Re-running with everything already WebP is a no-op.
//
// Sibling of scripts/convert_skill_icons_webp.mjs; both paths normalize generated source art
// to the same 128px shipping square before encoding.
//
// Outputs above 15 KiB retry at q75 and hard-fail if still over budget.
// Flag: --quality <n> overrides the default 82 (e.g. --quality 90 for finer art); an
// over-budget custom-quality encode still retries at no higher than q75.

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const itemsDir = path.join(root, 'public/ui/items');

// The served icon square. Mirrors "iconSize" in public/ui/items/mapping.json and the
// existing committed art; the HUD upscales it in CSS for the larger slots.
const ICON_SIZE = 128;
const FALLBACK_QUALITY = 75;
const SIZE_CAP = 15 * 1024;

// Foreign (non-webp) raster inputs we know how to convert. mapping.json and any .webp
// are left alone. Multi-frame inputs (animated .gif, multi-page .tif/.tiff) convert
// first-frame-only; the item icon set is static, so that is the intended behavior.
const SOURCE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

const qFlag = process.argv.indexOf('--quality');
const quality = qFlag !== -1 ? Number(process.argv[qFlag + 1]) : 82;
if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
  console.error('[assets:items] --quality must be a number 1..100');
  process.exit(1);
}

// smartSubsample defeats the 4:2:0 colored-halo artifact on the saturated edges of these
// icons (they are upscaled on 3x mobile, so subsampling shows). alphaQuality 100 keeps the
// transparent matte crisp. Metadata is stripped by default (sharp does not copy it),
// shrinking the file further.
const webpOptions = { alphaQuality: 100, smartSubsample: true, effort: 6 };

const rel = (p) => path.relative(itemsDir, p).split(path.sep).join('/');

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

function transactionSibling(file, transactionId, index, role) {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.woc-txn-${transactionId}-${index}-${role}`,
  );
}

function rollbackBatch(destinations, sources) {
  const errors = [];

  for (const source of [...sources].reverse()) {
    if (!source.moved || !existsSync(source.quarantine)) continue;
    try {
      runFsPhase('rollback-source', () => renameSync(source.quarantine, source.src));
      source.moved = false;
    } catch (error) {
      errors.push(`restore source ${rel(source.src)}: ${messageOf(error)}`);
    }
  }

  for (const destination of [...destinations].reverse()) {
    if (!destination.installed || !existsSync(destination.dst)) continue;
    try {
      runFsPhase('rollback-install', () => renameSync(destination.dst, destination.stage));
      destination.installed = false;
      destination.staged = true;
    } catch (error) {
      errors.push(`remove new destination ${rel(destination.dst)}: ${messageOf(error)}`);
    }
  }

  for (const destination of [...destinations].reverse()) {
    if (!destination.backedUp || !existsSync(destination.backup)) continue;
    if (existsSync(destination.dst)) {
      errors.push(`restore destination ${rel(destination.dst)}: destination is still occupied`);
      continue;
    }
    try {
      runFsPhase('rollback-backup', () => renameSync(destination.backup, destination.dst));
      destination.backedUp = false;
    } catch (error) {
      errors.push(`restore destination ${rel(destination.dst)}: ${messageOf(error)}`);
    }
  }

  for (const destination of destinations) {
    if (!existsSync(destination.stage)) continue;
    try {
      runFsPhase('rollback-stage', () => unlinkSync(destination.stage));
      destination.staged = false;
    } catch (error) {
      errors.push(`clean staged ${rel(destination.stage)}: ${messageOf(error)}`);
    }
  }

  return errors;
}

function removeCommittedTemp(file, recoveryDir, restorePath) {
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
  const unlinkError = messageOf(lastError);
  if (restorePath && !existsSync(restorePath)) {
    try {
      runFsPhase('recovery-restore', () => renameSync(file, restorePath));
      return `${unlinkError}; restored source at ${rel(restorePath)}`;
    } catch (error) {
      lastError = new Error(`${unlinkError}; source restore failed: ${messageOf(error)}`);
    }
  }
  try {
    runFsPhase('recovery-mkdir', () => mkdirSync(recoveryDir, { recursive: true }));
    const recoveryFile = path.join(recoveryDir, path.basename(file));
    runFsPhase('recovery-move', () => renameSync(file, recoveryFile));
    return `${messageOf(lastError)}; preserved at ${path.relative(root, recoveryFile)}`;
  } catch (error) {
    return `${messageOf(lastError)}; recovery move failed: ${messageOf(error)}`;
  }
}

// This transaction handles caught filesystem exceptions. It does not claim crash recovery or
// coordinate concurrent converter processes; stranded siblings are detected on the next run.
function commitBatch(prepared) {
  const transactionId = `${process.pid}-${randomUUID()}`;
  const recoveryDir = path.join(root, '.woc-converter-recovery', `assets-items-${transactionId}`);
  const destinations = prepared.map((entry, index) => ({
    ...entry,
    stage: transactionSibling(entry.dst, transactionId, index, 'new'),
    backup: transactionSibling(entry.dst, transactionId, index, 'old'),
    staged: false,
    backedUp: false,
    installed: false,
  }));
  const sources = prepared.map((entry, index) => ({
    src: entry.src,
    quarantine: transactionSibling(entry.src, transactionId, index, 'source'),
    moved: false,
  }));

  for (const destination of destinations) {
    if (existsSync(destination.dst) && !lstatSync(destination.dst).isFile()) {
      throw new Error(`${rel(destination.dst)} exists and is not a regular file`);
    }
  }

  try {
    for (const destination of destinations) {
      runFsPhase('stage', () =>
        writeFileSync(destination.stage, destination.buffer, { flag: 'wx' }),
      );
      destination.staged = true;
    }
    for (const destination of destinations) {
      if (!existsSync(destination.dst)) continue;
      runFsPhase('backup', () => renameSync(destination.dst, destination.backup));
      destination.backedUp = true;
    }
    for (const destination of destinations) {
      runFsPhase('install', () => renameSync(destination.stage, destination.dst));
      destination.staged = false;
      destination.installed = true;
    }
    for (const source of sources) {
      runFsPhase('source', () => renameSync(source.src, source.quarantine));
      source.moved = true;
    }
  } catch (error) {
    const rollbackErrors = rollbackBatch(destinations, sources);
    const detail = rollbackErrors.length
      ? `; rollback incomplete: ${rollbackErrors.join('; ')}`
      : '';
    throw new Error(`${messageOf(error)}${detail}`);
  }

  const cleanupFailures = [];
  for (const destination of destinations) {
    if (!destination.backedUp) continue;
    const error = removeCommittedTemp(destination.backup, recoveryDir);
    if (error) cleanupFailures.push(`${rel(destination.backup)}: ${error}`);
  }
  for (const source of sources) {
    const error = removeCommittedTemp(source.quarantine, recoveryDir, source.src);
    if (error) cleanupFailures.push(`${rel(source.quarantine)}: ${error}`);
  }
  if (cleanupFailures.length > 0) {
    throw new Error(
      `destinations committed, but recovery temp cleanup failed: ${cleanupFailures.join('; ')}`,
    );
  }
}

async function encode(src, encodeQuality) {
  // .rotate() auto-orients from EXIF. The centered cover resize always emits the exact served
  // square, including for a mistakenly small input; source-resolution review remains a
  // separate art-intake concern. .toColorspace('srgb') is not ICC-managed, so inputs are
  // expected to already be sRGB.
  return sharp(src)
    .rotate()
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'cover', position: 'centre' })
    .toColorspace('srgb')
    .webp({ ...webpOptions, quality: encodeQuality })
    .toBuffer();
}

async function encodeWithinBudget(src) {
  let encodeQuality = quality;
  let buffer = await encode(src, encodeQuality);
  const retryQuality = Math.min(FALLBACK_QUALITY, quality);
  if (buffer.length > SIZE_CAP && retryQuality < encodeQuality) {
    encodeQuality = retryQuality;
    buffer = await encode(src, encodeQuality);
  }
  if (buffer.length > SIZE_CAP) {
    throw new Error(
      `${rel(src)} remains ${buffer.length} B at q${encodeQuality}; exceeds the 15 KiB cap`,
    );
  }
  return { buffer, encodeQuality };
}

async function main() {
  if (!existsSync(itemsDir)) {
    console.error(`[assets:items] no items dir at ${path.relative(root, itemsDir)}`);
    process.exit(1);
  }

  const entries = readdirSync(itemsDir, { withFileTypes: true });
  const transactionResidues = entries.filter((entry) => entry.name.includes('.woc-txn-'));
  if (transactionResidues.length > 0) {
    console.error(
      `[assets:items] stranded transaction files require manual recovery: ${transactionResidues
        .map((entry) => entry.name)
        .sort()
        .join(', ')}`,
    );
    process.exit(1);
  }

  const sources = entries
    .filter((ent) => ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name).toLowerCase()))
    .map((ent) => path.join(itemsDir, ent.name))
    .sort();

  if (sources.length === 0) {
    console.log('[assets:items] no non-webp images found; tree is already webp-only (no-op)');
    return;
  }

  // Refuse the whole batch on a destination collision before touching disk: two foreign
  // sources sharing a basename (foo.png + foo.jpg) both map to foo.webp, so the second
  // encode would overwrite the first and both originals would be unlinked (silent data
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
    console.error('[assets:items] refusing to convert: multiple sources map to the same .webp');
    for (const [dst, list] of collisions) {
      console.error(`  ${rel(dst)} <- ${list.map(rel).join(', ')}`);
    }
    process.exit(1);
  }

  // Encode and validate the whole batch before touching any destination or original. A cap
  // failure therefore cannot replace an accepted WebP or delete the only source painting.
  const prepared = [];
  let srcBytes = 0;
  for (const src of sources) {
    const dst = `${src.slice(0, -path.extname(src).length)}.webp`;
    const before = statSync(src).size;
    const encoded = await encodeWithinBudget(src);
    prepared.push({ src, dst, before, ...encoded });
    srcBytes += before;
  }

  commitBatch(prepared);

  let converted = 0;
  let webpBytes = 0;
  const requeued = [];
  for (const { src, dst, before, buffer, encodeQuality } of prepared) {
    const after = buffer.length;
    webpBytes += after;
    converted++;
    if (encodeQuality !== quality) requeued.push(rel(dst));
    console.log(
      `  ${rel(src)} -> ${rel(dst)}  ` +
        `(${before} -> ${after} B, ${Math.round((after / before) * 100)}%)`,
    );
  }

  const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
  const pct = srcBytes ? Math.round((webpBytes / srcBytes) * 100) : 0;
  console.log(
    `[assets:items] converted ${converted} image(s) to ${ICON_SIZE}px webp at q${quality} and ` +
      `deleted the originals; ${kib(srcBytes)} -> ${kib(webpBytes)} (${pct}% of source)`,
  );
  if (requeued.length)
    console.log(`  re-encoded at q${FALLBACK_QUALITY} to meet 15 KiB cap: ${requeued.join(', ')}`);
  console.log('[assets:items] remember to add provenance in public/ui/items/mapping.json');
}

main().catch((err) => {
  console.error('[assets:items] failed:', err);
  process.exit(1);
});
