// Explains WHY a recomputed portrait source manifest no longer matches the committed
// acceptance. The acceptance pins the sha256 of the whole browser render bundle, and that
// bundle's import graph reaches the world and content modules
// (src/render/assets/loader.ts -> src/render/gfx.ts -> src/render/biome_haze_field.ts ->
// src/sim/data.ts), so ordinary gameplay churn moves the bundle digest while every portrait
// row and every shipped image byte stays identical. Without this breakdown that case is
// indistinguishable from a real art regression: the only signal is two 64-character hashes,
// which is exactly how a bookkeeping drift gets misdiagnosed as a broken renderer.
//
// Pure and I/O free on purpose, so tests can drive every drift shape directly.

function rowsById(manifest) {
  return new Map((manifest?.portraits ?? []).map((portrait) => [portrait.id, portrait]));
}

function digestOf(file) {
  return file ? `${file.bytes}:${file.sha256}` : null;
}

// Classifies the difference between the committed acceptance (`previous`) and what the
// current tree produces (`next`). Returns plain data; formatting lives in
// formatManifestDrift so the classification stays testable on its own.
export function describeManifestDrift(previous, next) {
  const schemaChanged = previous?.schemaVersion !== next?.schemaVersion;
  const portraitCountChanged = previous?.portraitCount !== next?.portraitCount;
  const fingerprintChanged = previous?.rendererFingerprint !== next?.rendererFingerprint;
  const bundleChanged =
    digestOf(previous?.renderer?.browserBundle) !== digestOf(next?.renderer?.browserBundle);
  const bootstrapReviewChanged =
    digestOf(previous?.bootstrapReview) !== digestOf(next?.bootstrapReview);

  const previousTracked = new Map(
    (previous?.renderer?.trackedFiles ?? []).map((file) => [file.path, digestOf(file)]),
  );
  const changedTrackedFiles = (next?.renderer?.trackedFiles ?? [])
    .filter((file) => previousTracked.get(file.path) !== digestOf(file))
    .map((file) => file.path);

  const before = rowsById(previous);
  const changedRows = [];
  for (const portrait of next?.portraits ?? []) {
    const prior = before.get(portrait.id);
    const sourceChanged = !prior || prior.sourceFingerprint !== portrait.sourceFingerprint;
    const outputChanged = !prior || digestOf(prior.output) !== digestOf(portrait.output);
    if (sourceChanged || outputChanged) {
      changedRows.push({ id: portrait.id, sourceChanged, outputChanged });
    }
  }

  // The one case worth naming: every render input and every shipped byte is intact and only
  // the bundle digest moved.
  const bookkeepingOnly =
    !schemaChanged &&
    !portraitCountChanged &&
    !bootstrapReviewChanged &&
    changedRows.length === 0 &&
    changedTrackedFiles.length === 0 &&
    bundleChanged;

  return {
    schemaChanged,
    portraitCountChanged,
    fingerprintChanged,
    bundleChanged,
    bootstrapReviewChanged,
    changedTrackedFiles,
    changedRows,
    bookkeepingOnly,
  };
}

const MAX_LISTED_ROWS = 10;

export function formatManifestDrift(drift) {
  const lines = [];
  if (drift.schemaChanged) {
    lines.push('  schemaVersion changed (a schema migration, not a rerender)');
  }
  if (drift.portraitCountChanged) {
    lines.push('  portraitCount changed (mobs were added or removed)');
  }
  if (drift.bootstrapReviewChanged) {
    lines.push('  the bootstrap review document changed');
  }
  if (drift.changedTrackedFiles.length > 0) {
    lines.push(`  renderer source changed: ${drift.changedTrackedFiles.join(', ')}`);
  }
  if (drift.bundleChanged) {
    lines.push('  renderer.browserBundle digest changed');
  }
  if (drift.changedRows.length > 0) {
    const sourceOnly = drift.changedRows.filter((row) => row.sourceChanged && !row.outputChanged);
    const outputOnly = drift.changedRows.filter((row) => row.outputChanged && !row.sourceChanged);
    const both = drift.changedRows.filter((row) => row.sourceChanged && row.outputChanged);
    lines.push(
      `  ${drift.changedRows.length} portrait row(s) changed (${sourceOnly.length} source only, ` +
        `${outputOnly.length} output only, ${both.length} both)`,
    );
    const listed = drift.changedRows.slice(0, MAX_LISTED_ROWS).map((row) => row.id);
    const overflow = drift.changedRows.length - listed.length;
    lines.push(`    ${listed.join(', ')}${overflow > 0 ? `, and ${overflow} more` : ''}`);
  }

  if (drift.bookkeepingOnly) {
    lines.push('  No portrait row and no shipped image byte changed: only the browser render');
    lines.push('  bundle moved. Its import graph reaches the world and content modules through');
    lines.push(
      '  src/render/assets/loader.ts -> src/render/gfx.ts -> src/render/biome_haze_field.ts,',
    );
    lines.push(
      '  so any gameplay or render source edit moves it. Re-accepting is bookkeeping here:',
    );
    lines.push(
      '  the rerender is expected to reproduce every committed portrait byte for byte, and',
    );
    lines.push('  a portrait whose bytes DO move is a real art change that needs review.');
  }
  return lines.join('\n');
}
