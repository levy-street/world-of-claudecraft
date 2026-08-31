// The render ENVIRONMENT a portrait was baked in, as a stable fingerprint.
//
// The renderer fingerprint (mob_portrait_jobs.mjs) answers "what code and what
// inputs produced these bytes". It cannot answer "on what machine", and that is
// the gap this closes. Portrait WebPs are deterministic per machine but NOT
// byte-identical across GPU stacks and drivers, the same property the guide
// stills are existence-gated for (scripts/CLAUDE.md, "Guide / wiki"). The
// portrait manifest, unlike the stills, pins output bytes, so a re-render on a
// second machine moves every one of the committed rows while every render input
// is byte-identical. Read through the renderer fingerprint alone that is
// indistinguishable from 242 portraits genuinely changing, which is how a
// cross-environment re-mint reads as content drift and gets committed, and how
// the other environment then mints all of them back.
//
// So record WHERE the committed bytes were rendered, next to WHAT rendered them.
// A row set that moves while the render environment also moved is environment
// drift and needs a decision; a row set that moves with the environment HELD is
// a real art change.
//
// Pure and I/O free: the caller observes the facts (the browser reports the GL
// strings, node reports the host) and this module only normalizes and hashes
// them, so every drift shape is directly testable.

import { createHash } from 'node:crypto';

export const RENDER_ENV_SCHEMA_VERSION = 1;

/** The fields that make up the fingerprint, in hash order. Adding one changes
 *  every fingerprint, so it is a schema bump, not an edit. */
export const RENDER_ENV_FIELDS = Object.freeze([
  'platform',
  'arch',
  'gpuVendor',
  'gpuRenderer',
  'browserMajor',
]);

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Chrome ships a new patch build roughly weekly, and a patch bump does not move
 * a rasterized pixel. Hashing the full version string would mark every capture
 * as environment drift within days, which is the same as recording nothing:
 * the operator would learn to ignore it. The MAJOR is the granularity at which
 * this stack has actually changed rendered output, so that is what is kept, and
 * the full string rides along as unhashed provenance for a human reading the
 * manifest.
 */
export function browserMajorOf(version) {
  const match = /(\d+)/.exec(text(version));
  return match ? match[1] : '';
}

/**
 * Fold an observed environment into the recorded shape. Unknown fields
 * normalize to the empty string rather than being dropped, so a partially
 * observed environment still hashes deterministically instead of colliding with
 * a differently-shaped one.
 */
export function normalizeRenderEnv(raw) {
  const observed = raw ?? {};
  return {
    schemaVersion: RENDER_ENV_SCHEMA_VERSION,
    platform: text(observed.platform),
    arch: text(observed.arch),
    gpuVendor: text(observed.gpuVendor),
    gpuRenderer: text(observed.gpuRenderer),
    browserMajor: browserMajorOf(observed.browserVersion ?? observed.browserMajor),
    // Provenance, never hashed: the full browser build and the ANGLE backend the
    // launch ASKED for. The backend actually used already shows up inside
    // gpuRenderer, so hashing the request too would double-count it and would
    // also make a launch-flag edit look like a machine change.
    browserVersion: text(observed.browserVersion),
    requestedBackend: text(observed.requestedBackend),
  };
}

/** sha256 over the hashed fields only, in RENDER_ENV_FIELDS order. */
export function renderEnvFingerprint(env) {
  const normalized = normalizeRenderEnv(env);
  const payload = JSON.stringify([
    RENDER_ENV_SCHEMA_VERSION,
    ...RENDER_ENV_FIELDS.map((field) => normalized[field]),
  ]);
  return createHash('sha256').update(payload).digest('hex');
}

/** The recorded shape: the normalized environment plus its own fingerprint. */
export function recordRenderEnv(raw) {
  const normalized = normalizeRenderEnv(raw);
  return { ...normalized, fingerprint: renderEnvFingerprint(normalized) };
}

/**
 * Compare two recorded environments. `known` is false when either side has no
 * record at all, which is the ordinary state of a manifest minted before this
 * field existed: an absent record proves nothing, so it must never be reported
 * as a match OR as drift.
 */
export function describeRenderEnvDrift(previous, next) {
  if (!previous || !next) return { known: false, moved: false, fields: [] };
  const before = normalizeRenderEnv(previous);
  const after = normalizeRenderEnv(next);
  const fields = RENDER_ENV_FIELDS.filter((field) => before[field] !== after[field]).map(
    (field) => ({ field, from: before[field], to: after[field] }),
  );
  return { known: true, moved: fields.length > 0, fields };
}

export function formatRenderEnvDrift(drift) {
  if (!drift.known) {
    return '  render environment: not recorded on one side (nothing can be concluded)';
  }
  if (!drift.moved) return '  render environment: unchanged';
  const lines = ['  render environment CHANGED:'];
  for (const entry of drift.fields) {
    lines.push(`    ${entry.field}: ${entry.from || '(none)'} -> ${entry.to || '(none)'}`);
  }
  return lines.join('\n');
}
