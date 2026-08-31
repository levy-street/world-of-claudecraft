import { describeManifestDrift } from './mob_portrait_manifest_diff.mjs';
import { describeRenderEnvDrift, formatRenderEnvDrift } from './mob_portrait_render_env.mjs';

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

export function assertManifestWriteAuthorized({
  previous,
  next,
  receipt,
  allowBootstrap = false,
  allowEnvironmentRemint = false,
}) {
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
    // content change that cannot touch a single pixel still moves it. The
    // eligible shape is the drift classifier's own bookkeepingOnly verdict
    // (mob_portrait_manifest_diff): ONLY the bundle digest moved, with every
    // portrait row byte-identical, the row set, tracked renderer files, and
    // bootstrap review all unchanged. A tracked-file edit (the stills
    // renderer scripts themselves) is renderer work, not content churn, and
    // still demands the rendered receipt below, as does any row drift.
    // Residual stated plainly: a pixel-affecting edit INSIDE the bundle's
    // src/render reach is indistinguishable from content churn at this
    // layer (one bundle digest); splitting the bundle hash is a maintainer
    // call, ledgered under deviation (al).
    const drift = describeManifestDrift(previous, next);
    if (drift.bookkeepingOnly && previous.portraits.length === next.portraits.length) {
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
  if (
    receipt.renderEnv &&
    next.renderEnv &&
    receipt.renderEnv.fingerprint !== next.renderEnv.fingerprint
  ) {
    throw new Error('portrait renderer receipt does not match the recorded render environment');
  }

  // The receipt proves these bytes came out of a real render. It cannot tell
  // whether they came out of the SAME MACHINE the committed bytes did, and that
  // is the whole cross-environment ping-pong: two honest renders of identical
  // inputs disagree byte for byte because portrait WebPs are deterministic per
  // machine and not across GPU stacks. So when the render environment moved and
  // every changed row's render input is byte-identical, refuse by default and
  // say which fields moved. This is never a correctness claim about the pixels;
  // it is a claim that nobody DECIDED to swap 242 rows to another environment.
  // An unrecorded environment on either side stays silent by construction
  // (describeRenderEnvDrift reports known:false), so a manifest minted before
  // this field existed keeps working and simply records the environment on its
  // next receipt-backed write.
  const envDrift = describeRenderEnvDrift(previous.renderEnv, next.renderEnv);
  if (envDrift.moved && !allowEnvironmentRemint) {
    const before = new Map(previous.portraits.map((portrait) => [portrait.id, portrait]));
    const contentHeld = changedIds.every(
      (id) =>
        before.get(id)?.sourceFingerprint ===
        next.portraits.find((portrait) => portrait.id === id)?.sourceFingerprint,
    );
    if (contentHeld) {
      throw new Error(
        `portrait outputs for ${changedIds.length} row(s) were re-rendered in a DIFFERENT render ` +
          `environment with every render input unchanged; pass --allow-environment-remint to ` +
          `accept the swap deliberately\n${formatRenderEnvDrift(envDrift)}`,
      );
    }
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
