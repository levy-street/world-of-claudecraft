import { graphicsPresetLabel } from '../render/gfx';
import { localDevPerfTraceEnabled, type PerfMonitor, type PerfSnapshot } from './perf';
import type { Settings } from './settings';

declare const __APP_VERSION__: string;
declare const __APP_BUILD_ID__: string;

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

function exposeDebug(status: PerfReporterStatus, sendNow: () => void, stop: () => void): () => void {
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
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
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
  if (/swiftshader|llvmpipe|software/.test(r)) return 'software';
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
  return renderer.slice(0, 48).replace(/[^\w.-]+/g, '-').toLowerCase() || 'other';
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
  const scenario = (params.get('perfScenario') ?? params.get('perf_scenario') ?? '').trim().slice(0, 80);
  if (scenario) return { source: 'benchmark', zoneOrScenario: scenario };
  return { source: 'gameplay', zoneOrScenario: 'gameplay' };
}

type RendererPrewarmSnapshot = NonNullable<NonNullable<PerfSnapshot['renderer']>['prewarm']>;

function rendererPrewarmSummary(prewarm: RendererPrewarmSnapshot | null): Record<string, unknown> | null {
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
): Record<string, unknown> | null {
  const renderer = snapshot.renderer;
  if (!renderer) return null;
  const memory = snapshot.browser.memory;
  const longTasks = snapshot.browser.longTasks;
  const device = snapshot.device;
  const viewportWidth = Math.max(1, Math.round(window.innerWidth));
  const viewportHeight = Math.max(1, Math.round(window.innerHeight));
  const scenario = scenarioFromUrl();
  return {
    schemaVersion: 1,
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
    zoneOrScenario: scenario.zoneOrScenario,
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
      ...(snapshot.devTrace ? { devTrace: snapshot.devTrace } : {}),
    },
  };
}

export function startPerfReporter(options: PerfReporterOptions): () => void {
  const params = new URLSearchParams(location.search);
  const devTrace = localDevPerfTraceEnabled();
  if (params.get('perfReport') === '0' || params.get('perf_report') === '0') {
    const status = makeStatus(false, devTrace, '');
    const cleanupDebug = exposeDebug(status, () => {}, () => {});
    devTraceLog(status, 'debug', 'disabled by URL parameter');
    return cleanupDebug;
  }

  const sessionId = storedSessionId();
  const status = makeStatus(true, devTrace, sessionId);
  let stopped = false;
  let timer: number | null = null;
  let lastFinalFlushAt = 0;
  let cleanupDebug = (): void => {};

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
      skip('hidden', REPEAT_REPORT_MS);
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
    const body = payloadFromSnapshot(snapshot, options.settings, sessionId, options.characterIdProvider());
    if (!body) {
      skip('no-renderer', sendOptions.final ? null : REPEAT_REPORT_MS);
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
    const useKeepalive = Boolean(sendOptions.final && status.lastBodyBytes <= FETCH_KEEPALIVE_MAX_BYTES);
    if (sendOptions.final && !useKeepalive) {
      devTraceLog(status, 'debug', `final post too large for keepalive: ${status.lastBodyBytes} bytes`);
    }
    void fetch('/api/perf-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: bodyText,
      keepalive: useKeepalive,
    }).then(async (res) => {
      status.lastHttpStatus = res.status;
      if (!res.ok) {
        const responseText = (await res.text().catch(() => '')).slice(0, 160);
        status.failCount++;
        status.lastError = responseText ? `HTTP ${res.status}: ${responseText}` : `HTTP ${res.status}`;
        devTraceLog(status, 'warn', `post failed: ${status.lastError}`);
        return;
      }
      status.successCount++;
      status.lastSuccessAt = Date.now();
      status.lastError = null;
      devTraceLog(status, 'debug', `posted ${status.lastBodyBytes} bytes`);
    }).catch((err: unknown) => {
      status.failCount++;
      status.lastError = errorText(err);
      devTraceLog(status, 'warn', `post failed: ${status.lastError}`);
    });
    if (!sendOptions.final) schedule(devTrace ? DEV_TRACE_REPEAT_REPORT_MS : REPEAT_REPORT_MS);
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
  schedule(devTrace ? DEV_TRACE_FIRST_REPORT_MS : FIRST_REPORT_MS);
  return stop;
}

export const perfReporterInternalsForTest = {
  browserFamily,
  osFamily,
  gpuBucket,
  viewportBucket,
  payloadFromSnapshot,
};
