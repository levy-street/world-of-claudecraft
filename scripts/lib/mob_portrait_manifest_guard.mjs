// The renderer fingerprint folds two things together: the digests of the tracked renderer
// source files and the digest of the browser render bundle. A tracked-file change is a
// renderer CODE change and re-proves every row (any output could move). The bundle digest
// alone moves on unrelated gameplay or content churn (its import graph reaches the world
// and content modules; mob_portrait_manifest_diff.mjs explains why), the same drift
// `--check` already tolerates as bookkeeping. A write under bundle-only drift therefore
// re-proves exactly the rows whose source or output actually changed, so a contributor who
// re-renders a handful of newly catalogued encounters is never asked to re-mint the
// whole set on a machine that cannot reproduce the committed bytes.
function trackedRendererFilesMatch(previous, next) {
  const before = previous?.renderer?.trackedFiles;
  const after = next?.renderer?.trackedFiles;
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
    return false;
  }
  return before.every((file, index) => {
    const other = after[index];
    return file.path === other?.path && file.bytes === other.bytes && file.sha256 === other.sha256;
  });
}

export function changedPortraitIds(previous, next) {
  if (!previous) return next.portraits.map((portrait) => portrait.id);
  if (
    previous.rendererFingerprint !== next.rendererFingerprint &&
    !trackedRendererFilesMatch(previous, next)
  ) {
    return next.portraits.map((portrait) => portrait.id);
  }
  const before = new Map(previous.portraits.map((portrait) => [portrait.id, portrait]));
  return next.portraits
    .filter((portrait) => {
      const prior = before.get(portrait.id);
      return (
        !prior ||
        prior.sourceFingerprint !== portrait.sourceFingerprint ||
        prior.output.sha256 !== portrait.output.sha256 ||
        prior.output.bytes !== portrait.output.bytes
      );
    })
    .map((portrait) => portrait.id);
}

export function assertManifestWriteAuthorized({ previous, next, receipt, allowBootstrap = false }) {
  if (!previous || previous.schemaVersion !== next.schemaVersion) {
    if (!allowBootstrap) {
      throw new Error(
        'portrait manifest bootstrap/schema migration requires explicit reviewed bootstrap evidence',
      );
    }
    return;
  }

  const changedIds = changedPortraitIds(previous, next);
  if (changedIds.length === 0) return;
  if (!receipt) {
    throw new Error(
      `portrait inputs/outputs changed for ${changedIds.length} row(s) without a renderer receipt: ${changedIds.join(', ')}`,
    );
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.generatedBy !== 'scripts/render_finder_portraits.mjs'
  ) {
    throw new Error('portrait renderer receipt has an unsupported schema or producer');
  }
  if (receipt.rendererFingerprint !== next.rendererFingerprint) {
    throw new Error('portrait renderer receipt does not match the current renderer fingerprint');
  }

  const receiptRows = new Map(receipt.portraits.map((portrait) => [portrait.id, portrait]));
  const nextRows = new Map(next.portraits.map((portrait) => [portrait.id, portrait]));
  for (const id of changedIds) {
    const expected = nextRows.get(id);
    const rendered = receiptRows.get(id);
    if (!rendered) throw new Error(`portrait renderer receipt is missing changed row ${id}`);
    if (rendered.sourceFingerprint !== expected.sourceFingerprint) {
      throw new Error(`portrait renderer receipt has stale source fingerprint for ${id}`);
    }
    if (
      rendered.output.sha256 !== expected.output.sha256 ||
      rendered.output.bytes !== expected.output.bytes
    ) {
      throw new Error(`portrait renderer receipt output does not match ${id}`);
    }
  }
}
