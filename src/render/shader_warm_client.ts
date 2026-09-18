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
// the pre-worker path for the rest of the renderer's life: no gate waits on a
// worker that has stopped delivering. A worker that cannot serve its oldest
// hold inside what is left of that hold's own cap (the rule that fires first,
// before any hold has paid) RELEASES that burst's holds and keeps warming;
// only a verdict repeated over bursts retires it.
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
  createShaderWarmOutstandingHolds,
  createShaderWarmPauseState,
  createShaderWarmRequests,
  noteShaderWarmFrame,
  readShaderWarmReadyDeadline,
  readShaderWarmSetting,
  SHADER_WARM_AB_REFUSAL,
  SHADER_WARM_EXPIRED_SHARE_BREAKER,
  SHADER_WARM_RELEASE_BREAKER,
  SHADER_WARM_TIMEOUT_BREAKER,
  type ShaderWarmAbArm,
  type ShaderWarmBypass,
  type ShaderWarmDecision,
  type ShaderWarmMode,
  type ShaderWarmOutcome,
  type ShaderWarmPlatform,
  type ShaderWarmRequestSource,
  type ShaderWarmRequestStats,
  type ShaderWarmRequests,
  type ShaderWarmSetting,
  shaderWarmAbArmFor,
  shaderWarmCannotServe,
  shaderWarmDecision,
  shaderWarmLinkEvidence,
  shaderWarmModeFor,
} from './shader_warm_client_core';
import type { ShaderWarmSource, ShaderWarmWorkerMessage } from './shader_warm_protocol';
import {
  SHADER_WARM_LINK_DEADLINE_MS,
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
  /** Wall time during which at least one gate was held. */
  holdWallMs: number;
  /** Cannot-serve verdicts that released a burst's held gates. */
  releases: number;
  /** A release happened and the worker still owes requests: no gate holds. */
  standingDown: boolean;
  /** The D3D11 experiment's arm for this profile; null where no draw ran. */
  abArm: ShaderWarmAbArm | null;
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
  /** Where the profile's A/B arm is kept; the page default is localStorage. */
  abStore?: ShaderWarmAbStore;
  /** The draw for a profile with no arm yet. */
  random?: () => number;
}

/** The browser profile's slot for the A/B arm. Either call may throw (storage
 *  blocked, private mode): the client then draws once per page load. */
export interface ShaderWarmAbStore {
  get(): string | null;
  set(value: string): void;
}

const SHADER_WARM_AB_STORAGE_KEY = 'woc.shaderWarm.abArm';

/** How long a worker the gates stand down for may stay silent before it is
 *  retired. Not a tuned timer: the worker answers every link it runs by its
 *  own deadline and posts stats while it works, so two deadlines without a
 *  single message mean it is not ticking at all, and standing down would
 *  otherwise keep its context for the page with no hold left to judge it. */
export const SHADER_WARM_SILENT_STANDDOWN_MS = 2 * SHADER_WARM_LINK_DEADLINE_MS;

/** A request a hold can give up on: `settled` resolves with each program's
 *  outcome; `abandon` tells the worker to drop what nobody else waits for. */
export interface ShaderWarmHold {
  settled: Promise<ShaderWarmOutcome[]>;
  abandon(): void;
  /** A cannot-serve release ended this hold (or refused it while standing
   *  down): its caller passes this to noteShaderWarmHold, so the expiry rules
   *  never read it as evidence against the worker. */
  wasReleased(): boolean;
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
  /** Held gates in a row the worker answered nothing through, whether each
   *  expired on its cap or ended on the worker's own failure: the breaker's
   *  count. */
  consecutiveUnanswered: 0,
  /** When the worker last answered warmed, on the client's clock. */
  lastWarmedAtMs: Number.NEGATIVE_INFINITY,
  /** When the worker last gave up a link at its own deadline, on the
   *  client's clock: the other way a hold pays for a worker that answers
   *  nothing (a fast rejection of a text says nothing about the worker). */
  lastDeadlineAtMs: Number.NEGATIVE_INFINITY,
  /** The last few holds, for the breaker's expired-share rule. */
  holds: createShaderWarmHoldRing(),
  /** The holds still waiting, for the cannot-serve rule. */
  outstanding: createShaderWarmOutstandingHolds(),
  /** Cannot-serve verdicts this worker's life; the last one retires it. */
  releases: 0,
  /** Set by a release, cleared once the worker owes nothing: no gate holds. */
  standingDown: false,
  /** When the gates last started standing down, and when the worker last
   *  posted anything, on the client's clock: the silence bound reads both. */
  standingDownSinceMs: Number.NEGATIVE_INFINITY,
  lastWorkerMessageAtMs: Number.NEGATIVE_INFINITY,
  /** Carried over retired workers' books, so the beacon's A/B cost terms
   *  cover the page like the long-task total they are weighed against. */
  carriedHoldWallMs: 0,
  carriedReleases: 0,
  abArm: null as ShaderWarmAbArm | null,
  /** The arm this page load drew, kept for the page's life: a profile whose
   *  storage refuses must not draw again at every renderer rebuild. */
  pageArm: null as ShaderWarmAbArm | null,
  abStore: null as ShaderWarmAbStore | null,
  random: null as (() => number) | null,
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

function defaultAbStore(): ShaderWarmAbStore {
  // The property access itself throws where site data is blocked, so it is
  // made inside the calls resolveMode already guards.
  const storage = (): Storage | undefined =>
    (globalThis as { localStorage?: Storage }).localStorage;
  return {
    get: () => storage()?.getItem(SHADER_WARM_AB_STORAGE_KEY) ?? null,
    set: (value) => storage()?.setItem(SHADER_WARM_AB_STORAGE_KEY, value),
  };
}

function clock(): number {
  return (state.now ?? defaultNow)();
}

/** The mode in force for the setting and backend known now, through the A/B
 *  draw: a profile in the `off` arm resolves `auto` to off and names the arm
 *  on the refusal, unless a real cause already owns it. */
function resolveMode(): void {
  // Storage is read only where a draw can happen: a masked renderer string
  // reads as unknown at every policy call, and that is every gate.
  const drawable =
    state.setting === 'auto' && shaderWarmModeFor('auto', state.backend, state.platform) !== 'off';
  let stored: string | null = null;
  if (drawable) {
    try {
      stored = state.abStore?.get() ?? null;
    } catch {
      stored = null;
    }
    if (stored !== 'on' && stored !== 'off') stored = state.pageArm;
  }
  const draw = shaderWarmAbArmFor({
    setting: state.setting,
    backend: state.backend,
    platform: state.platform,
    stored,
    random: state.random ?? Math.random,
  });
  if (draw.store) {
    try {
      state.abStore?.set(draw.store);
    } catch {
      // Blocked storage: this page load keeps its draw, the next one draws again.
    }
  }
  state.abArm = draw.arm;
  if (draw.arm) state.pageArm = draw.arm;
  state.mode =
    draw.arm === 'off' ? 'off' : shaderWarmModeFor(state.setting, state.backend, state.platform);
  // Between a renderer's dispose and the next context read the backend is
  // unknown and no draw applies, but the page's off arm still names the
  // session on the typed refusal column.
  const backendPending = state.backend === null || state.backend === 'unknown';
  const offArm =
    draw.arm === 'off' ||
    (draw.arm === null && backendPending && state.setting === 'auto' && state.pageArm === 'off');
  if (offArm) {
    if (!state.retiredCause) state.refusal = SHADER_WARM_AB_REFUSAL;
  } else if (state.refusal === SHADER_WARM_AB_REFUSAL) {
    state.refusal = null;
  }
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
  state.abStore = deps.abStore ?? defaultAbStore();
  state.random = deps.random ?? Math.random;
  resolveMode();
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

/** Whether the player's shader warm-up choice can do anything on this host.
 *  False where the mode resolver refuses the platform whatever the setting is
 *  (phone-class WebKit, where a second WebGL2 context is a per-process memory
 *  ceiling risk), so a chrome that offers the row asks the RESOLVER rather
 *  than re-deriving the platform rule of its own: one rule, one place. */
export function shaderWarmChoiceAvailable(
  platform: ShaderWarmPlatform = defaultPlatform(),
): boolean {
  return shaderWarmModeFor('all', null, platform) !== 'off';
}

function onWorkerMessage(event: MessageEvent<ShaderWarmWorkerMessage>): void {
  const message = event.data;
  state.lastWorkerMessageAtMs = clock();
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
      state.lastWarmedAtMs = clock();
      // A link time counts only for a request that was waiting for it.
      if (state.requests.settle(message.id, 'warmed')) state.requests.noteLink(message.linkMs);
      if (judgeCannotServe() === 'retired') break;
      resumeHoldsIfDrained();
      syncWorkerPause();
      break;
    case 'failed': {
      const settled = state.requests.settle(message.id, 'failed', message.reason === 'cancelled');
      if (message.reason === 'link-failed' || message.reason === 'link-deadline') {
        state.requests.noteFailedProgram(message.id, message.reason);
      }
      if (message.reason === 'link-deadline') {
        state.lastDeadlineAtMs = clock();
        // A give-up at the worker's deadline is link evidence (a lower
        // bound), counted like a link time: once per request the book still
        // had open (an abandoned in-flight link runs to its deadline too,
        // and its wall is evidence all the same).
        if (settled && message.linkMs !== undefined)
          state.requests.noteCensoredLink(message.linkMs);
      }
      if (judgeCannotServe() === 'retired') break;
      resumeHoldsIfDrained();
      syncWorkerPause();
      break;
    }
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
  state.outstanding.clear(clock());
  state.standingDown = false;
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
    resolveMode();
  }
  if (state.mode !== 'off' && state.workerState === 'idle') startWorker(context);
  retireIfSilentWhileStandingDown();
  const decision = shaderWarmDecision({
    mode: state.mode,
    available: shaderWarmAvailable(),
    armed: state.armed,
    priority,
    imminent,
    standingDown: state.standingDown,
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
 *  (the worker's link of it would be a cache hit, and still a slot).
 *
 *  `capMs` is the caller's own hold cap (the gates' and the lanes' half
 *  watchdog): the client never imports it, it is told, and it is what the
 *  cannot-serve rule measures the worker against. A request with no cap
 *  (warmShaderPrograms, which nothing holds a link for) is not a hold and
 *  never reaches that rule.
 *
 *  `startedAtMs` is when the CALLER's cap clock started, for a caller whose
 *  request and cap do not begin on the same instant (the lanes ask inside a
 *  queue unit and start their cap when that unit's promise settles): read
 *  from the request instead, the rule would price a cap that had already run
 *  down and give up on a worker that was still inside it. Absent, the request
 *  instant is the cap's. */
export function holdShaderPrograms(
  sources: readonly ShaderWarmRequestSource[],
  priority: number,
  capMs?: number,
  startedAtMs?: number,
): ShaderWarmHold {
  const capped = capMs !== undefined && Number.isFinite(capMs) && capMs > 0;
  if (capped && state.standingDown && sources.length > 0) {
    // A gate decides before its assembly unit runs, so a hold can be asked
    // after a release even though the decision said hold. Opening it would
    // queue behind the backlog the release gave up on and let the same
    // burst release again: it is refused, sends nothing, and ends at once.
    return {
      settled: Promise.resolve(sources.map((): ShaderWarmOutcome => 'failed')),
      abandon: () => {},
      wasReleased: () => true,
    };
  }
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
  const book = state.outstanding;
  const settled = requests.whenSettled(ids);
  let endByRelease: ((outcomes: ShaderWarmOutcome[]) => void) | null = null;
  let released = false;
  let abandoned = false;
  let outstanding: ReturnType<typeof book.open> | null = null;
  const abandon = (): void => {
    if (abandoned) return;
    abandoned = true;
    if (outstanding) book.close(outstanding, clock());
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
  };
  outstanding =
    capped && ids.length > 0
      ? book.open(
          {
            startedAtMs:
              startedAtMs !== undefined && Number.isFinite(startedAtMs) ? startedAtMs : clock(),
            capMs,
            priority,
            highestId: Math.max(...ids),
            // A release ends the hold now with what is warm so far and gives
            // its requests back, the way an expiry does: the game context links
            // those programs now, and the worker linking the same text again
            // would compete for the driver the verdict found too busy (a
            // program another request still waits on is kept). A hold whose
            // last request settled in the very message that released it counts
            // as released too: it ended the same way either path.
            release: () => {
              released = true;
              endByRelease?.(
                ids.map((id) => (requests.outcomeOf(id) === 'warmed' ? 'warmed' : 'failed')),
              );
              abandon();
            },
          },
          clock(),
        )
      : null;
  if (outstanding) settled.then(() => book.close(outstanding, clock()));
  const ended = outstanding
    ? Promise.race([
        settled,
        new Promise<ShaderWarmOutcome[]>((resolve) => {
          endByRelease = resolve;
        }),
      ])
    : settled;
  return { settled: ended, wasReleased: () => released, abandon };
}

/** A worker the gates stand down for that has posted nothing for
 *  `SHADER_WARM_SILENT_STANDDOWN_MS` is not ticking: retire it. Read from the
 *  frame hook and the policy call, signals the worker cannot withhold. */
function retireIfSilentWhileStandingDown(): boolean {
  if (!state.standingDown || state.workerState !== 'ready') return false;
  const quietSinceMs = Math.max(state.standingDownSinceMs, state.lastWorkerMessageAtMs);
  if (clock() - quietSinceMs < SHADER_WARM_SILENT_STANDDOWN_MS) return false;
  retireForCause('dead', 'standing-down:silent');
  retireWorker();
  return true;
}

/** No gate holds after a release until the worker owes nothing: the burst the
 *  verdict priced is still being served, and a new hold would queue behind it. */
function resumeHoldsIfDrained(): void {
  if (state.standingDown && state.requests.pendingCount() === 0) state.standingDown = false;
}

/** The breaker's third rule, read on every settle and every hold note: can
 *  this worker still serve the hold that has waited longest, inside what is
 *  left of the cap that hold's caller owns? The queue ahead of it, at the
 *  mean wall this worker's links have actually cost, spread over the links it
 *  runs at once, against the remaining cap. Ahead is by the worker's own
 *  order, PRIORITY first and arrival second: a live view held behind a
 *  catalog's backlog is served before all of it and is not charged for it,
 *  and a cosmetic prewarm behind a burst of live views is. It is the FIRST
 *  rule to fire, because the other two only speak once holds have paid whole
 *  caps: on the RTX 4070 laptop (about 560 ms a link) this retires seconds
 *  earlier with no hold expired, while on a machine whose links are ten times
 *  shorter the same arithmetic never trips.
 *
 *  Nothing is judged before the worker's first stats message: the window is
 *  the divisor, and reading a worker that links four at a time as one at a
 *  time condemns it four times too fast. That message comes on the worker's
 *  own poll, so it is also a few hundred milliseconds stale once it lands.
 *
 *  A verdict prices ONE burst, so it releases that burst's held gates (they
 *  link on the game context now, which is what the rule is for) and keeps
 *  the worker warming: read off a window that had just halved, it condemned a
 *  worker that warmed 174 programs on the next launch (RTX 3060, 2026-09-12).
 *  The release empties the outstanding set and no gate holds until the worker
 *  owes nothing, so the next verdict can only come from a later burst; the
 *  `SHADER_WARM_RELEASE_BREAKER`th retires it. */
function judgeCannotServe(): 'released' | 'retired' | null {
  if (state.workerState !== 'ready') return null;
  const stats = state.workerStats;
  if (!stats) return null;
  const oldest = state.outstanding.oldest();
  if (!oldest) return null;
  const { links, censoredLinks } = state.requests.stats();
  const inputs = {
    linkCount: links.count,
    linkSumMs: links.sumMs,
    censoredCount: censoredLinks.count,
    censoredSumMs: censoredLinks.sumMs,
    windowLinks: stats.windowLinks,
    aheadOfOldest: state.requests.unsettledAhead(oldest.priority, oldest.highestId),
    capMs: oldest.capMs,
    waitedMs: clock() - oldest.startedAtMs,
  };
  if (!shaderWarmCannotServe(inputs)) return null;
  state.releases++;
  if (state.releases >= SHADER_WARM_RELEASE_BREAKER) {
    // Named by the evidence that spoke: a verdict on deadline give-ups alone
    // is its own arm, and the fleet must be able to tell it from the baseline.
    const censored = shaderWarmLinkEvidence(inputs)?.source === 'censored';
    retireForCause('dead', censored ? 'cannot-serve:hold-cap:censored' : 'cannot-serve:hold-cap');
    retireWorker();
    return 'retired';
  }
  const now = clock();
  state.standingDown = true;
  state.standingDownSinceMs = now;
  for (const hold of state.outstanding.releaseAll(now)) hold.release?.();
  return 'released';
}

/** A held gate ended its hold. Consecutive holds during which the worker
 *  settled NOTHING trip the breaker: the worker is retired and every later
 *  gate takes the unavailable bypass. A hold counts whether it expired on
 *  its cap or ended on the worker giving a link up at its own deadline: the
 *  deadline (`SHADER_WARM_LINK_DEADLINE_MS`) is shorter than the hold cap
 *  (`SHADER_WARM_HOLD_CAP_MS`, the lanes' too), so on a machine whose links
 *  never settle a single-program hold never expires, it fails at the
 *  deadline, and a rule that counted expiries alone never fired while every
 *  hold paid that deadline (the RTX 4060 Ti capture). A hold that ended on a
 *  FAST failure (a text the worker's context rejects, or a program already
 *  failed once that a later root shares) paid nothing and says nothing
 *  about the worker's speed, so it neither counts nor names the cause. An
 *  expiry the worker answered other requests through is a slow worker, not
 *  a dead one (a cold D3D11 links in 400 ms a program and a hold waits its
 *  turn in the queue), and a slow worker that keeps delivering is worth
 *  more than none. A hold that ended before the worker was ready settled on
 *  the client's side and says nothing about it; the ready deadline owns
 *  that worker. A hold a cannot-serve release ended (`released`, from the
 *  hold's own `wasReleased`) is not evidence for the other rules either: it
 *  is counted as released and goes no further, or a release with a link
 *  deadline inside it would feed the wedged streak and retire the worker the
 *  release kept. `progressed` and `paidDeadline` read the worker's LAST warm
 *  and LAST deadline against this hold's start, not this hold's own programs:
 *  a warm for someone else means the worker is alive, and a deadline anywhere
 *  means its links are not settling, which is the evidence either way. */
export function noteShaderWarmHold(
  warm: boolean,
  timedOut: boolean,
  holdMs: number,
  released = false,
): void {
  const holdStartedAtMs = clock() - Math.max(0, holdMs);
  const releasedHold = released && !warm;
  state.requests.noteHeld(warm, timedOut, holdMs, releasedHold);
  if (releasedHold) return;
  state.holds.note(timedOut);
  const progressed = state.lastWarmedAtMs >= holdStartedAtMs;
  const paidDeadline = state.lastDeadlineAtMs >= holdStartedAtMs;
  const unanswered =
    !warm && !progressed && (timedOut || paidDeadline) && state.workerState === 'ready';
  state.consecutiveUnanswered = unanswered ? state.consecutiveUnanswered + 1 : 0;
  // The cannot-serve rule first: what it sees, the two rules below only learn
  // once the holds it is about have paid their caps. A release falls through
  // on purpose: it exempts the holds IT ends early, not the evidence this hold
  // and the ones before it already left, so a third unanswered expiry that
  // also trips a release still retires the worker as wedged.
  if (judgeCannotServe() === 'retired') return;
  // Two rules: a worker that answered nothing through three holds in a row
  // is wedged; one that keeps answering someone while half the recent holds
  // still expire is too slow for the demand, and either costs the player
  // more than no worker.
  const wedged = state.consecutiveUnanswered >= SHADER_WARM_TIMEOUT_BREAKER;
  const tooSlow = state.holds.expired() >= SHADER_WARM_EXPIRED_SHARE_BREAKER;
  if ((wedged || tooSlow) && state.workerState !== 'dead') {
    // Named per rule, and for the wedged rule by how THIS hold ended (the
    // streak requires it to be unanswered, so it is the last of them): a
    // capture must say which one fired (a worker that answered nothing while
    // the holds paid their cap, one that answered nothing while they paid its
    // own deadline, or one that answered someone while the holds paid the
    // cap), since the fixes differ.
    const cause = wedged
      ? timedOut
        ? 'hold-timeouts:wedged'
        : 'hold-failures:wedged'
      : 'hold-timeouts:expired-share';
    retireForCause('dead', cause);
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
  // The off arm never ran a worker: there is nothing to retire, and the arm
  // token must survive to the report that carries it.
  if (state.workerState === 'dead' || state.abArm === 'off') return;
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
  if (retireIfSilentWhileStandingDown()) return;
  if (noteShaderWarmFrame(state.pause, frameMs)) syncWorkerPause();
}

/** Retire the worker and forget everything its life owned: the readout, the
 *  breaker's counts and the request book. A settled entry is never re-sent,
 *  so a book carried across a retirement would answer the next worker's gates
 *  from the dead one's outcomes. The player's setting and `armed` outlive it. */
function retireAndForgetWorker(): void {
  retireWorker();
  state.carriedHoldWallMs += state.outstanding.wallMs(clock());
  state.carriedReleases += state.releases;
  state.workerState = 'idle';
  state.refusal = null;
  state.retiredCause = null;
  state.adapter = '';
  state.workerStats = null;
  state.consecutiveUnanswered = 0;
  state.lastWarmedAtMs = Number.NEGATIVE_INFINITY;
  state.lastDeadlineAtMs = Number.NEGATIVE_INFINITY;
  state.releases = 0;
  state.standingDown = false;
  state.standingDownSinceMs = Number.NEGATIVE_INFINITY;
  state.lastWorkerMessageAtMs = Number.NEGATIVE_INFINITY;
  state.holds = createShaderWarmHoldRing();
  state.outstanding = createShaderWarmOutstandingHolds();
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
  resolveMode();
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
  if (state.abArm === 'off') state.refusal = SHADER_WARM_AB_REFUSAL;
  if (state.platform === 'ios' && setting !== 'off') state.refusal = 'ios-webkit';
}

/** The renderer is going: the worker's context contract was that renderer's,
 *  and so were the programs it warmed (their context goes with the worker),
 *  so the request book starts over with the next renderer. */
export function disposeShaderWarm(): void {
  // The next renderer's context decides the backend again (a rebuild can
  // land on another backend, software included).
  state.backend = null;
  retireAndForgetWorker();
  resolveMode();
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
    holdWallMs: state.carriedHoldWallMs + state.outstanding.wallMs(clock()),
    releases: state.carriedReleases + state.releases,
    standingDown: state.standingDown,
    // Between a renderer's dispose and the next context read the backend is
    // unknown and no draw applies; the page's arm still names the session.
    abArm:
      state.abArm ??
      (state.setting === 'auto' && (state.backend === null || state.backend === 'unknown')
        ? state.pageArm
        : null),
    workerStats: state.workerStats ? { ...state.workerStats } : null,
  };
}

export function resetShaderWarmForTest(deps: ShaderWarmClientDeps = {}): void {
  disposeShaderWarm();
  state.carriedHoldWallMs = 0;
  state.carriedReleases = 0;
  state.pageArm = null;
  state.pause = createShaderWarmPauseState();
  state.spawn = null;
  state.schedule = null;
  state.now = null;
  state.pagehideHooked = false;
  // Tests get a profile store of their own and the `on` arm unless they ask:
  // a suite must never share a real storage slot, nor draw at random.
  let testArm: string | null = null;
  configureShaderWarm({
    search: '',
    mobile: false,
    platform: 'other',
    abStore: {
      get: () => testArm,
      set: (value) => {
        testArm = value;
      },
    },
    random: () => 0.75,
    ...deps,
  });
}
