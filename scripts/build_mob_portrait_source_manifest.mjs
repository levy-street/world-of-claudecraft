// Builds the reviewable source-to-output ledger for every committed mob portrait.
// The real renderer and this ledger share scripts/lib/mob_portrait_jobs.mjs. A
// manifest write that changes a source or output requires a receipt emitted by
// the successful renderer run, so an old plausible WebP cannot be blessed by
// merely rerunning this bookkeeping command.
//
// Usage:
//   PORTRAIT_RECEIPT=tmp/portrait-receipt.json ONLY=<ids> node scripts/render_finder_portraits.mjs
//   node scripts/build_mob_portrait_source_manifest.mjs --write --receipt tmp/portrait-receipt.json
//   node scripts/build_mob_portrait_source_manifest.mjs --check
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  buildMobPortraitJobs,
  buildPortraitRendererContract,
  fileDigest,
  portraitRendererFingerprint,
  sha256,
} from './lib/mob_portrait_jobs.mjs';
import { describeManifestDrift, formatManifestDrift } from './lib/mob_portrait_manifest_diff.mjs';
import { assertManifestWriteAuthorized } from './lib/mob_portrait_manifest_guard.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestRelativePath =
  'docs/achievements/placeholder-art-completion-2026-08-09/mob-portrait-source-manifest.json';
const manifestPath = path.join(repoRoot, manifestRelativePath);
const bootstrapReviewRelativePath =
  'docs/achievements/placeholder-art-completion-2026-08-09/portrait-manifest-bootstrap-review.md';

/**
 * `renderEnv` is the ONE manifest field this bookkeeping command cannot derive:
 * every other field is read back off the tree, while the render environment is a
 * fact only the actual render observed. So it is carried IN. On --write it comes
 * from the receipt (the environment that really baked these bytes) and on
 * --check from the committed manifest (nothing was re-rendered, so the recorded
 * environment still stands, and re-deriving it as absent would read as drift on
 * every check). Absent on both sides is the pre-existing state and stays legal.
 */
export async function buildManifest({ renderEnv = null } = {}) {
  const renderer = await buildPortraitRendererContract(repoRoot);
  const portraits = (await buildMobPortraitJobs(repoRoot))
    .sort((left, right) => left.mobId.localeCompare(right.mobId))
    .map((job) => {
      const outputPath = `public/ui/mobs/${job.mobId}.webp`;
      if (!existsSync(path.join(repoRoot, outputPath))) {
        throw new Error(`missing committed mob portrait: ${outputPath}`);
      }
      return {
        id: job.mobId,
        family: job.family,
        finderEncounter: job.finder,
        visualKey: job.visualKey,
        renderSpec: job.renderSpec,
        tint: job.tintRecord,
        sourceFingerprint: job.sourceFingerprint,
        output: fileDigest(repoRoot, outputPath),
      };
    });
  return {
    schemaVersion: 2,
    purpose:
      'Binds every shipped mob portrait to the actual renderer job, model, attachment, tint, renderer, and output bytes.',
    bootstrapReview: fileDigest(repoRoot, bootstrapReviewRelativePath),
    rendererFingerprint: portraitRendererFingerprint(renderer),
    // Additive at the SAME schemaVersion, and deliberately so: bumping the
    // schema would make every committed manifest a bootstrap migration and
    // demand the 242-row re-render this field exists to prevent. Absent means
    // "not recorded", which the drift classifier and the write guard both read
    // as "nothing can be concluded" rather than as a match or as drift.
    ...(renderEnv ? { renderEnv } : {}),
    renderer,
    portraitCount: portraits.length,
    portraits,
  };
}

function parseManifestOrNull(buffer) {
  if (buffer === null) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

// The only fields the browser render bundle's wide import graph can move without any portrait
// row, tracked source file, schema, or count changing (mob_portrait_manifest_diff.mjs explains
// why): the top-level rendererFingerprint plus the digest half of renderer.browserBundle
// (bytes, sha256). Every other browserBundle field (entry, esbuildVersion, ...) is provenance,
// not digest, and must still be compared: blanking the whole browserBundle object would let a
// corrupted entry path or esbuild version through as "bookkeeping-only" drift. Blanking exactly
// the digest fields and deep-equating everything else PROVES nothing else drifted, rather than
// trusting a hand-enumerated dimension list to stay exhaustive as the manifest schema grows.
function withoutBundleFingerprint(manifest) {
  return {
    ...manifest,
    rendererFingerprint: null,
    renderer: {
      ...manifest.renderer,
      browserBundle: manifest.renderer?.browserBundle
        ? { ...manifest.renderer.browserBundle, bytes: null, sha256: null }
        : manifest.renderer?.browserBundle,
    },
  };
}

function isBundleOnlyDrift(committed, next) {
  return (
    committed.rendererFingerprint !== next.rendererFingerprint &&
    committed.renderer?.browserBundle?.sha256 !== next.renderer?.browserBundle?.sha256 &&
    isDeepStrictEqual(withoutBundleFingerprint(committed), withoutBundleFingerprint(next))
  );
}

// Two 64-character hashes are not a diagnosis. Whenever the committed acceptance can still be
// parsed, say WHICH part of it moved: a bundle-only drift (unrelated source churn, no art
// change) and a real portrait regression read identically otherwise, and guessing wrong costs
// a 230-portrait rerender pointed at the wrong problem.
function printDiffHint(label, expected, actual, committed, next) {
  const expectedHash = sha256(expected);
  const actualHash = actual === null ? 'missing' : sha256(actual);
  console.error(`${label} is stale (expected ${expectedHash}, found ${actualHash}).`);
  if (committed) {
    const detail = formatManifestDrift(describeManifestDrift(committed, next));
    if (detail) console.error(`what moved:\n${detail}`);
  }
  console.error(
    'Rerender changed portraits with PORTRAIT_RECEIPT set, review them, then pass that ' +
      'receipt to this script with --write --receipt <path>.',
  );
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (mode !== '--write' && mode !== '--check') {
    throw new Error(
      'usage: node scripts/build_mob_portrait_source_manifest.mjs --write|--check ' +
        '[--receipt <renderer-receipt.json>] [--manifest <path>] [--bootstrap-reviewed] ' +
        '[--allow-environment-remint]',
    );
  }
  let receiptPath = null;
  let targetManifestPath = manifestPath;
  let bootstrapReviewed = false;
  let environmentRemint = false;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--receipt') {
      receiptPath = rest[++index] ?? null;
      if (!receiptPath) throw new Error('--receipt requires a path');
    } else if (arg === '--manifest') {
      const target = rest[++index] ?? null;
      if (!target) throw new Error('--manifest requires a path');
      targetManifestPath = path.resolve(repoRoot, target);
    } else if (arg === '--bootstrap-reviewed') {
      bootstrapReviewed = true;
    } else if (arg === '--allow-environment-remint') {
      environmentRemint = true;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (mode === '--check' && (receiptPath || bootstrapReviewed || environmentRemint)) {
    throw new Error('--check does not accept write authorization arguments');
  }
  return { mode, receiptPath, targetManifestPath, bootstrapReviewed, environmentRemint };
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`could not read ${label} ${filePath}: ${error.message}`);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  // Read the two carriers of renderEnv BEFORE building, because the field cannot
  // be derived from the tree (see buildManifest): the receipt owns it on a write,
  // the committed manifest carries it forward on a check.
  const committedManifest = existsSync(args.targetManifestPath)
    ? parseManifestOrNull(readFileSync(args.targetManifestPath))
    : null;
  const loadedReceipt = args.receiptPath
    ? readJson(path.resolve(repoRoot, args.receiptPath), 'renderer receipt')
    : null;
  const next = await buildManifest({
    renderEnv:
      (args.mode === '--write' ? loadedReceipt?.renderEnv : null) ??
      committedManifest?.renderEnv ??
      null,
  });
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (args.mode === '--check') {
    const current = existsSync(args.targetManifestPath)
      ? readFileSync(args.targetManifestPath)
      : null;
    if (current !== null && Buffer.from(serialized).equals(current)) {
      console.log(`${manifestRelativePath} is fresh`);
      return;
    }
    const committed = parseManifestOrNull(current);
    // The browser render bundle's import graph reaches the world/content modules (see
    // mob_portrait_manifest_diff.mjs), so ordinary gameplay or render churn moves its digest
    // while every portrait row and shipped image byte stays identical. Failing --check on that
    // case forces a needless full rerender+receipt for zero art change: exactly the recurring
    // "re-mint portrait provenance" busywork. Only fail when a reviewer would actually have
    // something to look at (proven by deep equality, not by trusting a dimension list to stay
    // exhaustive as the schema grows).
    if (committed && isBundleOnlyDrift(committed, next)) {
      console.log(
        `${path.relative(repoRoot, args.targetManifestPath)} is fresh (bookkeeping-only ` +
          'renderer bundle drift: everything else is byte-identical to the committed acceptance).',
      );
      return;
    }
    printDiffHint(
      path.relative(repoRoot, args.targetManifestPath),
      Buffer.from(serialized),
      current,
      committed,
      next,
    );
    process.exit(1);
  }

  const previous = existsSync(args.targetManifestPath)
    ? readJson(args.targetManifestPath, 'existing manifest')
    : null;
  const receipt = loadedReceipt;
  try {
    assertManifestWriteAuthorized({
      previous,
      next,
      receipt,
      allowBootstrap: args.bootstrapReviewed,
      allowEnvironmentRemint: args.environmentRemint,
    });
  } catch (error) {
    console.error(
      `refusing to write ${path.relative(repoRoot, args.targetManifestPath)}: ${error.message}`,
    );
    process.exit(1);
  }
  writeFileSync(args.targetManifestPath, serialized);
  console.log(`wrote ${path.relative(repoRoot, args.targetManifestPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
