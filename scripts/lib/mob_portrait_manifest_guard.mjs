export function changedPortraitIds(previous, next) {
  if (!previous || previous.rendererFingerprint !== next.rendererFingerprint) {
    return next.portraits.map((portrait) => portrait.id);
  }
  return rowChangedPortraitIds(previous, next);
}

/** Per-row drift alone, blind to the renderer fingerprint: rows whose source
 *  fingerprint or output bytes moved, plus rows with no prior. Removals are
 *  invisible here by construction; pair with a portrait-count check. */
export function rowChangedPortraitIds(previous, next) {
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
    // FINGERPRINT-ONLY REFRESH: the renderer fingerprint hashes the whole
    // esbuild browser bundle, whose import graph reaches sim content, so a
    // content change that cannot touch a single pixel still moves it. When
    // EVERY portrait row is byte-identical (same source fingerprints, same
    // output digests, same row set), no pixel input or output moved and
    // there is nothing a re-render could evidence: the manifest may adopt
    // the new fingerprint without a receipt. Any actual row drift still
    // demands the rendered receipt below, unchanged.
    if (
      previous.rendererFingerprint !== next.rendererFingerprint &&
      previous.portraits.length === next.portraits.length &&
      rowChangedPortraitIds(previous, next).length === 0
    ) {
      return;
    }
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
