// The bookkeeping of the shader warm audit: which programs a gate announced
// ahead of its link (the sources it dry-assembled at creation), and how each
// program the driver later minted relates to that announcement.
//
// Three classes, all decisive for the worker design that rests on them:
// - matched: minted under an announced key with the announced GLSL. The
//   dry assembly described the link exactly; a worker warming it would have
//   turned this link into a cache hit.
// - drifted: minted under an announced key with DIFFERENT GLSL. three's key
//   is complete by design, so this is an assembly that does not reproduce
//   the link (a hook closing over moving state, a non-deterministic pass):
//   a defect in the dry path, never in the driver.
// - unexpected: minted under a key nobody announced. Either the renderer
//   state moved between the announcement and the link (a light census, a
//   fog toggle: the announced key then stays pending forever), or a producer
//   that links without announcing (the boot-resume lane, a zone prepare, an
//   ungated attach). Counted by shader name, so the producer families show.
// An announced key the driver never minted stays pending: a gate still in
// flight, or a state drift whose twin is an unexpected mint.
//
// Host-agnostic (RENDER_PURE_CORES): the host (shader_warm_audit.ts) reads
// the sources and the minted shaders; this core only hashes and counts.

/** Announcements kept; a login announces a few hundred keys. */
export const SHADER_WARM_AUDIT_EXPECTED_LIMIT = 4096;
/** Drift and unexpected samples kept by name, for the readout. */
export const SHADER_WARM_AUDIT_SAMPLE_LIMIT = 64;

export interface ShaderWarmAuditSource {
  cacheKey: string;
  name: string;
  /** programSourceHash of the vertex and fragment GLSL. */
  hash: string;
  /** The same hash with the `#define SHADER_NAME` lines removed. three's
   *  cache key does not carry the material NAME, so two same-key materials
   *  named differently share one program in three but assemble two texts;
   *  a drift that vanishes without those lines is a name-only drift: harmless
   *  for three, a browser-cache miss for a warm-up that used the other name. */
  hashSansName?: string;
}

export interface ShaderWarmAuditExpectation extends ShaderWarmAuditSource {
  /** The announcing gate (its root's name), for attribution. */
  label: string;
  atMs: number;
  /** Times a mint matched this announcement (a released program can be
   *  minted again under the same key). */
  matched: number;
}

export type ShaderWarmAuditVerdict = 'matched' | 'drifted' | 'unexpected';

export interface ShaderWarmAuditDrift {
  cacheKey: string;
  name: string;
  label: string;
  expectedHash: string;
  mintedHash: string;
  /** The texts differ only by their `#define SHADER_NAME` lines. */
  nameOnly: boolean;
}

/** A key sample for the readout: enough to diff two keys field by field
 *  (program_key_ledger_core.ts parses the three key) and name the gate. */
export interface ShaderWarmAuditKeySample {
  cacheKey: string;
  name: string;
  /** The announcing gate for a pending sample; empty for an unexpected mint. */
  label: string;
}

export interface ShaderWarmAudit {
  expected: Map<string, ShaderWarmAuditExpectation>;
  /** Announcements refused past the limit. */
  dropped: number;
  matched: number;
  drifted: number;
  /** Of the drifts, those that are name-only. */
  driftedNameOnly: number;
  unexpected: number;
  drifts: ShaderWarmAuditDrift[];
  /** Unexpected mints by shader name. */
  unexpectedByName: Map<string, number>;
  /** The first unexpected mints, whole keys, for the field diff. */
  unexpectedSamples: ShaderWarmAuditKeySample[];
  /** Mints before the reveal, counted apart (the curtain hides them). */
  matchedBeforeReveal: number;
  unexpectedBeforeReveal: number;
}

export interface ShaderWarmAuditSummary {
  expected: number;
  /** Announced keys no mint has matched yet. */
  pending: number;
  matched: number;
  drifted: number;
  driftedNameOnly: number;
  unexpected: number;
  dropped: number;
  matchedBeforeReveal: number;
  unexpectedBeforeReveal: number;
  drifts: ShaderWarmAuditDrift[];
  unexpectedByName: Array<{ name: string; count: number }>;
  unexpectedSamples: ShaderWarmAuditKeySample[];
  /** The first announced keys no mint has matched, whole keys. */
  pendingSamples: ShaderWarmAuditKeySample[];
}

export function createShaderWarmAudit(): ShaderWarmAudit {
  return {
    expected: new Map(),
    dropped: 0,
    matched: 0,
    drifted: 0,
    driftedNameOnly: 0,
    unexpected: 0,
    drifts: [],
    unexpectedByName: new Map(),
    unexpectedSamples: [],
    matchedBeforeReveal: 0,
    unexpectedBeforeReveal: 0,
  };
}

/** Two independent FNV-1a lanes over the vertex then the fragment source,
 *  hex. Not cryptographic: it tells two program texts apart for an audit
 *  readout, over strings of about a hundred kilobytes, in one pass each. */
export function programSourceHash(vertex: string, fragment: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < vertex.length; i++) {
    const c = vertex.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  // A separator no GLSL carries, so "ab" + "c" and "a" + "bc" differ.
  a = Math.imul(a ^ 0xffff, 0x01000193);
  b = Math.imul(b ^ 0xffff, 0x01000193) ^ (b >>> 13);
  for (let i = 0; i < fragment.length; i++) {
    const c = fragment.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

/** Announce a program a gate will link. A key announced twice keeps its
 *  first announcement (same key, same three parameters, same GLSL by three's
 *  own contract; a later gate over a shared material is the same program). */
export function expectProgramSource(
  audit: ShaderWarmAudit,
  source: ShaderWarmAuditSource,
  label: string,
  atMs: number,
): 'announced' | 'known' | 'dropped' {
  if (audit.expected.has(source.cacheKey)) return 'known';
  if (audit.expected.size >= SHADER_WARM_AUDIT_EXPECTED_LIMIT) {
    audit.dropped++;
    return 'dropped';
  }
  audit.expected.set(source.cacheKey, {
    cacheKey: source.cacheKey,
    name: source.name,
    hash: source.hash,
    hashSansName: source.hashSansName,
    label,
    atMs,
    matched: 0,
  });
  return 'announced';
}

/** Class one program the driver minted. A mint before the reveal (`live`
 *  false) is the boot lane's or an entry gate's: it still settles its
 *  announcement, but it is counted apart, since nothing waits on a worker
 *  under the curtain and the boot lane announces nothing by design. */
export function observeMintedProgram(
  audit: ShaderWarmAudit,
  minted: ShaderWarmAuditSource,
  live = true,
): ShaderWarmAuditVerdict {
  const expectation = audit.expected.get(minted.cacheKey);
  if (!expectation) {
    if (!live) {
      audit.unexpectedBeforeReveal++;
      return 'unexpected';
    }
    audit.unexpected++;
    audit.unexpectedByName.set(minted.name, (audit.unexpectedByName.get(minted.name) ?? 0) + 1);
    if (audit.unexpectedSamples.length < SHADER_WARM_AUDIT_SAMPLE_LIMIT) {
      audit.unexpectedSamples.push({ cacheKey: minted.cacheKey, name: minted.name, label: '' });
    }
    return 'unexpected';
  }
  if (expectation.hash === minted.hash) {
    expectation.matched++;
    if (live) audit.matched++;
    else audit.matchedBeforeReveal++;
    return 'matched';
  }
  audit.drifted++;
  const nameOnly =
    expectation.hashSansName !== undefined &&
    minted.hashSansName !== undefined &&
    expectation.hashSansName === minted.hashSansName;
  if (nameOnly) audit.driftedNameOnly++;
  if (audit.drifts.length < SHADER_WARM_AUDIT_SAMPLE_LIMIT) {
    audit.drifts.push({
      cacheKey: minted.cacheKey,
      name: minted.name,
      label: expectation.label,
      expectedHash: expectation.hash,
      mintedHash: minted.hash,
      nameOnly,
    });
  }
  return 'drifted';
}

export function shaderWarmAuditSummary(audit: ShaderWarmAudit): ShaderWarmAuditSummary {
  let pending = 0;
  const pendingSamples: ShaderWarmAuditKeySample[] = [];
  for (const expectation of audit.expected.values()) {
    if (expectation.matched !== 0) continue;
    pending++;
    if (pendingSamples.length < SHADER_WARM_AUDIT_SAMPLE_LIMIT) {
      pendingSamples.push({
        cacheKey: expectation.cacheKey,
        name: expectation.name,
        label: expectation.label,
      });
    }
  }
  const unexpectedByName = [...audit.unexpectedByName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, SHADER_WARM_AUDIT_SAMPLE_LIMIT);
  return {
    expected: audit.expected.size,
    pending,
    matched: audit.matched,
    drifted: audit.drifted,
    unexpected: audit.unexpected,
    dropped: audit.dropped,
    driftedNameOnly: audit.driftedNameOnly,
    matchedBeforeReveal: audit.matchedBeforeReveal,
    unexpectedBeforeReveal: audit.unexpectedBeforeReveal,
    drifts: audit.drifts.slice(),
    unexpectedByName,
    unexpectedSamples: audit.unexpectedSamples.slice(),
    pendingSamples,
  };
}
