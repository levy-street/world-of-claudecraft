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

export async function buildManifest() {
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
    renderer,
    portraitCount: portraits.length,
    portraits,
  };
}

// Two 64-character hashes are not a diagnosis. Whenever the committed acceptance can still be
// parsed, say WHICH part of it moved: a bundle-only drift (unrelated source churn, no art
// change) and a real portrait regression read identically otherwise, and guessing wrong costs
// a 230-portrait rerender pointed at the wrong problem.
function printDiffHint(label, expected, actual) {
  const expectedHash = sha256(expected);
  const actualHash = actual === null ? 'missing' : sha256(actual);
  console.error(`${label} is stale (expected ${expectedHash}, found ${actualHash}).`);
  if (actual !== null) {
    let committed = null;
    try {
      committed = JSON.parse(actual.toString('utf8'));
    } catch {
      committed = null;
    }
    if (committed) {
      const detail = formatManifestDrift(
        describeManifestDrift(committed, JSON.parse(expected.toString('utf8'))),
      );
      if (detail) console.error(`what moved:\n${detail}`);
    }
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
        '[--receipt <renderer-receipt.json>] [--manifest <path>] [--bootstrap-reviewed]',
    );
  }
  let receiptPath = null;
  let targetManifestPath = manifestPath;
  let bootstrapReviewed = false;
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
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (mode === '--check' && (receiptPath || bootstrapReviewed)) {
    throw new Error('--check does not accept write authorization arguments');
  }
  return { mode, receiptPath, targetManifestPath, bootstrapReviewed };
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

  const next = await buildManifest();
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (args.mode === '--check') {
    const current = existsSync(args.targetManifestPath)
      ? readFileSync(args.targetManifestPath)
      : null;
    if (current === null || !Buffer.from(serialized).equals(current)) {
      printDiffHint(
        path.relative(repoRoot, args.targetManifestPath),
        Buffer.from(serialized),
        current,
      );
      process.exit(1);
    }
    console.log(`${manifestRelativePath} is fresh`);
    return;
  }

  const previous = existsSync(args.targetManifestPath)
    ? readJson(args.targetManifestPath, 'existing manifest')
    : null;
  const receipt = args.receiptPath
    ? readJson(path.resolve(repoRoot, args.receiptPath), 'renderer receipt')
    : null;
  try {
    assertManifestWriteAuthorized({
      previous,
      next,
      receipt,
      allowBootstrap: args.bootstrapReviewed,
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
