// The bookkeeping of the shader warm audit: which programs a gate announced
// ahead of its link (the sources it dry-assembled at creation), and how each
// program the driver later minted relates to that announcement.
//
// The classes, all decisive for the worker design that rests on them:
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
//   ungated attach). Counted by shader name, and by the key's own attribution
//   where the material carries no name, so the producer families show either
//   way.
// - out-of-band: minted while the renderer was running a burst no live frame
//   pays for (the scene census, whose bucket-visibility diffs draw the scene
//   under a lighting hash the live frame never has). Counted and sampled
//   apart from `unexpected`, because the burst, not a producer, asked for it.
// An announced key the driver never minted stays pending: a gate still in
// flight, or a state drift whose twin is an unexpected mint.
//
// Host-agnostic (RENDER_PURE_CORES): the host (shader_warm_audit.ts) reads
// the sources and the minted shaders; this core only hashes and counts.

import {
  parseThreeProgramCacheKey,
  RENDERER_OUTPUT_COLOR_SPACE_FIELD,
  THREE_PROGRAM_KEY_PARAMETERS,
} from './program_key_ledger_core';

/** Announcements kept; a login announces a few hundred keys. */
export const SHADER_WARM_AUDIT_EXPECTED_LIMIT = 4096;
/** Drift and unexpected samples kept by name, for the readout. */
export const SHADER_WARM_AUDIT_SAMPLE_LIMIT = 64;

export interface ShaderWarmAuditSource {
  cacheKey: string;
  name: string;
  /** programSourceHash of the vertex and fragment GLSL. */
  hash: string;
  /** The fragment GLSL, read only to attribute an UNEXPECTED mint (the
   *  uniform names below). Never kept: the audit holds hashes, not sources. */
  fragment?: string;
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

export type ShaderWarmAuditVerdict = 'matched' | 'drifted' | 'unexpected' | 'out-of-band';

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
  /** What the key and the GLSL say about the material, for an unexpected
   *  mint whose material carried neither a name nor a gate. */
  attribution?: ShaderWarmAuditAttribution;
}

/**
 * Who minted a program, read off the program itself.
 *
 * three names a `WebGLProgram` after `material.name` alone (`shaderName` in
 * `WebGLPrograms.getParameters`), so a procedural pass that never sets one is
 * an entry with an empty `name`; an unexpected mint has no announcing gate
 * either, so `label` is empty too, and the raw key is all that is left. The
 * key still carries the material's own fingerprint: three's shader id (or the
 * two custom shader ids for a `ShaderMaterial`), the colour space of whatever
 * was bound at the link, and, last, `material.customProgramCacheKey()`, which
 * three defaults to `onBeforeCompile.toString()`. A hooked material therefore
 * stamps its own source into its key, and the fragment stage names its own
 * uniforms: between them a producer is greppable without a breakpoint.
 */
export interface ShaderWarmAuditAttribution {
  /** The key's head: three's shader id (`physical`, `basic`, ...) for a
   *  built-in material, the custom vertex shader id for a `ShaderMaterial`. */
  shader: string;
  /** The material class the KEY implies, never read off a material (an
   *  unexpected mint has none to read): a built-in shader id names its own
   *  family, a numeric head is a `ShaderMaterial`, a key with no parameter
   *  block at all is a `RawShaderMaterial`. */
  type: string;
  /** The material carries a real `onBeforeCompile` (or its own
   *  `customProgramCacheKey`): the key's tail is not three's body-less
   *  default. */
  hooked: boolean;
  /** The key's `customProgramCacheKey` tail, whitespace-collapsed and
   *  bounded: the hook's own source, the one text that greps back to the
   *  module that installed it. */
  customKeyHead: string;
  /** The output colour space the LINK ran under: `srgb-linear` is three's
   *  working space, which it keys whenever a render target was bound, and
   *  `srgb` the canvas. Read from the key rather than from the live renderer,
   *  because the observation sweeps after the link, not during it. */
  outputColorSpace: string;
  /** The key's trailing `renderer.outputColorSpace` push, so the pair says
   *  "into a target" apart from "the renderer itself renders linear". */
  rendererOutputColorSpace: string;
  /** The fragment stage's own uniform names, three's prefix ones removed. */
  uniforms: string[];
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
  /** Unexpected mints by shader name, or by `shaderWarmAuditIdentity` where
   *  the material has none. */
  unexpectedByName: Map<string, number>;
  /** The first unexpected mints, whole keys, for the field diff. */
  unexpectedSamples: ShaderWarmAuditKeySample[];
  /** Mints an out-of-band burst forced, never part of `unexpected`. */
  outOfBand: number;
  outOfBandSamples: ShaderWarmAuditKeySample[];
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
  outOfBand: number;
  dropped: number;
  matchedBeforeReveal: number;
  unexpectedBeforeReveal: number;
  drifts: ShaderWarmAuditDrift[];
  unexpectedByName: Array<{ name: string; count: number }>;
  unexpectedSamples: ShaderWarmAuditKeySample[];
  outOfBandSamples: ShaderWarmAuditKeySample[];
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
    outOfBand: 0,
    drifts: [],
    unexpectedByName: new Map(),
    unexpectedSamples: [],
    outOfBandSamples: [],
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

/** The `customProgramCacheKey` tail kept in a sample, collapsed. */
export const SHADER_WARM_AUDIT_CUSTOM_KEY_LIMIT = 160;
/** Fragment uniform names kept in a sample. */
export const SHADER_WARM_AUDIT_UNIFORM_LIMIT = 6;
/** The tally row an unnamed material is counted under. */
export const SHADER_WARM_AUDIT_IDENTITY_LIMIT = 200;

const PRECISIONS: ReadonlySet<string> = new Set(['highp', 'mediump', 'lowp']);
const COLOR_SPACES: ReadonlySet<string> = new Set(['srgb', 'srgb-linear', '']);
const INTEGER_TOKEN = /^-?\d+$/;

/**
 * The material's own `customProgramCacheKey()` output: the LAST field of
 * three's key, and the one that carries `onBeforeCompile.toString()` by
 * default.
 *
 * three joins the key as `head..., parameters, maskA, maskB,
 * renderer.outputColorSpace, customProgramCacheKey`, and the head has a
 * variable length (the material's defines), so the parameter block is found by
 * the same anchor `parseThreeProgramCacheKey` uses: a precision token followed
 * by a colour space, with the two integer masks at the block's fixed offset.
 * A raw ShaderMaterial key carries no parameter block, hence no anchor and no
 * tail to name; `describeMintedProgram` still reports its type.
 */
export function programCustomKeyTail(cacheKey: string): string {
  const tokens = cacheKey.split(',');
  const fixed = THREE_PROGRAM_KEY_PARAMETERS.length + 3;
  for (let i = 1; i + fixed <= tokens.length; i++) {
    if (!PRECISIONS.has(tokens[i]) || !COLOR_SPACES.has(tokens[i + 1])) continue;
    const maskAt = i + THREE_PROGRAM_KEY_PARAMETERS.length;
    if (!INTEGER_TOKEN.test(tokens[maskAt]) || !INTEGER_TOKEN.test(tokens[maskAt + 1])) continue;
    return tokens.slice(maskAt + 3).join(',');
  }
  return '';
}

/** three's own prefix uniforms, which every fragment stage declares and no
 *  producer is named by. */
const THREE_PREFIX_UNIFORMS: ReadonlySet<string> = new Set([
  'viewMatrix',
  'cameraPosition',
  'isOrthographic',
  'modelMatrix',
  'modelViewMatrix',
  'projectionMatrix',
  'normalMatrix',
  'morphTexture',
  'opacity',
]);

const UNIFORM_DECL = /^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?[A-Za-z_]\w*\s+([A-Za-z_]\w*)/gm;

/** The uniform names the fragment stage declares that three did not: for an
 *  unnamed ShaderMaterial this is the text that greps back to its module. */
export function programUniformNames(
  fragment: string,
  limit = SHADER_WARM_AUDIT_UNIFORM_LIMIT,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  UNIFORM_DECL.lastIndex = 0;
  for (let hit = UNIFORM_DECL.exec(fragment); hit; hit = UNIFORM_DECL.exec(fragment)) {
    const name = hit[1];
    if (THREE_PREFIX_UNIFORMS.has(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

const NUMERIC_HEAD = /^-?\d+$/;

/** Everything the program itself says about the material that minted it. The
 *  fragment source is optional: without it the attribution still names the
 *  type, the hook and the colour space the link ran under, all from the key. */
export function describeMintedProgram(
  cacheKey: string,
  fragment?: string,
): ShaderWarmAuditAttribution {
  const parsed = parseThreeProgramCacheKey(cacheKey);
  const tail = programCustomKeyTail(cacheKey).trim();
  const collapsed = tail.replace(/\s+/g, ' ');
  // Only a numeric head is a custom shader id: a built-in material's head is
  // three's shader id, which names its own family in `shader`, and a key of
  // neither shape (a foreign key, a stub) claims no type at all.
  const custom = NUMERIC_HEAD.test(parsed.shader);
  const type = custom ? (parsed.raw ? 'RawShaderMaterial' : 'ShaderMaterial') : '';
  return {
    shader: parsed.shader,
    type,
    // three's base `onBeforeCompile` has an empty body, so a key whose tail is
    // a body-less function is a material that installed no hook. Reading the
    // body rather than the exact default source survives a minified build.
    hooked: tail.length > 0 && !/\{\s*\}$/.test(tail),
    customKeyHead:
      collapsed.length > SHADER_WARM_AUDIT_CUSTOM_KEY_LIMIT
        ? `${collapsed.slice(0, SHADER_WARM_AUDIT_CUSTOM_KEY_LIMIT)}...`
        : collapsed,
    outputColorSpace: parsed.fields.outputColorSpace ?? '',
    rendererOutputColorSpace: parsed.fields[RENDERER_OUTPUT_COLOR_SPACE_FIELD] ?? '',
    uniforms: fragment ? programUniformNames(fragment) : [],
  };
}

/** How an unexpected mint is tallied: three's shader name when the material
 *  has one, otherwise the type and the hook head, which are stable across
 *  boots and derived from the key alone (so the tally costs nothing per mint
 *  beyond a key parse, whatever the sample budget). Two unnamed materials
 *  sharing one hook share a row; their samples still carry their own
 *  uniforms. */
export function shaderWarmAuditIdentity(
  name: string,
  attribution: ShaderWarmAuditAttribution,
): string {
  if (name.length > 0) return name;
  const type = attribution.type.length > 0 ? attribution.type : attribution.shader;
  const head = attribution.hooked ? attribution.customKeyHead : '';
  const label = head.length > 0 ? `${type}:${head}` : type;
  if (label.length === 0) return '(unnamed)';
  return label.length > SHADER_WARM_AUDIT_IDENTITY_LIMIT
    ? `${label.slice(0, SHADER_WARM_AUDIT_IDENTITY_LIMIT)}...`
    : label;
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
 *  under the curtain and the boot lane announces nothing by design. A mint an
 *  out-of-band burst forced settles nothing at all: it is neither a gate's hit
 *  nor a producer's escape, and an announced key such a burst happened to mint
 *  stays pending, since three's program cache means the gate's own link never
 *  mints it a second time. */
export function observeMintedProgram(
  audit: ShaderWarmAudit,
  minted: ShaderWarmAuditSource,
  live = true,
  outOfBand = false,
): ShaderWarmAuditVerdict {
  if (outOfBand) {
    audit.outOfBand++;
    if (audit.outOfBandSamples.length < SHADER_WARM_AUDIT_SAMPLE_LIMIT) {
      audit.outOfBandSamples.push({
        cacheKey: minted.cacheKey,
        name: minted.name,
        label: '',
        attribution: describeMintedProgram(minted.cacheKey, minted.fragment),
      });
    }
    return 'out-of-band';
  }
  const expectation = audit.expected.get(minted.cacheKey);
  if (!expectation) {
    if (!live) {
      audit.unexpectedBeforeReveal++;
      return 'unexpected';
    }
    audit.unexpected++;
    // The GLSL scan rides the sample budget: past it nothing keeps the
    // uniforms, and the tally's identity never depended on them.
    const room = audit.unexpectedSamples.length < SHADER_WARM_AUDIT_SAMPLE_LIMIT;
    const attribution = describeMintedProgram(minted.cacheKey, room ? minted.fragment : undefined);
    const identity = shaderWarmAuditIdentity(minted.name, attribution);
    audit.unexpectedByName.set(identity, (audit.unexpectedByName.get(identity) ?? 0) + 1);
    if (room) {
      audit.unexpectedSamples.push({
        cacheKey: minted.cacheKey,
        name: minted.name,
        label: '',
        attribution,
      });
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
    outOfBand: audit.outOfBand,
    dropped: audit.dropped,
    driftedNameOnly: audit.driftedNameOnly,
    matchedBeforeReveal: audit.matchedBeforeReveal,
    unexpectedBeforeReveal: audit.unexpectedBeforeReveal,
    drifts: audit.drifts.slice(),
    unexpectedByName,
    unexpectedSamples: audit.unexpectedSamples.slice(),
    outOfBandSamples: audit.outOfBandSamples.slice(),
    pendingSamples,
  };
}
