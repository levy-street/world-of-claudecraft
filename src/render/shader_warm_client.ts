// The shader warm client: the main thread's side of the worker
// (shader_warm_worker.ts). It spawns the worker once, hands it the game
// context's own contract (context attributes, the enabled extension set in
// order, the platform's window and retention caps), dedupes the programs it
// is asked for, answers "warm now?" promises, forwards the pause signal, and
// reads out. Policy and bookkeeping live in shader_warm_client_core.ts; this
// file carries the Worker, the context reads and the query flag.
//
// Deliberately FALLIBLE and optional, like zone_build_pool.ts: wherever
// module workers, OffscreenCanvas or the extension set are missing, the
// client reports unavailable and every gate keeps its path. A worker that
// dies (module load failure, OOM kill, lost context), never answers ready,
// or lets gates time out repeatedly is retired and the policy falls back to
// the pre-worker path for the rest of the renderer's life: no gate waits on
// a worker that has stopped delivering.
//
// The worker's context is one more WebGL context in the GPU process (the
// cap is about sixteen, context_release.ts); it lives in the worker, so the
// page's own release hook cannot reach it, and the client retires the worker
// itself on a pagehide that is not a bfcache freeze (hookPagehide).

import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import { mobilePlatformFromNavigator } from './gfx';
import { type GpuBackendClass, readGpuBackend } from './gpu_backend_class_core';
import { enableRendererExtensions } from './renderer_extensions';
import {
  createShaderWarmHoldRing,
  createShaderWarmPauseState,
  createShaderWarmRequests,
  noteShaderWarmFrame,
  readShaderWarmReadyDeadline,
  readShaderWarmSetting,
  SHADER_WARM_EXPIRED_SHARE_BREAKER,
  SHADER_WARM_TIMEOUT_BREAKER,
  type ShaderWarmBypass,
  type ShaderWarmDecision,
  type ShaderWarmMode,
  type ShaderWarmOutcome,
  type ShaderWarmPlatform,
  type ShaderWarmRequestSource,
  type ShaderWarmRequestStats,
  type ShaderWarmRequests,
  type ShaderWarmSetting,
  shaderWarmDecision,
  shaderWarmModeFor,
} from './shader_warm_client_core';
import type { ShaderWarmSource, ShaderWarmWorkerMessage } from './shader_warm_protocol';
import {
  SHADER_WARM_MAX_WINDOW_DESKTOP,
  SHADER_WARM_MAX_WINDOW_MOBILE,
  SHADER_WARM_RETAINED_DESKTOP,
  SHADER_WARM_RETAINED_MOBILE,
} from './shader_warm_worker_core';

/** The game context slice the client reads once, at the first request. */
export interface ShaderWarmContextSource {
  getContextAttributes(): object | null;
  getExtension(name: string): unknown;
  /** The renderer string read (the backend class); absent reads as unknown. */
  getParameter?(name: number): unknown;
}

export type ShaderWarmWorkerState = 'idle' | 'starting' | 'ready' | 'refused' | 'dead';

export interface ShaderWarmSnapshot extends ShaderWarmRequestStats {
  /** The player's setting (or the probe's query pin). */
  setting: ShaderWarmSetting;
  /** The mode in force: the setting, or what `auto` resolved to. */
  mode: ShaderWarmMode;
  /** The backend class `auto` follows; null until a context was seen. */
  backend: GpuBackendClass | null;
  armed: boolean;
  worker: ShaderWarmWorkerState;
  refusal: string | null;
  adapter: string;
  paused: boolean;
  frameEmaMs: number;
  /** The worker's last stats message. */
  workerStats: {
    pending: number;
    inFlight: number;
    windowLinks: number;
    state: string;
    warmed: number;
    failed: number;
    retained: number;
    cancelled: number;
    backoffCount: number;
    maxWindowObserved: number;
    etalonMsPerKchar: number | null;
    soloSamples: number;
  } | null;
}

interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ShaderWarmWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface ShaderWarmClientDeps {
  spawn?: () => WorkerLike | null;
  search?: string;
  /** The stored graphics option; the page default reads the registered source. */
  stored?: string | null;
  mobile?: boolean;
  /** The platform class (iOS refuses the worker whatever the setting). */
  platform?: ShaderWarmPlatform;
  /** Injectable timer for the ready deadline; returns the cancel. */
  schedule?: (callback: () => void, ms: number) => () => void;
  /** Injectable clock, for the breaker's progress check. */
  now?: () => number;
}

/** A request a hold can give up on: `settled` resolves with each program's
 *  outcome; `abandon` tells the worker to drop what nobody else waits for. */
export interface ShaderWarmHold {
  settled: Promise<ShaderWarmOutcome[]>;
  abandon(): void;
}

/** How long a spawned worker has to answer ready. A module worker loads and
 *  creates its context in well under a second on every tested platform; a
 *  worker silent past this is treated as absent, so no gate holds for it. */
export const SHADER_WARM_READY_DEADLINE_MS = 3_000;

const state = {
  setting: 'auto' as ShaderWarmSetting,
  mode: 'off' as ShaderWarmMode,
  backend: null as GpuBackendClass | null,
  armed: false,
  worker: null as WorkerLike | null,
  workerState: 'idle' as ShaderWarmWorkerState,
  refusal: null as string | null,
  adapter: '',
  requests: createShaderWarmRequests() as ShaderWarmRequests,
  pause: createShaderWarmPauseState(),
  /** What the worker was last told; the frame average alone does not decide. */
  workerPaused: false,
  workerStats: null as ShaderWarmSnapshot['workerStats'],
  spawn: null as (() => WorkerLike | null) | null,
  schedule: null as ShaderWarmClientDeps['schedule'] | null,
  now: null as (() => number) | null,
  readyDeadlineMs: SHADER_WARM_READY_DEADLINE_MS,
  /** The query string configure resolved against; a later re-read of the
   *  stored option has to honour the same `?shaderwarm=` pin. */
  search: '',
  mobile: false,
  platform: 'other' as ShaderWarmPlatform,
  /** Sources handed in before the worker answered ready, sent on ready. */
  queuedUntilReady: [] as ShaderWarmSource[],
  cancelReadyDeadline: null as (() => void) | null,
  pagehideHooked: false,
  /** Held gates that expired in a row while the worker settled nothing:
   *  the breaker's count. */
  consecutiveTimeouts: 0,
  /** When the worker last answered warmed, on the client's clock. */
  lastWarmedAtMs: Number.NEGATIVE_INFINITY,
  /** The last few holds, for the breaker's expired-share rule. */
  holds: createShaderWarmHoldRing(),
  /** Why the worker was retired FOR CAUSE, if it was. Sticky across a setting
   *  round trip; only a renderer swap clears it (retireAndForgetWorker). */
  retiredCause: null as { worker: 'dead' | 'refused'; reason: string | null } | null,
};

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function defaultSpawn(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./shader_warm_worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as WorkerLike;
  } catch {
    return null;
  }
}

/** The client's own mobile signal: the body class the mobile controls set. */
function defaultMobile(): boolean {
  const body = (globalThis as { document?: { body?: { classList?: DOMTokenList } } }).document
    ?.body;
  return body?.classList?.contains('mobile-touch') === true;
}

function defaultSchedule(callback: () => void, ms: number): () => void {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
}

function currentSearch(): string {
  return (globalThis as { location?: { search?: string } }).location?.search ?? '';
}

/** Where the stored graphics option comes from; registered by the settings
 *  module at boot, so this module never reaches into persistence itself. */
let storedSettingSource: () => string | null = () => null;

export function setShaderWarmStoredSettingSource(source: () => string | null): void {
  storedSettingSource = source;
}

/** The stored option as registered, for the character-select corpus
 *  (src/game/shader_cache_warmup.ts), which honours the same Off. */
export function storedShaderWarmSetting(): string | null {
  return storedSettingSource();
}

/** Read once, so a probe can pin an arm; the defaults are the page's. `auto`
 *  stays OFF until the first policy call brings a context whose backend
 *  decides it. */
export function configureShaderWarm(deps: ShaderWarmClientDeps = {}): void {
  const search = deps.search ?? currentSearch();
  state.search = search;
  state.setting = readShaderWarmSetting(
    search,
    deps.stored !== undefined ? deps.stored : storedSettingSource(),
  );
  state.readyDeadlineMs = readShaderWarmReadyDeadline(search, SHADER_WARM_READY_DEADLINE_MS);
  state.backend = null;
  state.platform = deps.platform ?? defaultPlatform();
  state.mode = shaderWarmModeFor(state.setting, null, state.platform);
  // The one refusal decided before any context: named so the readout says
  // why an explicit setting did nothing on a phone.
  if (state.platform === 'ios' && state.setting !== 'off') state.refusal = 'ios-webkit';
  state.spawn = deps.spawn ?? defaultSpawn;
  state.schedule = deps.schedule ?? defaultSchedule;
  state.now = deps.now ?? defaultNow;
  state.mobile = deps.mobile ?? defaultMobile();
}

function defaultPlatform(): ShaderWarmPlatform {
  return mobilePlatformFromNavigator(typeof navigator === 'undefined' ? null : navigator);
}

function onWorkerMessage(event: MessageEvent<ShaderWarmWorkerMessage>): void {
  const message = event.data;
  switch (message.kind) {
    case 'ready':
      state.cancelReadyDeadline?.();
      state.cancelReadyDeadline = null;
      if (message.ok) {
        state.workerState = 'ready';
        state.adapter = message.adapter;
        const queued = state.queuedUntilReady;
        state.queuedUntilReady = [];
        if (queued.length > 0) state.worker?.postMessage({ kind: 'warm', sources: queued });
        syncWorkerPause();
      } else {
        retireForCause('refused', message.reason);
        retireWorker();
      }
      break;
    case 'warmed':
      state.lastWarmedAtMs = (state.now ?? defaultNow)();
      // A link time counts only for a request that was waiting for it.
      if (state.requests.settle(message.id, 'warmed')) state.requests.noteLink(message.linkMs);
      syncWorkerPause();
      break;
    case 'failed':
      state.requests.settle(message.id, 'failed', message.reason === 'cancelled');
      syncWorkerPause();
      break;
    case 'lost':
      retireForCause('dead', 'context-lost');
      retireWorker();
      break;
    case 'stats':
      state.workerStats = {
        pending: message.pending,
        inFlight: message.inFlight,
        windowLinks: message.windowLinks,
        state: message.state,
        warmed: message.warmed,
        failed: message.failed,
        retained: message.retained,
        cancelled: message.cancelled,
        backoffCount: message.backoffCount,
        maxWindowObserved: message.maxWindowObserved,
        etalonMsPerKchar: message.etalonMsPerKchar,
        soloSamples: message.soloSamples,
      };
      break;
  }
}

/** Record why this worker is not worth asking again, and stop the session
 *  using it. A cause recorded here survives the player toggling the row Off
 *  and back on (noteShaderWarmSettingChanged restores it), because the reason
 *  it was retired, a wedged worker, a drifted extension set, a worker that
 *  never loaded, is a property of this renderer's context and not of the
 *  setting: without that, Off then On respawned a worker the breaker or the
 *  extension sweep had already ruled out, and the drift case never healed. */
function retireForCause(worker: 'dead' | 'refused', reason: string | null): void {
  state.workerState = worker;
  state.refusal = reason;
  state.retiredCause = { worker, reason };
}

/** Terminate the worker and fail whoever waits. The browser reclaims the
 *  worker's context with the worker; a dispose message could not run before
 *  the terminate that follows it, so none is sent. */
function retireWorker(): void {
  const worker = state.worker;
  state.worker = null;
  state.queuedUntilReady = [];
  state.cancelReadyDeadline?.();
  state.cancelReadyDeadline = null;
  state.workerPaused = false;
  state.requests.failAll();
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    try {
      worker.terminate();
    } catch {
      // Already gone.
    }
  }
}

/** The page is going away: give its worker's context back with it. Reads the
 *  event's `persisted` flag for the reason context_release.ts does. A page
 *  FROZEN into the bfcache can come back, and there would be nothing to come
 *  back to: the bare terminate leaves `workerState` reading `ready`, while
 *  startWorker only ever runs from `idle`, so shaderWarmAvailable() would keep
 *  answering true and every later gate would pay the dry assembly and then
 *  settle failed on a worker that no longer exists. So a persisted pagehide
 *  does nothing at all.
 *  A pagehide without persistence is the page really going away, and there the
 *  cheapest consistent state is a retirement FOR CAUSE: `refused`, which no
 *  later policy call respawns from (it is not `idle`), so nothing mints a
 *  second WebGL2 context during a teardown, availability reads false, every
 *  gate takes the `unavailable` bypass, and the readout names why. */
function hookPagehide(): void {
  if (state.pagehideHooked) return;
  const scope = globalThis as {
    addEventListener?: (type: string, cb: (event?: { persisted?: boolean }) => void) => void;
  };
  if (typeof scope.addEventListener !== 'function') return;
  state.pagehideHooked = true;
  scope.addEventListener('pagehide', (event) => {
    if (event?.persisted === true) return;
    retireForCause('refused', 'pagehide');
    retireWorker();
  });
}

function startWorker(context: ShaderWarmContextSource): void {
  if (state.workerState !== 'idle') return;
  if (!state.spawn) configureShaderWarm();
  const worker = state.spawn?.() ?? null;
  if (!worker) {
    retireForCause('refused', 'no-worker');
    return;
  }
  hookPagehide();
  state.workerState = 'starting';
  state.worker = worker;
  worker.onmessage = onWorkerMessage;
  worker.onerror = () => {
    retireForCause('dead', 'worker-error');
    retireWorker();
  };
  let attributes: Record<string, unknown> | null = null;
  try {
    attributes = context.getContextAttributes() as Record<string, unknown> | null;
  } catch {
    attributes = null;
  }
  const sweep = enableRendererExtensions(context);
  worker.postMessage({
    kind: 'init',
    contextAttributes: attributes,
    extensions: sweep.enabled,
    maxWindow: state.mobile ? SHADER_WARM_MAX_WINDOW_MOBILE : SHADER_WARM_MAX_WINDOW_DESKTOP,
    retain: state.mobile ? SHADER_WARM_RETAINED_MOBILE : SHADER_WARM_RETAINED_DESKTOP,
  });
  state.cancelReadyDeadline = (state.schedule ?? defaultSchedule)(() => {
    state.cancelReadyDeadline = null;
    if (state.workerState !== 'starting') return;
    retireForCause('refused', 'ready-timeout');
    retireWorker();
  }, state.readyDeadlineMs);
}

export function shaderWarmAvailable(): boolean {
  return state.workerState === 'ready' || state.workerState === 'starting';
}

/** The policy call every gate makes first (shader_warm_client_core.ts). A
 *  bypass is counted here, so the readout carries it. */
export function shaderWarmDecide(
  context: ShaderWarmContextSource,
  priority: number,
  imminent: boolean,
): ShaderWarmDecision {
  if (!state.spawn) configureShaderWarm();
  if (state.backend === null || state.backend === 'unknown') {
    // Only a definite class is kept: a lost context or a masked string reads
    // as unknown (OFF) and is read again at the next policy call.
    state.backend = readGpuBackend(context).backend;
    state.mode = shaderWarmModeFor(state.setting, state.backend, state.platform);
  }
  if (state.mode !== 'off' && state.workerState === 'idle') startWorker(context);
  const decision = shaderWarmDecision({
    mode: state.mode,
    available: shaderWarmAvailable(),
    armed: state.armed,
    priority,
    imminent,
    liveViewPriority: GPU_WORK_PRIORITY.LIVE_VIEW,
    actionablePriority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
  });
  if (!decision.hold) state.requests.noteBypass(decision.bypass);
  return decision;
}

export function noteShaderWarmBypass(bypass: ShaderWarmBypass): void {
  state.requests.noteBypass(bypass);
}

/** The gate's dry assembly time (one queue unit per piece), for the readout. */
export function noteShaderWarmAssembly(ms: number): void {
  state.requests.noteAssembly(ms);
}

/** Ask the worker for a set of programs; resolves with each one's outcome
 *  once all settled. Already-warm programs resolve at once. */
export function warmShaderPrograms(
  sources: readonly ShaderWarmRequestSource[],
  priority: number,
): Promise<ShaderWarmOutcome[]> {
  return holdShaderPrograms(sources, priority).settled;
}

/** The same request, with the hold's way out: a hold that expires abandons
 *  its ids, and the worker drops the ones nobody else waits for rather than
 *  spend a window slot linking a program the main thread just linked cold
 *  (the worker's link of it would be a cache hit, and still a slot). */
export function holdShaderPrograms(
  sources: readonly ShaderWarmRequestSource[],
  priority: number,
): ShaderWarmHold {
  const { ids, toSend, toPromote } = state.requests.request(sources, priority);
  if (toSend.length > 0) {
    if (state.workerState === 'ready' && state.worker) {
      state.worker.postMessage({ kind: 'warm', sources: toSend });
      syncWorkerPause();
    } else if (state.workerState === 'starting') {
      state.queuedUntilReady.push(...toSend);
    } else {
      for (const source of toSend) state.requests.settle(source.id, 'failed');
    }
  }
  if (toPromote.length > 0) {
    if (state.workerState === 'ready' && state.worker) {
      state.worker.postMessage({ kind: 'reprioritize', updates: toPromote });
    } else if (state.workerState === 'starting') {
      // Not sent yet: the queued copy carries the priority the flush posts.
      for (const update of toPromote) {
        const queued = state.queuedUntilReady.find((source) => source.id === update.id);
        if (queued) queued.priority = update.priority;
      }
    }
  }
  const requests = state.requests;
  return {
    settled: requests.whenSettled(ids),
    abandon: () => {
      // The book this request was written in: a renderer swap starts a new
      // one, and an abandon after that has nothing to drop.
      if (requests !== state.requests) return;
      const dropped = requests.abandon(ids);
      if (dropped.length === 0) return;
      if (state.workerState === 'ready' && state.worker) {
        state.worker.postMessage({ kind: 'cancel', ids: dropped });
      } else if (state.workerState === 'starting') {
        const droppedSet = new Set(dropped);
        state.queuedUntilReady = state.queuedUntilReady.filter((s) => !droppedSet.has(s.id));
        for (const id of dropped) requests.settle(id, 'failed');
      }
    },
  };
}

/** A held gate ended its hold. Consecutive expiries during which the worker
 *  settled NOTHING trip the breaker: the worker is retired and every later
 *  gate takes the unavailable bypass. An expiry the worker answered other
 *  requests through is a slow worker, not a dead one (a cold D3D11 links
 *  in 400 ms a program and a hold waits its turn in the queue), and a slow
 *  worker that keeps delivering is worth more than none. */
export function noteShaderWarmHold(warm: boolean, timedOut: boolean, holdMs: number): void {
  state.requests.noteHeld(warm, timedOut, holdMs);
  state.holds.note(timedOut);
  const holdStartedAtMs = (state.now ?? defaultNow)() - Math.max(0, holdMs);
  const progressed = state.lastWarmedAtMs >= holdStartedAtMs;
  state.consecutiveTimeouts = timedOut && !progressed ? state.consecutiveTimeouts + 1 : 0;
  // Two rules: a worker that answered nothing through three expiries in a
  // row is wedged; one that keeps answering someone while half the recent
  // holds still expire is too slow for the demand, and either costs the
  // player more than no worker.
  const wedged = state.consecutiveTimeouts >= SHADER_WARM_TIMEOUT_BREAKER;
  const tooSlow = state.holds.expired() >= SHADER_WARM_EXPIRED_SHARE_BREAKER;
  if ((wedged || tooSlow) && state.workerState !== 'dead') {
    // Named per rule: a capture must say which one fired (a worker that
    // answered nothing, or one that answered someone while the holds paid the
    // cap), since the fixes differ.
    retireForCause('dead', wedged ? 'hold-timeouts:wedged' : 'hold-timeouts:expired-share');
    retireWorker();
  }
}

/** The game context enabled an extension the sweep did not: from here its
 *  program-cache key differs from the worker's, so everything the worker has
 *  warmed is keyed for a set the game no longer has and everything it would
 *  warm next would be too. Retire it rather than let it link into the void;
 *  the readout names the extension that did it, which is also the fix (add it
 *  to RENDERER_CONTEXT_EXTENSIONS so both contexts enable it up front). */
export function noteShaderWarmExtensionDrift(name: string): void {
  if (state.workerState === 'dead') return;
  retireForCause('dead', `extension-drift:${name}`);
  retireWorker();
}

/** The first reveal: from here the renderer state is settled and a held
 *  link is felt, so the worker is worth asking. */
export function armShaderWarm(): void {
  state.armed = true;
}

/** Tell the worker to pause or resume when the answer changed: paused while
 *  the frame average says so AND nothing is waiting on it (the policy in
 *  shader_warm_client_core.ts); resumed the moment a request arrives. */
function syncWorkerPause(): void {
  if (!state.worker || state.workerState !== 'ready') return;
  const shouldPause = state.pause.paused && state.requests.pendingCount() === 0;
  if (shouldPause === state.workerPaused) return;
  state.workerPaused = shouldPause;
  state.worker.postMessage({ kind: shouldPause ? 'pause' : 'resume' });
}

/** One frame's duration, from the perf monitor: the pause signal. */
export function noteShaderWarmFrameMs(frameMs: number): void {
  if (noteShaderWarmFrame(state.pause, frameMs)) syncWorkerPause();
}

/** Retire the worker and forget everything its life owned: the readout, the
 *  breaker's counts and the request book. A settled entry is never re-sent,
 *  so a book carried across a retirement would answer the next worker's gates
 *  from the dead one's outcomes. The player's setting and `armed` outlive it. */
function retireAndForgetWorker(): void {
  retireWorker();
  state.workerState = 'idle';
  state.refusal = null;
  state.retiredCause = null;
  state.adapter = '';
  state.workerStats = null;
  state.consecutiveTimeouts = 0;
  state.lastWarmedAtMs = Number.NEGATIVE_INFINITY;
  state.holds = createShaderWarmHoldRing();
  state.requests = createShaderWarmRequests();
}

/** The player moved the graphics row. The setting is otherwise read once, at
 *  the first policy call, and `shaderWarm` is not a graphics rebuild key, so
 *  without this a switch to Off kept the worker, its second WebGL2 context and
 *  every gate's hold for the rest of the session. Off retires it here; a
 *  switch back to Auto or On starts a fresh worker at the next policy call,
 *  which is what the option's note promises. */
export function noteShaderWarmSettingChanged(): void {
  // Before the first policy call there is nothing to change: configure reads
  // the store itself.
  if (!state.spawn) return;
  const setting = readShaderWarmSetting(state.search, storedSettingSource());
  if (setting === state.setting) return;
  state.setting = setting;
  state.mode = shaderWarmModeFor(setting, state.backend, state.platform);
  if (state.mode !== 'off') return;
  const cause = state.retiredCause;
  retireAndForgetWorker();
  if (cause) {
    // A retirement for cause outlives the round trip: switching back on must
    // not respawn what the breaker or the extension sweep ruled out, and the
    // readout keeps naming why.
    state.workerState = cause.worker;
    state.refusal = cause.reason;
    state.retiredCause = cause;
    return;
  }
  if (state.platform === 'ios' && setting !== 'off') state.refusal = 'ios-webkit';
}

/** The renderer is going: the worker's context contract was that renderer's,
 *  and so were the programs it warmed (their context goes with the worker),
 *  so the request book starts over with the next renderer. */
export function disposeShaderWarm(): void {
  // The next renderer's context decides the backend again (a rebuild can
  // land on another backend, software included).
  state.backend = null;
  state.mode = shaderWarmModeFor(state.setting, null, state.platform);
  retireAndForgetWorker();
  state.armed = false;
}

export function shaderWarmSnapshot(): ShaderWarmSnapshot {
  return {
    ...state.requests.stats(),
    setting: state.setting,
    mode: state.mode,
    backend: state.backend,
    armed: state.armed,
    worker: state.workerState,
    refusal: state.refusal,
    adapter: state.adapter,
    paused: state.pause.paused,
    frameEmaMs: state.pause.emaMs,
    workerStats: state.workerStats ? { ...state.workerStats } : null,
  };
}

export function resetShaderWarmForTest(deps: ShaderWarmClientDeps = {}): void {
  disposeShaderWarm();
  state.pause = createShaderWarmPauseState();
  state.spawn = null;
  state.schedule = null;
  state.now = null;
  state.pagehideHooked = false;
  configureShaderWarm({ search: '', mobile: false, platform: 'other', ...deps });
}
