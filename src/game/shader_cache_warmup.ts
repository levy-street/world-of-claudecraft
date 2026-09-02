// The self-warming shader cache: a hidden webgl2 context in THIS page links
// the programs the last session recorded, so the world entry's links are cache
// hits instead of driver work inside the first live frames.
//
// The decisions (corpus identity, dedupe and cap, pacing, the skip reasons)
// live in the pure ../render/shader_warmup_core; this host only carries the
// WebGL, storage and scheduling calls, and it never throws to its caller: a
// warm-up that fails is a session that runs exactly as it did before.
//
// THE THREE WIRING POINTS, and why they sit where they do (src/main.ts):
// - start at the character-select screen. That is the one long, idle,
//   pre-entry moment every online path passes through, and the submission
//   needs it: about 19 ms of main-thread submission per program on the
//   2026-08-27 RTX 3090 measurement, one program per animation frame.
// - stop at the top of enterWorld. From the click on, every main-thread ms
//   belongs to the world build.
// - finish after the world's reveal: release the hidden context (the game
//   context has linked its programs by then, and the measurement deliberately
//   kept the hidden one alive until that point, since a lost context can take
//   its cached translations with it), then record the session's own program
//   set for the next boot, about 25 s later on an idle callback so the corpus
//   covers the first minutes of play and costs nothing during them.
//
// The corpus is stored gzipped (about 35 MB of GLSL for a full ultra set,
// a few MB compressed) under one key in one IndexedDB store.
//
// The graphics tier read here is the LIVE `GFX.tier` at record time and the
// import-time guess at warm-up time; when the two disagree the identity simply
// does not match and the warm-up skips, which is the fail-safe direction.
//
// Off is Off, on BOTH of this arm's halves: the stored Shader Warm-up option
// and the `?shaderwarm=` pin are read through the worker's own grammar
// (../render/shader_warmup_core readWarmupQuery), and iOS never mints the
// hidden context, for the reason the worker refuses it there (a second WebGL2
// context beside the world's on a phone-class WebKit). The RECORD half asks
// the same two questions before it walks a single program: a host whose next
// boot would skip the replay is not worth the source walk or the megabytes.
// This arm is NOT a client of the renderer's preparation scheduler, and cannot
// be: it runs on the character-select screen, before any renderer or
// background_gpu_queue exists, and every world entry stops it as
// its first statement (enterWorld and startOffline), so no live frame ever
// shares the main thread with a submission. What the GPU process still holds
// in flight at the click is the entry's own program set resolving into the
// shared cache, which is the measured gain.

import { trackWebGLContext } from '../render/context_release';
import { GFX, mobilePlatformFromNavigator } from '../render/gfx';
import { enableRendererExtensions } from '../render/renderer_extensions';
import { storedShaderWarmSetting } from '../render/shader_warm_client';
import type { ShaderWarmPlatform } from '../render/shader_warm_client_core';
import {
  createShaderCorpusRecord,
  createWarmupPlan,
  isShaderCorpusRecord,
  nextWarmupIndex,
  readWarmupQuery,
  SHADER_CORPUS_MAX_BYTES,
  type ShaderCorpusRecord,
  type ShaderProgramSources,
  shaderCorpusIdentity,
  stopWarmup,
  type WarmupPlan,
  type WarmupSkipReason,
  warmupApplies,
  warmupExtensionsMatch,
  warmupRefusedOnPlatform,
} from '../render/shader_warmup_core';
import {
  pollWarmProgram,
  submitWarmProgram,
  type WarmProgramHandle,
  type WarmupGl,
} from '../render/shader_warmup_gl_core';

declare const __APP_BUILD_ID__: string;

const LOG = '[shader-warmup]';
const DB_NAME = 'woc-shader-warmup';
const STORE_NAME = 'corpus';
const CORPUS_KEY = 'corpus';
const WARMUP_CANVAS_PX = 8;
/** The world has been playable for a while by then, so reading every program's
 *  source costs the player nothing, and the set covers the first minutes. */
const RECORD_DELAY_MS = 25_000;
/** Completion polls per frame once the submission is done: a poll is one cheap
 *  GPU-process round trip, and 32 keeps the frame short. */
const RESOLVE_POLLS_PER_FRAME = 32;

/** The WebGL surface the warm-up context needs: the one every warming
 *  context shares (../render/shader_warmup_gl_core, with the worker). */
export type { WarmupGl } from '../render/shader_warmup_gl_core';

/** The extra surface the RECORDING side reads off the world context. */
export interface CorpusGl extends WarmupGl {
  SHADER_TYPE: number;
  ACTIVE_ATTRIBUTES: number;
  getActiveAttrib(program: WebGLProgram, index: number): { name: string } | null;
  getAttribLocation(program: WebGLProgram, name: string): number;
  getAttachedShaders(program: WebGLProgram): WebGLShader[] | null;
  getShaderParameter(shader: WebGLShader, pname: number): unknown;
  getShaderSource(shader: WebGLShader): string | null;
  getContextAttributes(): Record<string, unknown> | null;
}

/** What `recordShaderCorpus` needs from the three renderer, structurally. */
export interface ShaderCorpusRenderer {
  info: { programs?: readonly unknown[] | null };
  getContext(): unknown;
}

export interface WarmupContext {
  gl: WarmupGl;
  /** Called on release: loses the context and drops the canvas. */
  dispose(): void;
}

/** The storage seam. IndexedDB in the browser, a Map in tests. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface StoredCorpus {
  gzip: boolean;
  bytes: Uint8Array;
}

export interface ShaderWarmupStats {
  corpusPrograms: number;
  submitted: number;
  /** Links the completion poll saw finish (each one cached by that query). */
  resolved: number;
  elapsedMs: number;
  skipped: WarmupSkipReason | null;
  running: boolean;
  released: boolean;
  recorded: number | null;
}

interface WarmupSession {
  plan: WarmupPlan | null;
  context: WarmupContext | null;
  /** Forgets the hidden context at the page-teardown release list. */
  untrackContext: () => void;
  programs: WebGLProgram[];
  /** Submitted programs whose link has not been observed complete yet. */
  pending: WarmProgramHandle[];
  /** Programs whose link the poll saw complete (and thereby resolved). */
  resolved: number;
  shaders: WebGLShader[];
  frame: number | null;
  cancelFrame: (handle: number) => void;
  startedAt: number;
  elapsedMs: number;
  corpusPrograms: number;
  skipped: WarmupSkipReason | null;
  stopped: boolean;
  submittedLogged: boolean;
  released: boolean;
  recorded: number | null;
}

function freshSession(recorded: number | null): WarmupSession {
  return {
    plan: null,
    context: null,
    untrackContext: () => {},
    programs: [],
    pending: [],
    resolved: 0,
    shaders: [],
    frame: null,
    cancelFrame: () => {},
    startedAt: 0,
    elapsedMs: 0,
    corpusPrograms: 0,
    skipped: null,
    stopped: false,
    submittedLogged: false,
    released: false,
    recorded,
  };
}

let session: WarmupSession = freshSession(null);
let started = false;

// -- storage ---------------------------------------------------------------

export function createMemoryStore(seed?: Map<string, unknown>): KeyValueStore {
  const values = seed ?? new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(values.get(key)),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

function openCorpusDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) {
      resolve(null);
      return;
    }
    try {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** One object store, one key, every failure resolved rather than thrown. */
export function createIndexedDbStore(): KeyValueStore {
  const run = <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest,
    fallback: T,
  ): Promise<T> =>
    openCorpusDb().then(
      (db) =>
        new Promise<T>((resolve) => {
          if (!db) {
            resolve(fallback);
            return;
          }
          try {
            const tx = db.transaction(STORE_NAME, mode);
            const request = body(tx.objectStore(STORE_NAME));
            request.onsuccess = () => resolve(request.result as T);
            request.onerror = () => resolve(fallback);
            tx.oncomplete = () => db.close();
            tx.onabort = () => resolve(fallback);
          } catch {
            resolve(fallback);
          }
        }),
    );
  return {
    get: (key) => run<unknown>('readonly', (store) => store.get(key), undefined),
    set: (key, value) =>
      run<unknown>('readwrite', (store) => store.put(value, key), undefined).then(() => undefined),
  };
}

function bytesStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as BufferSource);
      controller.close();
    },
  });
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = bytesStream(bytes).pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/** Inflate under a ceiling: a counting stage errors the stream the moment the
 *  inflated bytes pass `maxBytes`, so a stored value that inflates without
 *  bound never materializes, and the bytes under it are assembled once by the
 *  platform (no chunk list beside the result). Null past the ceiling. */
async function gunzip(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array | null> {
  let total = 0;
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) controller.error(new Error('corpus past the byte ceiling'));
      else controller.enqueue(chunk);
    },
  });
  try {
    const plain = bytesStream(bytes)
      .pipeThrough(new DecompressionStream('gzip'))
      .pipeThrough(bounded);
    return new Uint8Array(await new Response(plain).arrayBuffer());
  } catch {
    return null;
  }
}

/** Gzip when the platform has `CompressionStream`, raw with the flag down
 *  otherwise, so a browser without it still warms. */
export async function encodeCorpus(record: ShaderCorpusRecord): Promise<StoredCorpus> {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  if (typeof CompressionStream === 'undefined') return { gzip: false, bytes };
  return { gzip: true, bytes: await gzip(bytes) };
}

/** The stored value is untrusted (same origin can write the store): bounded
 *  before inflation, during it, and again on the parsed record's program
 *  count and source size, so nothing past `maxBytes` is ever held. */
export async function decodeCorpus(
  stored: unknown,
  maxBytes: number = SHADER_CORPUS_MAX_BYTES,
): Promise<ShaderCorpusRecord | null> {
  if (typeof stored !== 'object' || stored === null) return null;
  const entry = stored as Partial<StoredCorpus>;
  if (!(entry.bytes instanceof Uint8Array)) return null;
  if (entry.bytes.byteLength > maxBytes) return null;
  try {
    const plain =
      entry.gzip === true
        ? typeof DecompressionStream === 'undefined'
          ? null
          : await gunzip(entry.bytes, maxBytes)
        : entry.bytes;
    if (!plain) return null;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    return isShaderCorpusRecord(parsed, { bytes: maxBytes }) ? parsed : null;
  } catch {
    return null;
  }
}

// -- context ---------------------------------------------------------------

function adapterStringOf(gl: WarmupGl): string {
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    return String(
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
  } catch {
    return '';
  }
}

function createWarmupContext(attributes: Record<string, unknown> | null): WarmupContext | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = WARMUP_CANVAS_PX;
    canvas.height = WARMUP_CANVAS_PX;
    const gl = canvas.getContext('webgl2', (attributes ?? undefined) as WebGLContextAttributes);
    if (!gl) return null;
    return {
      gl,
      dispose: () => {
        (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
      },
    };
  } catch {
    return null;
  }
}

function currentSearch(): string {
  const location = (globalThis as { location?: { search?: string } }).location;
  return location?.search ?? '';
}

function currentPlatform(): ShaderWarmPlatform {
  return mobilePlatformFromNavigator(typeof navigator === 'undefined' ? null : navigator);
}

function appBuildId(): string {
  return typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
}

function defaultScheduleFrame(callback: () => void): number {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number })
    .requestAnimationFrame;
  return raf ? raf(callback) : 0;
}

function defaultCancelFrame(handle: number): void {
  const cancel = (globalThis as { cancelAnimationFrame?: (handle: number) => void })
    .cancelAnimationFrame;
  cancel?.(handle);
}

function defaultScheduleIdle(callback: () => void, delayMs: number): void {
  const scope = globalThis as {
    setTimeout?: (cb: () => void, ms: number) => unknown;
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => unknown;
  };
  scope.setTimeout?.(() => {
    if (scope.requestIdleCallback) scope.requestIdleCallback(callback, { timeout: 10_000 });
    else callback();
  }, delayMs);
}

// -- the warm-up -----------------------------------------------------------

export interface StartShaderWarmupOptions {
  search?: string;
  /** The stored Shader Warm-up option; the registered source otherwise. */
  stored?: string | null;
  platform?: ShaderWarmPlatform;
  store?: KeyValueStore;
  buildId?: string;
  tier?: string;
  createContext?: (attributes: Record<string, unknown> | null) => WarmupContext | null;
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
}

/** The shared GL discipline (../render/shader_warmup_gl_core): the bind three
 *  made before ITS link replayed, and no LINK_STATUS query at submission. */
function submitProgram(gl: WarmupGl, sources: ShaderProgramSources): void {
  const handle = submitWarmProgram(gl, sources);
  if (!handle) return;
  session.programs.push(handle.program);
  session.pending.push(handle);
  session.shaders.push(handle.vertex, handle.fragment);
}

/** Poll a bounded slice of the pending links; a completed one is resolved by
 *  the LINK_STATUS read that follows, which is the moment the browser caches
 *  its binary (measured on the 3090 rig: 164 programs linked at the reveal
 *  with that read against 157 without it). */
function resolveCompletedLinks(gl: WarmupGl): void {
  const pending = session.pending;
  let kept = 0;
  const limit = Math.min(pending.length, RESOLVE_POLLS_PER_FRAME);
  for (let i = 0; i < limit; i++) {
    const handle = pending[i];
    const done = pollWarmProgram(gl, handle) !== 'pending';
    if (done) session.resolved++;
    else pending[kept++] = handle;
  }
  // The slice beyond the limit is untouched: shift it down behind the kept ones.
  for (let i = limit; i < pending.length; i++) pending[kept++] = pending[i];
  pending.length = kept;
}

async function runWarmup(options: StartShaderWarmupOptions): Promise<void> {
  const query = readWarmupQuery(
    options.search ?? currentSearch(),
    options.stored !== undefined ? options.stored : storedShaderWarmSetting(),
  );
  const refused = warmupRefusedOnPlatform(options.platform ?? currentPlatform());
  // Off and a refused platform read no storage and mint no context.
  const admitted = query.enabled && !refused;
  const store = options.store ?? createIndexedDbStore();
  const record = admitted ? await decodeCorpus(await store.get(CORPUS_KEY)) : null;
  // The player can have clicked through to the world while the corpus loaded.
  if (session.stopped) return;
  const hasCorpus = record !== null && record.programs.length > 0;
  const context =
    admitted && hasCorpus
      ? (options.createContext ?? createWarmupContext)(record?.contextAttributes ?? null)
      : null;
  const sweep = context ? enableRendererExtensions(context.gl) : null;
  const identity =
    context && sweep
      ? shaderCorpusIdentity({
          buildId: options.buildId ?? appBuildId(),
          tier: options.tier ?? String(GFX.tier),
          adapter: adapterStringOf(context.gl),
          extensions: sweep.enabled,
        })
      : '';
  const decision = warmupApplies({
    enabled: query.enabled,
    iosWebKit: refused,
    parallelCompile: sweep?.parallelCompile ?? false,
    hasCorpus,
    extensionsMatch:
      record !== null && sweep !== null && warmupExtensionsMatch(record.extensions, sweep.enabled),
    identityMatches: record !== null && record.identity === identity,
  });
  if (!decision.applies || !record || !context) {
    context?.dispose();
    session.skipped = decision.reason;
    console.info(`${LOG} skipped: ${decision.reason ?? 'no context'}`);
    return;
  }
  const now = options.now ?? (() => Date.now());
  const scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
  const plan = createWarmupPlan(record.programs.length);
  session.plan = plan;
  session.context = context;
  // A second live context is capped per GPU process with the world's: the
  // page-teardown release (context_release.ts) loses it with the rest, so an
  // entry that never reaches its reveal cannot keep it for the page's life.
  session.untrackContext = trackWebGLContext({
    forceContextLoss: releaseShaderWarmup,
    dispose: releaseShaderWarmup,
  });
  session.cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  session.corpusPrograms = record.programs.length;
  session.startedAt = now();
  console.info(`${LOG} warming ${record.programs.length} programs, one per frame`);
  const step = (): void => {
    if (session.plan !== plan) return;
    session.frame = null;
    const index = nextWarmupIndex(plan);
    session.elapsedMs = now() - session.startedAt;
    if (index === null) {
      if (!session.submittedLogged) {
        session.submittedLogged = true;
        console.info(
          `${LOG} submitted ${plan.submitted} programs in ${Math.round(session.elapsedMs)} ms`,
        );
      }
      resolveCompletedLinks(context.gl);
      if (session.pending.length === 0 || session.stopped) {
        console.info(
          `${LOG} resolved ${session.resolved} links in ${Math.round(session.elapsedMs)} ms`,
        );
        return;
      }
      session.frame = scheduleFrame(step);
      return;
    }
    submitProgram(context.gl, record.programs[index]);
    session.frame = scheduleFrame(step);
  };
  session.frame = scheduleFrame(step);
}

/** Load the stored corpus and start paying it out, one program per frame.
 *  Fire and forget: every failure ends as a console line and a skip reason.
 *  Idempotent: the character-select screen is shown again on the way back from
 *  character creation, and restarting would resubmit the whole corpus. */
export function startShaderWarmup(options: StartShaderWarmupOptions = {}): void {
  // The one handle a browser perf probe has on this feature.
  (globalThis as { __shaderWarmup?: () => ShaderWarmupStats }).__shaderWarmup = shaderWarmupStats;
  if (started) return;
  started = true;
  const recorded = session.recorded;
  releaseShaderWarmup();
  session = freshSession(recorded);
  void runWarmup(options).catch((error: unknown) => {
    console.warn(`${LOG} warm-up failed`, error);
  });
}

/** The player clicked enter: from here the main thread belongs to the world. */
export function stopShaderWarmup(): void {
  session.stopped = true;
  const plan = session.plan;
  if (plan && plan.submitted < plan.total) {
    console.info(`${LOG} stopped after ${plan.submitted}/${plan.total} programs`);
  }
  if (plan) stopWarmup(plan);
  if (session.frame !== null) {
    session.cancelFrame(session.frame);
    session.frame = null;
  }
}

/** Drop the hidden context. Deliberately NOT called at stop: the game context
 *  links its own programs during the entry, and the measurement kept the
 *  warm-up context alive until the world was revealed. */
export function releaseShaderWarmup(): void {
  stopShaderWarmup();
  const context = session.context;
  if (context) {
    for (const program of session.programs) context.gl.deleteProgram(program);
    for (const shader of session.shaders) context.gl.deleteShader(shader);
    context.dispose();
  }
  session.untrackContext();
  session.untrackContext = () => {};
  session.programs = [];
  session.shaders = [];
  session.context = null;
  session.released = true;
}

// -- recording -------------------------------------------------------------

export interface RecordShaderCorpusOptions {
  search?: string;
  /** The stored Shader Warm-up option; the registered source otherwise. */
  stored?: string | null;
  platform?: ShaderWarmPlatform;
  store?: KeyValueStore;
  buildId?: string;
  tier?: string;
  now?: () => number;
}

/** The attribute the linked program carries at location 0. three binds
 *  `position` there on every program that has it, and that bind is part of the
 *  program cache key, so the replay has to make the same one. */
function index0AttributeOf(gl: CorpusGl, program: WebGLProgram): string {
  const count = Number(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) ?? 0);
  for (let i = 0; i < count; i++) {
    const attribute = gl.getActiveAttrib(program, i);
    if (attribute && gl.getAttribLocation(program, attribute.name) === 0) return attribute.name;
  }
  return '';
}

function programSourcesOf(gl: CorpusGl, entries: readonly unknown[]): ShaderProgramSources[] {
  const sources: ShaderProgramSources[] = [];
  for (const entry of entries) {
    const program = (entry as { program?: unknown } | null)?.program;
    if (!program) continue;
    const shaders = gl.getAttachedShaders(program as WebGLProgram);
    if (!shaders) continue;
    let vertex = '';
    let fragment = '';
    for (const shader of shaders) {
      const source = gl.getShaderSource(shader) ?? '';
      if (gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER) vertex = source;
      else fragment = source;
    }
    if (vertex && fragment) {
      sources.push({
        vertex,
        fragment,
        index0Attribute: index0AttributeOf(gl, program as WebGLProgram),
      });
    }
  }
  return sources;
}

/** Read this session's whole program set off the world renderer and store it
 *  for the next boot. Never throws: a failed record is one console line. */
export async function recordShaderCorpus(
  renderer: ShaderCorpusRenderer,
  options: RecordShaderCorpusOptions = {},
): Promise<number> {
  try {
    // The record side reads exactly what the replay side reads, because a host
    // that will never replay a corpus has no reason to pay for one: recording
    // walks every program's source on the main thread and writes a few MB to
    // IndexedDB, and under Off or on iOS the next boot skips before it ever
    // looks at them.
    const query = readWarmupQuery(
      options.search ?? currentSearch(),
      options.stored !== undefined ? options.stored : storedShaderWarmSetting(),
    );
    const refused = warmupRefusedOnPlatform(options.platform ?? currentPlatform());
    if (!query.enabled || refused) {
      console.info(`${LOG} recording skipped: ${refused ? 'ios-webkit' : 'disabled'}`);
      return 0;
    }
    const gl = renderer.getContext() as CorpusGl;
    const entries = renderer.info.programs ?? [];
    const sweep = enableRendererExtensions(gl);
    const record = createShaderCorpusRecord({
      identity: shaderCorpusIdentity({
        buildId: options.buildId ?? appBuildId(),
        tier: options.tier ?? String(GFX.tier),
        adapter: adapterStringOf(gl),
        extensions: sweep.enabled,
      }),
      extensions: sweep.enabled,
      savedAt: (options.now ?? (() => Date.now()))(),
      contextAttributes: gl.getContextAttributes(),
      sources: programSourcesOf(gl, entries),
    });
    const store = options.store ?? createIndexedDbStore();
    await store.set(CORPUS_KEY, await encodeCorpus(record));
    session.recorded = record.programs.length;
    console.info(`${LOG} recorded ${record.programs.length} programs for the next boot`);
    return record.programs.length;
  } catch (error) {
    console.warn(`${LOG} recording failed`, error);
    return 0;
  }
}

export interface FinishShaderWarmupOptions extends RecordShaderCorpusOptions {
  delayMs?: number;
  scheduleIdle?: (callback: () => void, delayMs: number) => void;
}

/** The world is revealed: let the hidden context go, then record this
 *  session's own program set once the first minutes of play have run. */
export function finishShaderWarmup(
  renderer: ShaderCorpusRenderer,
  options: FinishShaderWarmupOptions = {},
): void {
  releaseShaderWarmup();
  const schedule = options.scheduleIdle ?? defaultScheduleIdle;
  schedule(() => {
    void recordShaderCorpus(renderer, options);
  }, options.delayMs ?? RECORD_DELAY_MS);
}

/** What happened, for the perf probes. */
export function shaderWarmupStats(): ShaderWarmupStats {
  return {
    corpusPrograms: session.corpusPrograms,
    submitted: session.plan?.submitted ?? 0,
    resolved: session.resolved,
    elapsedMs: session.elapsedMs,
    skipped: session.skipped,
    running: session.frame !== null,
    released: session.released,
    recorded: session.recorded,
  };
}

export const shaderWarmupInternalsForTest = {
  reset: (): void => {
    session = freshSession(null);
    started = false;
  },
  corpusKey: CORPUS_KEY,
};
