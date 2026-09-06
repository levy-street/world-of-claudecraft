// The decisions behind the self-warming shader cache: which programs a corpus
// keeps, what makes two corpora comparable, and the pacing of their submission.
// Host-agnostic on purpose (no three, no DOM, no IndexedDB): the host
// (src/game/shader_cache_warmup.ts) only carries the WebGL and storage calls.
//
// WHY A CORPUS EXISTS. The browser keys its GPU program cache on the shader
// GLSL plus the set of WebGL extensions enabled on the compiling context, and
// that cache is shared inside one page. So a hidden webgl2 context that links
// the game's own program set, with the renderer's exact extension list, before
// the player enters the world, turns the entry's links into cache hits (the
// 2026-08-27 measurement on an RTX 3090 with cold caches: lost time over the
// first 30 s at the Eastbrook hub 3.8 to 4.3 s, down to 1.9 to 2.1 s, loading
// a second shorter). The browser's own disk cache served 5 to 10 percent of
// the programs on that machine, so a returning player is effectively cold and
// the page has to warm itself.
//
// WHY AN IDENTITY. A corpus recorded under a different build, graphics tier,
// GPU or extension set describes programs this session will never link, so
// warming it would pay the submission cost for nothing. The identity is those
// four inputs; a mismatch is a SKIP, never a partial warm-up. The extension
// list is ALSO kept beside the identity, so the warm-up context can be checked
// against the set the corpus was recorded under rather than trusted to
// reproduce it: an adapter that refuses one of those names translates every
// shader differently, and warming under the smaller set would fill the cache
// with keys this session never asks for.
//
// WHY THE ATTRIBUTE BIND. A program's cache key is not the GLSL alone: it also
// carries the explicit attribute-location bindings the program was linked
// with. three binds location 0 to `position` on every program that has that
// attribute (`hasPositionAttribute`, to dodge the disabled-attribute-0
// penalty), so a warm-up that links the same GLSL WITHOUT that bind writes a
// different key and the game's own links miss it. Measured on an RTX 3090 (two
// cells, each a recording login then a measured one on the same profile with
// the browser caches empty): with the bind replayed the entry
// has 159 and 165 programs linked at the reveal and loses 2.6 and 1.8 s over
// the first 30 s, against 145 and 146 programs and 4.0 and 3.7 s with the
// warm-up off. Without the bind the warmed entry sits ON the cold baseline
// (143 against 144, 3.9 s lost), which is no warm-up at all; every other
// candidate tried on the same rig (the extension list, the pacing, a second
// warm pass) left the win in place, and this one alone removed it.
//
// WHY A PLAN. On the 3090 the hidden context links a full set (about 390
// programs) in roughly 16 s with KHR_parallel_shader_compile, of which about
// 7 s is main-thread submission (about 19 ms per program). Submitted in one
// block that is a 7 s freeze of the character-select screen, so the plan hands
// out ONE index per call and the host spends one per animation frame.

import {
  asShaderWarmSetting,
  readShaderWarmQuery,
  type ShaderWarmPlatform,
} from './shader_warm_client_core';

/** Bumped when the record shape changes; an older record is ignored. */
export const SHADER_CORPUS_VERSION = 2;

/** A full ultra-tier set is about 390 programs; the cap bounds a pathological
 *  session (a long play session that keeps minting variants) rather than the
 *  normal one. Enforced on the way OUT (the record) and on the way IN (a
 *  stored value is untrusted, see isShaderCorpusRecord). */
export const SHADER_CORPUS_PROGRAM_LIMIT = 1024;

/** The most GLSL a corpus may carry, in bytes, applied on the way OUT (the
 *  recorder stops adding programs at it) and on the way IN (the stored bytes,
 *  the inflating stream, and the parsed record's summed source length are
 *  each refused past it). A full ultra set reads about 35 MB of text for 390
 *  programs; the character-select screen holds the inflated bytes, their
 *  decoded string and the parsed record at once while it decides, so the
 *  ceiling sits near the measured set rather than at what the program cap
 *  alone would admit. The sources three emits are ASCII, so the parsed
 *  record's character count is its byte count; a non-ASCII write is bounded
 *  by the two byte arms before it. */
export const SHADER_CORPUS_MAX_BYTES = 64 * 1024 * 1024;

/** The context extension sweep enables one pinned list (renderer_extensions.ts),
 *  a dozen names; a record naming more than this is not one of ours. */
export const SHADER_CORPUS_EXTENSION_LIMIT = 64;

/** One extension NAME. The longest the sweep enables is
 *  `WEBGL_compressed_texture_s3tc_srgb` (34 characters) and the whole WebGL
 *  registry stays under this, so a longer one is not a name: without the
 *  bound, `SHADER_CORPUS_EXTENSION_LIMIT` names alone could carry any amount
 *  of text past the record check. */
export const SHADER_CORPUS_EXTENSION_NAME_LIMIT = 64;

/** The identity string (shaderCorpusIdentity): the version, the build id, the
 *  tier, the adapter string and every extension name joined. At the two
 *  bounds above that tuple is about 4 KB, so this leaves it room and still
 *  refuses a value grown to hold text. */
export const SHADER_CORPUS_IDENTITY_LIMIT = 8 * 1024;

/** An attribute name at location 0: `position` in practice. */
export const SHADER_CORPUS_ATTRIBUTE_NAME_LIMIT = 256;

export interface ShaderProgramSources {
  vertex: string;
  fragment: string;
  /** The attribute the recorded program carries at location 0, rebound before
   *  the replay's link so its program key matches the game's. Empty when the
   *  program has no attribute there. */
  index0Attribute: string;
}

/** Every dimension the browser's program cache key depends on that this page
 *  can control: change any one of them and the recorded programs no longer
 *  describe what this session will link. */
export interface ShaderCorpusIdentityInputs {
  /** The client build (`__APP_BUILD_ID__`): the GLSL itself moves with it. */
  buildId: string;
  /** The graphics tier: it decides which materials and defines exist. */
  tier: string;
  /** The adapter string (UNMASKED_RENDERER_WEBGL): another GPU translates
   *  the same GLSL differently. */
  adapter: string;
  /** The extensions actually enabled on the compiling context, in order. */
  extensions: readonly string[];
}

export interface ShaderCorpusRecord {
  version: number;
  identity: string;
  /** The extensions the recording context had enabled, in the sweep's order.
   *  A warm-up context that cannot reproduce this list is refused. */
  extensions: string[];
  savedAt: number;
  /** The world context's own attributes, so the warm-up context is created
   *  the same way. Null when the host could not read them. */
  contextAttributes: Record<string, unknown> | null;
  programs: ShaderProgramSources[];
}

export type WarmupSkipReason =
  | 'disabled'
  | 'ios-webkit'
  | 'no-corpus'
  | 'extension-mismatch'
  | 'identity-mismatch'
  | 'no-parallel-compile';

export interface WarmupAppliesInputs {
  enabled: boolean;
  /** Phone-class WebKit, where the worker is refused for the same reason
   *  (shaderWarmModeFor): a second WebGL2 context beside the world's is a
   *  per-process memory ceiling risk there, whatever the setting says. */
  iosWebKit: boolean;
  parallelCompile: boolean;
  hasCorpus: boolean;
  /** The warm-up context enabled exactly the recorded set, in that order. */
  extensionsMatch: boolean;
  identityMatches: boolean;
}

export interface WarmupAppliesDecision {
  applies: boolean;
  reason: WarmupSkipReason | null;
}

export interface WarmupPlan {
  total: number;
  next: number;
  submitted: number;
  stopped: boolean;
}

export interface WarmupProgress {
  submitted: number;
  total: number;
  remaining: number;
  done: boolean;
}

export interface WarmupQuerySetting {
  enabled: boolean;
  /** The player named the flag rather than taking the default. */
  forced: boolean;
}

/** One string covering every identity input, so a corpus from another build,
 *  tier, GPU or extension set cannot match. */
export function shaderCorpusIdentity(inputs: ShaderCorpusIdentityInputs): string {
  return [
    `v${SHADER_CORPUS_VERSION}`,
    `build=${inputs.buildId}`,
    `tier=${inputs.tier}`,
    `adapter=${inputs.adapter}`,
    `ext=${inputs.extensions.join(',')}`,
  ].join('|');
}

/** Dedupe identical programs, keep first-seen order, cap the set. Two programs
 *  are the same only when their bind at location 0 matches too: that bind is
 *  part of the browser's program-cache key. */
export function selectCorpusPrograms(
  sources: readonly ShaderProgramSources[],
  limit: number = SHADER_CORPUS_PROGRAM_LIMIT,
  maxChars: number = SHADER_CORPUS_MAX_BYTES,
): ShaderProgramSources[] {
  const seen = new Set<string>();
  const kept: ShaderProgramSources[] = [];
  let chars = 0;
  for (const source of sources) {
    if (kept.length >= limit) break;
    const key = `${source.vertex}\u0000${source.fragment}\u0000${source.index0Attribute}`;
    if (seen.has(key)) continue;
    // Past the byte ceiling the next boot would refuse the whole record, so
    // the recorder keeps what fits (first seen, the programs of the first
    // minutes) and drops the rest.
    chars += source.vertex.length + source.fragment.length;
    if (chars > maxChars) break;
    seen.add(key);
    kept.push({
      vertex: source.vertex,
      fragment: source.fragment,
      index0Attribute: source.index0Attribute,
    });
  }
  return kept;
}

export interface CreateShaderCorpusRecordInputs {
  identity: string;
  extensions: readonly string[];
  savedAt: number;
  contextAttributes: Record<string, unknown> | null;
  sources: readonly ShaderProgramSources[];
  limit?: number;
  maxChars?: number;
}

export function createShaderCorpusRecord(
  inputs: CreateShaderCorpusRecordInputs,
): ShaderCorpusRecord {
  return {
    version: SHADER_CORPUS_VERSION,
    identity: inputs.identity,
    extensions: [...inputs.extensions],
    savedAt: inputs.savedAt,
    contextAttributes: inputs.contextAttributes,
    programs: selectCorpusPrograms(
      inputs.sources,
      inputs.limit ?? SHADER_CORPUS_PROGRAM_LIMIT,
      inputs.maxChars ?? SHADER_CORPUS_MAX_BYTES,
    ),
  };
}

/** Whatever comes back from storage is untrusted: an older version, a partial
 *  write, a foreign value or one past the size bounds must read as "no
 *  corpus", never throw at the host and never hand it an unbounded plan. */
export function isShaderCorpusRecord(
  value: unknown,
  limits: { programs?: number; bytes?: number } = {},
): value is ShaderCorpusRecord {
  const programLimit = limits.programs ?? SHADER_CORPUS_PROGRAM_LIMIT;
  const byteLimit = limits.bytes ?? SHADER_CORPUS_MAX_BYTES;
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ShaderCorpusRecord>;
  if (record.version !== SHADER_CORPUS_VERSION) return false;
  if (typeof record.identity !== 'string' || record.identity.length === 0) return false;
  if (record.identity.length > SHADER_CORPUS_IDENTITY_LIMIT) return false;
  if (!Array.isArray(record.extensions)) return false;
  if (record.extensions.length > SHADER_CORPUS_EXTENSION_LIMIT) return false;
  for (const name of record.extensions) {
    if (typeof name !== 'string') return false;
    if (name.length > SHADER_CORPUS_EXTENSION_NAME_LIMIT) return false;
  }
  if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) return false;
  if (!Array.isArray(record.programs)) return false;
  if (record.programs.length > programLimit) return false;
  // The identity and the extension names count toward the same ceiling as the
  // sources: they are text this record carries, and a size bound that ignored
  // them would be a bound on part of the record.
  let chars = record.identity.length;
  for (const name of record.extensions) chars += name.length;
  if (chars > byteLimit) return false;
  for (const program of record.programs) {
    if (typeof program !== 'object' || program === null) return false;
    const pair = program as Partial<ShaderProgramSources>;
    if (typeof pair.vertex !== 'string' || typeof pair.fragment !== 'string') return false;
    if (typeof pair.index0Attribute !== 'string') return false;
    if (pair.index0Attribute.length > SHADER_CORPUS_ATTRIBUTE_NAME_LIMIT) return false;
    chars += pair.vertex.length + pair.fragment.length;
    if (chars > byteLimit) return false;
  }
  return true;
}

/** The recorded set, reproduced name for name and in order. Reported on its
 *  own rather than left to the identity, so a warm-up context that cannot
 *  enable what the world context had says so instead of warming under a
 *  smaller set whose keys the session never asks for. */
export function warmupExtensionsMatch(
  recorded: readonly string[],
  enabled: readonly string[],
): boolean {
  if (recorded.length !== enabled.length) return false;
  for (let i = 0; i < recorded.length; i++) if (recorded[i] !== enabled[i]) return false;
  return true;
}

/** The one gate the host consults before it spends a single frame. */
export function warmupApplies(inputs: WarmupAppliesInputs): WarmupAppliesDecision {
  if (!inputs.enabled) return { applies: false, reason: 'disabled' };
  if (inputs.iosWebKit) return { applies: false, reason: 'ios-webkit' };
  if (!inputs.hasCorpus) return { applies: false, reason: 'no-corpus' };
  // Ahead of the identity, which folds the same list into one string: the
  // extension set is the one input the warm-up context can fail to reproduce
  // on a machine whose corpus is otherwise a perfect match.
  if (!inputs.extensionsMatch) return { applies: false, reason: 'extension-mismatch' };
  if (!inputs.identityMatches) return { applies: false, reason: 'identity-mismatch' };
  // Without the parallel-compile extension every link blocks the submitting
  // frame, which is the freeze this feature exists to avoid paying twice.
  if (!inputs.parallelCompile) return { applies: false, reason: 'no-parallel-compile' };
  return { applies: true, reason: null };
}

/** Whether the corpus warms, from the same two inputs the worker reads
 *  (shader_warm_client_core.ts): the `?shaderwarm=` pin first (one grammar for
 *  both arms, so `off` and `0` silence both and `all`, `reveal`, `auto` and
 *  `1` force this one), then the stored Shader Warm-up option, where only an
 *  explicit Off counts. `auto` keeps the corpus ON whatever the backend: the
 *  worker's backend rule (off on OpenGL, where it relocates the stall) is
 *  about a second context linking DURING play, while this arm links before
 *  the world exists and was measured on exactly those OpenGL desktops. No
 *  stored option at all (a test, another entry) is ON, the arm's original
 *  default. */
export function readWarmupQuery(
  search: string,
  stored: string | null | undefined = null,
): WarmupQuerySetting {
  const query = readShaderWarmQuery(search);
  if (query !== null) return { enabled: query !== 'off', forced: true };
  return { enabled: asShaderWarmSetting(stored) !== 'off', forced: false };
}

/** The platform refusal, shared with the worker's resolver in name and
 *  reason: iOS never mints the hidden context. */
export function warmupRefusedOnPlatform(platform: ShaderWarmPlatform): boolean {
  return platform === 'ios';
}

export function createWarmupPlan(count: number): WarmupPlan {
  const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return { total, next: 0, submitted: 0, stopped: false };
}

/** The next program to submit, one per call; null when the plan is exhausted
 *  or stopped. */
export function nextWarmupIndex(plan: WarmupPlan): number | null {
  if (plan.stopped || plan.next >= plan.total) return null;
  const index = plan.next;
  plan.next = index + 1;
  plan.submitted += 1;
  return index;
}

/** A stopped plan yields nothing more, whatever is left in it. */
export function stopWarmup(plan: WarmupPlan): void {
  plan.stopped = true;
}

export function warmupProgress(plan: WarmupPlan): WarmupProgress {
  const remaining = plan.stopped ? 0 : Math.max(0, plan.total - plan.next);
  return {
    submitted: plan.submitted,
    total: plan.total,
    remaining,
    done: remaining === 0,
  };
}
