import { graphicsPresetLabel } from '../render/gfx';
import { isSoftwareRendererName } from '../render/software_renderer';
import { crowdBucketLabel } from './crowd_bucket';
import { localDevPerfTraceEnabled, type PerfMonitor, type PerfSnapshot } from './perf';
import { analyzePerfSuggestions } from './perf_doctor';
import { jitteredPerfReportDelay } from './perf_report_schedule';
import type { Settings } from './settings';
import type { WorldTelemetry } from './world_telemetry';

declare const __APP_VERSION__: string;
declare const __APP_BUILD_ID__: string;

// Bumped to 2 for the packet 0 report dimensions (zone, crowd, views,
// worst-10s; ruling R6). The server's intIn clamp keeps version-1 clients valid.
const PERF_REPORT_SCHEMA_VERSION = 2;

const FIRST_REPORT_MS = 75_000;
const REPEAT_REPORT_MS = 5 * 60_000;
const DEV_TRACE_FIRST_REPORT_MS = 10_000;
const DEV_TRACE_REPEAT_REPORT_MS = 15_000;
const MIN_REPORT_SECONDS = 20;
const MIN_DEV_TRACE_REPORT_SECONDS = 5;
const MIN_REPORT_FRAMES = 30;
const FETCH_KEEPALIVE_MAX_BYTES = 60 * 1024;
const SESSION_KEY = 'woc_perf_session_id';

export interface PerfReporterOptions {
  perf: PerfMonitor;
  settings: Settings;
  tokenProvider: () => string | null;
  characterIdProvider: () => number | null;
  // Zone identity plus the sim entity count for gameplay sessions (rulings R3,
  // R4); null (or absent, for benchmark harness callers) leaves the payload on
  // the legacy gameplay label with null crowd numerators.
  worldTelemetryProvider?: () => WorldTelemetry | null;
  // True inside the Electron shell, which already forces the discrete GPU
  // (PR #1991), so the perf-doctor 'integrated-gpu' suggestion never fires
  // there (ruling R15). Absent (benchmark harness callers) means false.
  desktopShell?: boolean;
}

export type PerfReporterSkipReason = 'disabled' | 'hidden' | 'not-ready' | 'no-renderer';

export interface PerfReporterStatus {
  enabled: boolean;
  devTrace: boolean;
  sessionId: string;
  startedAt: number;
  nextSendAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  lastSkipReason: PerfReporterSkipReason | null;
  lastSnapshotSeconds: number;
  lastSnapshotFrames: number;
  lastBodyBytes: number;
  sendCount: number;
  successCount: number;
  failCount: number;
}

interface PerfReporterDebug {
  status: PerfReporterStatus;
  sendNow: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    __wocPerfReporter?: PerfReporterDebug;
  }
}

function makeStatus(enabled: boolean, devTrace: boolean, sessionId: string): PerfReporterStatus {
  return {
    enabled,
    devTrace,
    sessionId,
    startedAt: Date.now(),
    nextSendAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastHttpStatus: null,
    lastError: null,
    lastSkipReason: enabled ? null : 'disabled',
    lastSnapshotSeconds: 0,
    lastSnapshotFrames: 0,
    lastBodyBytes: 0,
    sendCount: 0,
    successCount: 0,
    failCount: 0,
  };
}

function exposeDebug(
  status: PerfReporterStatus,
  sendNow: () => void,
  stop: () => void,
): () => void {
  if (!status.devTrace || typeof window === 'undefined') return () => {};
  const debug: PerfReporterDebug = { status, sendNow, stop };
  window.__wocPerfReporter = debug;
  return () => {
    if (window.__wocPerfReporter === debug) delete window.__wocPerfReporter;
  };
}

function textBytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return text.length;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function devTraceLog(status: PerfReporterStatus, level: 'debug' | 'warn', message: string): void {
  if (!status.devTrace) return;
  console[level](`[perf-report] ${message}`);
}

function storedSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function browserFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('firefox/')) return 'firefox';
  if (ua.includes('chrome/') || ua.includes('crios/')) return 'chrome';
  if (ua.includes('safari/')) return 'safari';
  return 'other';
}

function osFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('android')) return 'android';
  if (ua.includes('linux')) return 'linux';
  return 'other';
}

function gpuBucket(renderer: string): string {
  const r = renderer.toLowerCase();
  if (!r) return 'unknown';
  if (isSoftwareRendererName(r)) return 'software';
  if (/apple/.test(r)) {
    const chip = /(m[1-9][a-z0-9 ]*)/i.exec(renderer)?.[1]?.toLowerCase().replace(/\s+/g, '-');
    return chip ? `apple-${chip}` : 'apple';
  }
  if (/intel/.test(r)) {
    if (/iris/.test(r)) return 'intel-iris';
    if (/uhd|hd graphics/.test(r)) return 'intel-uhd';
    return 'intel';
  }
  if (/nvidia|geforce|rtx|gtx/.test(r)) return 'nvidia';
  if (/amd|radeon/.test(r)) return 'amd';
  return (
    renderer
      .slice(0, 48)
      .replace(/[^\w.-]+/g, '-')
      .toLowerCase() || 'other'
  );
}

function viewportBucket(width: number, height: number): string {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short <= 480) return `mobile-${width}x${height}`;
  if (long >= 1800) return `wide-${width}x${height}`;
  if (long >= 1200) return `large-${width}x${height}`;
  return `medium-${width}x${height}`;
}

function scenarioFromUrl(): { source: 'gameplay' | 'benchmark'; zoneOrScenario: string } {
  const params = new URLSearchParams(location.search);
  const scenario = (params.get('perfScenario') ?? params.get('perf_scenario') ?? '')
    .trim()
    .slice(0, 80);
  if (scenario) return { source: 'benchmark', zoneOrScenario: scenario };
  return { source: 'gameplay', zoneOrScenario: 'gameplay' };
}

type RendererPrewarmSnapshot = NonNullable<NonNullable<PerfSnapshot['renderer']>['prewarm']>;

function rendererPrewarmSummary(
  prewarm: RendererPrewarmSnapshot | null,
): Record<string, unknown> | null {
  if (!prewarm) return null;
  return {
    elapsedMs: prewarm.elapsedMs,
    maxMs: prewarm.maxMs,
    remainingMs: prewarm.remainingMs,
    budgetUsedRatio: prewarm.budgetUsedRatio,
    timedOut: prewarm.timedOut,
    createdViews: prewarm.createdViews,
    candidateViews: prewarm.candidateViews,
    renderPasses: prewarm.renderPasses,
    programsDelta: prewarm.programsAfter - prewarm.programsBefore,
    texturesDelta: prewarm.texturesAfter - prewarm.texturesBefore,
    compileMode: prewarm.compileMode,
    compileMs: prewarm.compileMs,
    compileTimedOut: prewarm.compileTimedOut,
    manifestPlanned: prewarm.manifestPlanned,
    manifestCompleted: prewarm.manifestCompleted,
    manifestTimedOut: prewarm.manifestTimedOut,
    manifestFailed: prewarm.manifestFailed,
    timedOutEntryIds: prewarm.timedOutEntryIds,
    failedEntryIds: prewarm.failedEntryIds,
    entries: prewarm.manifestEntries.map((entry) => ({
      id: entry.id,
      category: entry.category,
      required: entry.required,
      status: entry.status,
      elapsedMs: entry.elapsedMs,
      remainingMsAfter: entry.remainingMsAfter,
      programDelta: entry.programDelta,
      textureDelta: entry.textureDelta,
      detail: entry.detail,
    })),
  };
}

function payloadFromSnapshot(
  snapshot: PerfSnapshot,
  settings: Settings,
  sessionId: string,
  characterId: number | null,
  worldTelemetry: WorldTelemetry | null = null,
  desktopShell = false,
): Record<string, unknown> | null {
  const renderer = snapshot.renderer;
  if (!renderer) return null;
  const memory = snapshot.browser.memory;
  const longTasks = snapshot.browser.longTasks;
  const device = snapshot.device;
  const viewportWidth = Math.max(1, Math.round(window.innerWidth));
  const viewportHeight = Math.max(1, Math.round(window.innerHeight));
  const scenario = scenarioFromUrl();
  // The benchmark ?perfScenario label keeps priority; gameplay sessions carry
  // the instance-aware zone id from the provider (rulings R3, R4).
  const zoneOrScenario =
    scenario.source === 'benchmark'
      ? scenario.zoneOrScenario
      : (worldTelemetry?.zoneId ?? scenario.zoneOrScenario);
  // Crowd is bucketed on the renderer's activeViews (draw-band scoped, ruling
  // R3); the raw counts ship beside it. lastFrame is null-guarded: the first
  // report can land before a rendered frame.
  const activeViews = renderer.lastFrame?.activeViews ?? null;
  const visibleViews = renderer.lastFrame?.visibleViews ?? null;
  // CLIENT-computed perf-doctor suggestion ids (ruling R14): the analyzer runs
  // over this same snapshot, so the fleet dimension and the player nudge toast
  // agree on the machine-local diagnosis. Ids only; titles/bodies stay local.
  const suggestionIds = analyzePerfSuggestions(snapshot, location.search, { desktopShell }).map(
    (suggestion) => suggestion.id,
  );
  return {
    schemaVersion: PERF_REPORT_SCHEMA_VERSION,
    releaseVersion: __APP_VERSION__,
    buildId: __APP_BUILD_ID__,
    sessionId,
    characterId,
    graphicsPreset: graphicsPresetLabel(settings.get('graphicsPreset')),
    graphicsConfigVersion: renderer.graphicsConfigVersion,
    gfxTier: renderer.tier,
    autoGovernor: renderer.autoGovernor,
    targetFps: renderer.budget.targetFps,
    renderScale: renderer.renderScale,
    effectiveRenderScale: renderer.effectiveRenderScale,
    fpsAvg: snapshot.fps,
    frameP95Ms: snapshot.frameMs.p95,
    frameP99Ms: snapshot.frameMs.p99,
    longFrameCount: snapshot.frameMs.long50,
    rendererCalls: renderer.calls,
    rendererTriangles: renderer.triangles,
    rendererTextures: renderer.textures,
    rendererPrograms: renderer.programs,
    contextLostCount: renderer.contextLost,
    longTaskCount: longTasks.count,
    longTaskP95Ms: longTasks.p95,
    memoryUsedMb: memory?.usedMB ?? null,
    memoryLimitMb: memory?.limitMB ?? null,
    dpr: device.dpr,
    viewportWidth,
    viewportHeight,
    viewportBucket: viewportBucket(viewportWidth, viewportHeight),
    deviceMemory: device.deviceMemory,
    hardwareConcurrency: device.hardwareConcurrency,
    mobileTouch: device.mobileTouch,
    browserFamily: browserFamily(device.userAgent),
    osFamily: osFamily(device.userAgent),
    glVendor: renderer.glVendor,
    glRenderer: renderer.glRenderer,
    glRendererBucket: gpuBucket(renderer.glRenderer),
    source: scenario.source,
    zoneOrScenario,
    simEntities: worldTelemetry?.simEntities ?? null,
    activeViews,
    visibleViews,
    crowdBucket: crowdBucketLabel(activeViews),
    worst10sFrameP95Ms: snapshot.windows.worst10s?.frameMs.p95 ?? null,
    suggestionIds,
    rawSummary: {
      graphicsConfigVersion: renderer.graphicsConfigVersion,
      seconds: snapshot.seconds,
      frames: snapshot.frames,
      windows: snapshot.windows,
      mainMs: snapshot.mainMs,
      rendererPhaseMs: renderer.phaseMs,
      rendererFoliage: renderer.foliage,
      rendererBudget: renderer.renderBudget,
      rendererQualityBuckets: renderer.qualityBuckets,
      rendererDiagnostics: renderer.renderDiagnostics,
      rendererPrewarmSummary: rendererPrewarmSummary(renderer.prewarm),
      rendererPrewarm: renderer.prewarm,
      assets: {
        preload: snapshot.assets.preload,
        byType: snapshot.assets.byType,
      },
      input: snapshot.input,
      hud: snapshot.hud,
      netPipeline: snapshot.netPipeline,
      heapSawtooth: snapshot.heapSawtooth,
      // The two top-level longtask fields (longTaskCount, longTaskP95Ms) cannot
      // corroborate a rare multi-second stall: a single event never moves a
      // p95. These four ride here (issue #2479) rather than as new top-level
      // columns, so storing them needs no DDL; the server bounds them on
      // ingest (server/perf_report.ts).
      browser: {
        longTasks: {
          totalMs: longTasks.totalMs,
          avg: longTasks.avg,
          max: longTasks.max,
          lastAge: longTasks.lastAge,
        },
      },
      ...(snapshot.devTrace ? { devTrace: snapshot.devTrace } : {}),
    },
  };
}

export function startPerfReporter(options: PerfReporterOptions): () => void {
  const params = new URLSearchParams(location.search);
  const devTrace = localDevPerfTraceEnabled();
  if (params.get('perfReport') === '0' || params.get('perf_report') === '0') {
    const status = makeStatus(false, devTrace, '');
    const cleanupDebug = exposeDebug(
      status,
      () => {},
      () => {},
    );
    devTraceLog(status, 'debug', 'disabled by URL parameter');
    return cleanupDebug;
  }

  const sessionId = storedSessionId();
  const status = makeStatus(true, devTrace, sessionId);
  let stopped = false;
  let timer: number | null = null;
  let lastFinalFlushAt = 0;
  let reportSequence = 0;
  let cleanupDebug = (): void => {};

  const cadenceDelay = (baseMs: number): number =>
    devTrace ? baseMs : jitteredPerfReportDelay(baseMs, sessionId, reportSequence++);

  const schedule = (delay: number): void => {
    if (stopped) return;
    status.nextSendAt = Date.now() + delay;
    timer = window.setTimeout(() => send(), delay);
  };

  function skip(reason: PerfReporterSkipReason, delay: number | null): void {
    status.lastSkipReason = reason;
    status.nextSendAt = null;
    devTraceLog(status, 'debug', `skipped: ${reason}`);
    if (delay !== null) schedule(delay);
  }

  function send(sendOptions: { allowHidden?: boolean; final?: boolean } = {}): void {
    timer = null;
    if (stopped) return;
    if (!sendOptions.allowHidden && document.visibilityState !== 'visible') {
      skip('hidden', cadenceDelay(REPEAT_REPORT_MS));
      return;
    }
    const snapshot = options.perf.report();
    status.lastSnapshotSeconds = snapshot.seconds;
    status.lastSnapshotFrames = snapshot.frames;
    const minSeconds = devTrace ? MIN_DEV_TRACE_REPORT_SECONDS : MIN_REPORT_SECONDS;
    if (snapshot.seconds < minSeconds || snapshot.frames < MIN_REPORT_FRAMES) {
      skip('not-ready', sendOptions.final ? null : 15_000);
      return;
    }
    const body = payloadFromSnapshot(
      snapshot,
      options.settings,
      sessionId,
      options.characterIdProvider(),
      options.worldTelemetryProvider?.() ?? null,
      options.desktopShell ?? false,
    );
    if (!body) {
      skip('no-renderer', sendOptions.final ? null : cadenceDelay(REPEAT_REPORT_MS));
      return;
    }
    const token = options.tokenProvider();
    const bodyText = JSON.stringify(body);
    status.lastAttemptAt = Date.now();
    status.lastSkipReason = null;
    status.lastError = null;
    status.lastHttpStatus = null;
    status.lastBodyBytes = textBytes(bodyText);
    status.sendCount++;
    const useKeepalive = Boolean(
      sendOptions.final && status.lastBodyBytes <= FETCH_KEEPALIVE_MAX_BYTES,
    );
    if (sendOptions.final && !useKeepalive) {
      devTraceLog(
        status,
        'debug',
        `final post too large for keepalive: ${status.lastBodyBytes} bytes`,
      );
    }
    void fetch('/api/perf-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: bodyText,
      keepalive: useKeepalive,
    })
      .then(async (res) => {
        status.lastHttpStatus = res.status;
        if (!res.ok) {
          const responseText = (await res.text().catch(() => '')).slice(0, 160);
          status.failCount++;
          status.lastError = responseText
            ? `HTTP ${res.status}: ${responseText}`
            : `HTTP ${res.status}`;
          devTraceLog(status, 'warn', `post failed: ${status.lastError}`);
          return;
        }
        status.successCount++;
        status.lastSuccessAt = Date.now();
        status.lastError = null;
        // Worst-per-report-interval semantics (ruling R5): the retained worst
        // 10 s window resets only once its report is stored, so a failed post
        // carries the storm into the retry instead of losing it.
        options.perf.drainWorstWindow();
        devTraceLog(status, 'debug', `posted ${status.lastBodyBytes} bytes`);
      })
      .catch((err: unknown) => {
        status.failCount++;
        status.lastError = errorText(err);
        devTraceLog(status, 'warn', `post failed: ${status.lastError}`);
      });
    if (!sendOptions.final) {
      schedule(devTrace ? DEV_TRACE_REPEAT_REPORT_MS : cadenceDelay(REPEAT_REPORT_MS));
    }
  }

  function sendNow(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    send();
  }

  function flushFinal(): void {
    const now = Date.now();
    if (now - lastFinalFlushAt < 2000) return;
    lastFinalFlushAt = now;
    send({ allowHidden: true, final: true });
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') flushFinal();
  }

  function stop(): void {
    stopped = true;
    status.enabled = false;
    status.nextSendAt = null;
    if (timer !== null) window.clearTimeout(timer);
    window.removeEventListener('pagehide', flushFinal);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    cleanupDebug();
  }

  cleanupDebug = exposeDebug(status, sendNow, stop);
  window.addEventListener('pagehide', flushFinal);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  schedule(devTrace ? DEV_TRACE_FIRST_REPORT_MS : cadenceDelay(FIRST_REPORT_MS));
  return stop;
}

export const perfReporterInternalsForTest = {
  browserFamily,
  osFamily,
  gpuBucket,
  viewportBucket,
  payloadFromSnapshot,
  PERF_REPORT_SCHEMA_VERSION,
};
