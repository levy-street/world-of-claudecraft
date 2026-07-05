import type { Renderer } from '../render/renderer';
import { assetTimingSnapshot, type AssetTimingSnapshot } from '../render/assets/stats';

export interface PerfSnapshot {
  seconds: number;
  frames: number;
  fps: number;
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number; long50: number };
  windows: {
    last10s: { seconds: number; frames: number; fps: number; frameMs: PerfSnapshot['frameMs'] };
    last30s: { seconds: number; frames: number; fps: number; frameMs: PerfSnapshot['frameMs'] };
  };
  mainMs: Record<string, { count: number; avg: number; p95: number; max: number }>;
  renderer: ReturnType<Renderer['perfStats']> | null;
  hud: { hotDomWrites: number; hotDomSkippedWrites: number; hotDomSkipRate: number } | null;
  assets: AssetTimingSnapshot;
  network: { connected: boolean; snapInterval: number; lastSnapAge: number; alpha: number } | null;
  input: {
    intents: number;
    lastKind: string;
    lastIntentAge: number;
    intentToFrame: { count: number; avg: number; p95: number; max: number };
    intentToSend: { count: number; avg: number; p95: number; max: number };
    sendToEcho: { count: number; avg: number; p95: number; max: number };
    intentToVisible: { count: number; avg: number; p95: number; max: number };
    debug?: PerfInputDebugState | null;
  };
  browser: {
    longTasks: { count: number; totalMs: number; avg: number; p95: number; max: number; lastAge: number };
    memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number; usedMB: number; limitMB: number } | null;
    visibilityState: string;
  };
  device: {
    dpr: number;
    viewport: string;
    mobileTouch: boolean;
    userAgent: string;
    hardwareConcurrency: number;
    deviceMemory: number | null;
    maxTouchPoints: number;
  };
  devTrace?: DevPerfTrace;
}

export type PerfInputDebugState = Record<string, unknown>;

type TimedBucket = 'renderer' | 'hud' | 'events' | 'sim';
const MAX_SAMPLES = 7200; // ~2 minutes at 60fps; enough for stable p95/p99 without unbounded growth.
const MAX_WINDOW_MS = 30_000;
const DEV_TRACE_WORST_FRAME_LIMIT = 40;
const DEV_TRACE_LONG_TASK_LIMIT = 80;
const DEV_TRACE_ATTRIBUTION_LIMIT = 4;
const DEV_TRACE_MIN_FRAME_MS = 33;
const DEV_TRACE_STALL_ATTRIBUTION_MS = 80;
const DEV_TRACE_STALL_CATEGORY_LIMIT = 8;
const DEV_TRACE_STALL_SAMPLE_LIMIT = 12;
const DEV_TRACE_SPAN_LIMIT = 120;
const DEV_TRACE_SPAN_MIN_MS = 8;
const DEV_TRACE_DETAIL_LIMIT = 16;

type RendererStats = NonNullable<ReturnType<Renderer['perfStats']>>;
type DevRendererFrame = Omit<NonNullable<RendererStats['lastFrame']>, 'renderDiagnostics'>;
type DevTraceDetail = Record<string, string | number | boolean | null>;

interface DevRenderStallCategory {
  name: string;
  objects: number;
  draws: number;
  triangles: number;
  points: number;
  materials: number;
  materialSamples: string[];
}

interface DevRenderStallAttribution {
  submitMs: number;
  totalMs: number;
  calls: number;
  triangles: number;
  programs: number;
  textures: number;
  programDelta: number;
  textureDelta: number;
  cameraPosition: { x: number; y: number; z: number };
  playerPosition: { x: number; y: number; z: number };
  biome: string;
  createdViews: number;
  removedViews: number;
  candidateViews: number;
  activeViews: number;
  visibleViews: number;
  createdViewTypes: string[];
  lastQualityChange: DevRendererFrame['lastQualityChange'];
  renderBudget: RendererStats['renderBudget'];
  qualityLevels: RendererStats['qualityBuckets']['levels'];
  qualityFeatures: RendererStats['qualityBuckets']['features'];
  foliage: RendererStats['foliage'];
  diagnostics: {
    enabled: boolean;
    totalObjects: number;
    estimatedDraws: number;
    estimatedTriangles: number;
    estimatedPoints: number;
    newMaterials: string[];
    firstVisibleObjects: string[];
    topCategories: DevRenderStallCategory[];
  };
}

interface DevPerfTraceFrame {
  atMs: number;
  frameMs: number;
  scoreMs: number;
  reasons: string[];
  mainMs: Record<TimedBucket, number>;
  renderer: {
    calls: number;
    triangles: number;
    textures: number;
    programs: number;
    views: number;
    renderScale: number;
    effectiveRenderScale: number;
    renderBudget: RendererStats['renderBudget'];
    qualityBuckets: RendererStats['qualityBuckets'];
    pixelRatio: number;
    width: number;
    height: number;
    foliage: RendererStats['foliage'];
    lastFrame: DevRendererFrame | null;
  } | null;
  browser: {
    longTaskCount: number;
    longTaskTotalMs: number;
    longTaskLastAgeMs: number;
    memoryUsedMb: number | null;
  };
  stallAttribution?: DevRenderStallAttribution;
}

interface DevPerfTraceSpan {
  atMs: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  name: string;
  kind: 'bucket' | 'scope' | 'external';
  detail?: DevTraceDetail;
}

interface DevLongTaskAttribution {
  name: string;
  entryType: string;
  containerType: string;
  containerName: string;
  containerId: string;
  containerSrc: string;
}

interface DevLongTaskRecord {
  startMs: number;
  endMs: number;
  durationMs: number;
  name: string;
  entryType: string;
  attribution: DevLongTaskAttribution[];
  nearestFrameAtMs?: number;
  nearestFrameMs?: number;
  nearestFrameDeltaMs?: number;
  nearestSpanName?: string;
  nearestSpanMs?: number;
  nearestSpanDeltaMs?: number;
}

export interface DevPerfTrace {
  enabled: true;
  worstFrameLimit: number;
  minFrameMs: number;
  frames: DevPerfTraceFrame[];
  spans: DevPerfTraceSpan[];
  longTasks: DevLongTaskRecord[];
}

interface FrameSample {
  at: number;
  ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function summarize(values: number[]): { count: number; avg: number; p95: number; max: number } {
  if (values.length === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  return { count: values.length, avg: round(total / values.length), p95: round(percentile(sorted, 0.95)), max: round(sorted[sorted.length - 1]) };
}

function summarizeFrames(values: number[]): PerfSnapshot['frameMs'] {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  return {
    avg: round(total / Math.max(1, values.length)),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    long50: values.filter((v) => v >= 50).length,
  };
}

function pushSample(values: number[], sample: number): void {
  values.push(sample);
  if (values.length > MAX_SAMPLES) values.splice(0, values.length - MAX_SAMPLES);
}

function renderStallCategories(rendererFrame: NonNullable<RendererStats['lastFrame']>): DevRenderStallCategory[] {
  const categories = rendererFrame.renderDiagnostics.categories;
  return Object.entries(categories)
    .map(([name, stat]) => ({
      name: name.slice(0, 80),
      objects: stat.objects,
      draws: stat.draws,
      triangles: stat.triangles,
      points: stat.points,
      materials: stat.materials,
      materialSamples: stat.materialSamples.slice(0, 4),
    }))
    .sort((a, b) => (b.triangles - a.triangles) || (b.draws - a.draws) || a.name.localeCompare(b.name))
    .slice(0, DEV_TRACE_STALL_CATEGORY_LIMIT);
}

function renderStallAttribution(
  renderer: RendererStats,
  rendererFrame: NonNullable<RendererStats['lastFrame']>,
): DevRenderStallAttribution | undefined {
  if (rendererFrame.phaseMs.submit < DEV_TRACE_STALL_ATTRIBUTION_MS) return undefined;
  const diagnostics = rendererFrame.renderDiagnostics;
  return {
    submitMs: rendererFrame.phaseMs.submit,
    totalMs: rendererFrame.phaseMs.total,
    calls: renderer.calls,
    triangles: renderer.triangles,
    programs: renderer.programs,
    textures: renderer.textures,
    programDelta: diagnostics.programDelta,
    textureDelta: diagnostics.textureDelta,
    cameraPosition: rendererFrame.cameraPosition,
    playerPosition: rendererFrame.playerPosition,
    biome: rendererFrame.biome,
    createdViews: rendererFrame.createdViews,
    removedViews: rendererFrame.removedViews,
    candidateViews: rendererFrame.candidateViews,
    activeViews: rendererFrame.activeViews,
    visibleViews: rendererFrame.visibleViews,
    createdViewTypes: rendererFrame.createdViewTypes.slice(0, DEV_TRACE_STALL_SAMPLE_LIMIT),
    lastQualityChange: rendererFrame.lastQualityChange,
    renderBudget: renderer.renderBudget,
    qualityLevels: renderer.qualityBuckets.levels,
    qualityFeatures: renderer.qualityBuckets.features,
    foliage: renderer.foliage,
    diagnostics: {
      enabled: diagnostics.enabled,
      totalObjects: diagnostics.totalObjects,
      estimatedDraws: diagnostics.estimatedDraws,
      estimatedTriangles: diagnostics.estimatedTriangles,
      estimatedPoints: diagnostics.estimatedPoints,
      newMaterials: diagnostics.newMaterials.slice(0, DEV_TRACE_STALL_SAMPLE_LIMIT),
      firstVisibleObjects: diagnostics.firstVisibleObjects.slice(0, DEV_TRACE_STALL_SAMPLE_LIMIT),
      topCategories: renderStallCategories(rendererFrame),
    },
  };
}

function sanitizeTraceDetail(detail?: Record<string, unknown>): DevTraceDetail | undefined {
  if (!detail) return undefined;
  const out: DevTraceDetail = {};
  let count = 0;
  for (const [key, value] of Object.entries(detail)) {
    if (count >= DEV_TRACE_DETAIL_LIMIT) break;
    const cleanKey = key.slice(0, 40);
    if (typeof value === 'string') {
      out[cleanKey] = value.slice(0, 120);
    } else if (typeof value === 'number') {
      out[cleanKey] = Number.isFinite(value) ? round(value) : null;
    } else if (typeof value === 'boolean' || value === null) {
      out[cleanKey] = value;
    } else if (Array.isArray(value)) {
      out[cleanKey] = value.slice(0, 8).map((v) => String(v).slice(0, 40)).join(',');
    } else if (value !== undefined) {
      out[cleanKey] = String(value).slice(0, 120);
    }
    count++;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export function localDevPerfTraceEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof location === 'undefined') return false;
  const params = new URLSearchParams(location.search);
  if (params.get('perfTrace') !== '1' && params.get('perf_trace') !== '1') return false;
  return isLoopbackHostname(location.hostname);
}

export class PerfMonitor {
  readonly enabled: boolean;
  private overlay: HTMLDivElement | null = null;
  private startedAt = performance.now();
  private lastOverlayAt = 0;
  private frames = 0;
  private frameMs: number[] = [];
  private lastFrameMs = 0;
  private frameWindow: FrameSample[] = [];
  private buckets: Record<TimedBucket, number[]> = { renderer: [], hud: [], events: [], sim: [] };
  private lastBucketMs: Record<TimedBucket, number> = { renderer: 0, hud: 0, events: 0, sim: 0 };
  private lastSnapshot: PerfSnapshot | null = null;
  private network: PerfSnapshot['network'] = null;
  private inputIntents = 0;
  private lastInputAt = 0;
  private lastInputKind = '';
  private pendingFrameAt = 0;
  private pendingSendAt = 0;
  private pendingVisibleAt = 0;
  private inputToFrameMs: number[] = [];
  private inputToSendMs: number[] = [];
  private inputToEchoMs: number[] = [];
  private inputToVisibleMs: number[] = [];
  private longTaskMs: number[] = [];
  private longTaskTotalMs = 0;
  private lastLongTaskAt = 0;
  private longTaskObserver: PerformanceObserver | null = null;
  private readonly traceEnabled: boolean;
  private inputDebugProvider: (() => PerfInputDebugState | null) | null = null;
  private devTraceFrames: DevPerfTraceFrame[] = [];
  private devTraceSpans: DevPerfTraceSpan[] = [];
  private devLongTasks: DevLongTaskRecord[] = [];

  constructor(private renderer: Renderer | null, private hud: { perfStats(): PerfSnapshot['hud'] } | null = null) {
    const params = new URLSearchParams(location.search);
    this.traceEnabled = localDevPerfTraceEnabled();
    this.enabled = this.traceEnabled || params.has('perf') || localStorage.getItem('woc_perf') === '1';
    if (this.enabled) {
      this.mountOverlay();
    }
    this.observeLongTasks();
  }

  setRenderer(renderer: Renderer): void {
    this.renderer = renderer;
  }

  setHud(hud: { perfStats(): PerfSnapshot['hud'] }): void {
    this.hud = hud;
  }

  setInputDebugProvider(provider: () => PerfInputDebugState | null): void {
    this.inputDebugProvider = provider;
  }

  frame(dt: number, now = performance.now()): void {
    this.frames++;
    const ms = Math.min(250, Math.max(0, dt * 1000));
    this.lastFrameMs = ms;
    pushSample(this.frameMs, ms);
    this.frameWindow.push({ at: now, ms });
    while (this.frameWindow.length && now - this.frameWindow[0].at > MAX_WINDOW_MS) this.frameWindow.shift();
  }

  markInputIntent(kind: 'move' | 'look' | 'zoom', now = performance.now()): void {
    if (!this.enabled) return;
    this.inputIntents++;
    this.lastInputAt = now;
    this.lastInputKind = kind;
    this.pendingFrameAt = now;
    this.pendingSendAt = now;
    this.pendingVisibleAt = now;
  }

  markInputFrame(now = performance.now()): void {
    if (!this.enabled || this.pendingFrameAt <= 0) return;
    pushSample(this.inputToFrameMs, now - this.pendingFrameAt);
    this.pendingFrameAt = 0;
  }

  markInputSent(now = performance.now()): void {
    if (!this.enabled || this.pendingSendAt <= 0) return;
    pushSample(this.inputToSendMs, now - this.pendingSendAt);
    this.pendingSendAt = 0;
  }

  markInputEcho(ms: number): void {
    if (!this.enabled || !Number.isFinite(ms) || ms < 0) return;
    pushSample(this.inputToEchoMs, ms);
  }

  markInputVisible(now = performance.now()): void {
    if (!this.enabled || this.pendingVisibleAt <= 0) return;
    pushSample(this.inputToVisibleMs, now - this.pendingVisibleAt);
    this.pendingVisibleAt = 0;
  }

  time<T>(bucket: TimedBucket, fn: () => T): T {
    if (!this.enabled) return fn();
    const start = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - start;
      this.lastBucketMs[bucket] = round(ms);
      pushSample(this.buckets[bucket], ms);
      this.recordDevTraceSpan(bucket, start, ms, 'bucket');
    }
  }

  trace<T>(name: string, fn: () => T, detail?: Record<string, unknown>): T {
    if (!this.traceEnabled) return fn();
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.recordDevTraceSpan(name, start, performance.now() - start, 'scope', detail);
    }
  }

  setNetwork(stats: PerfSnapshot['network']): void {
    if (!this.enabled) return;
    this.network = stats;
  }

  private recordDevTraceSpan(
    name: string,
    startMs: number,
    durationMs: number,
    kind: DevPerfTraceSpan['kind'],
    detail?: Record<string, unknown>,
  ): void {
    if (!this.traceEnabled || !Number.isFinite(durationMs) || durationMs < DEV_TRACE_SPAN_MIN_MS) return;
    const startRel = Math.max(0, startMs - this.startedAt);
    const span: DevPerfTraceSpan = {
      atMs: round(startRel + durationMs),
      startMs: round(startRel),
      endMs: round(startRel + durationMs),
      durationMs: round(durationMs),
      name: name.slice(0, 80),
      kind,
    };
    const cleanDetail = sanitizeTraceDetail(detail);
    if (cleanDetail) span.detail = cleanDetail;
    this.devTraceSpans.push(span);
    this.devTraceSpans.sort((a, b) => b.durationMs - a.durationMs || a.startMs - b.startMs);
    if (this.devTraceSpans.length > DEV_TRACE_SPAN_LIMIT) {
      this.devTraceSpans.length = DEV_TRACE_SPAN_LIMIT;
    }
  }

  private observeLongTasks(): void {
    const supported = typeof PerformanceObserver !== 'undefined'
      && Array.isArray(PerformanceObserver.supportedEntryTypes)
      && PerformanceObserver.supportedEntryTypes.includes('longtask');
    if (!supported) return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Math.max(0, entry.duration || 0);
          pushSample(this.longTaskMs, duration);
          this.longTaskTotalMs += duration;
          this.lastLongTaskAt = entry.startTime + duration;
          if (this.traceEnabled) this.recordDevLongTask(entry);
        }
      });
      this.longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      this.longTaskObserver = null;
    }
  }

  private memorySnapshot(): PerfSnapshot['browser']['memory'] {
    const memory = (performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    if (!memory) return null;
    const mib = 1024 * 1024;
    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      usedMB: round(memory.usedJSHeapSize / mib),
      limitMB: round(memory.jsHeapSizeLimit / mib),
    };
  }

  private recordDevLongTask(entry: PerformanceEntry): void {
    const withAttribution = entry as PerformanceEntry & {
      attribution?: Array<Partial<DevLongTaskAttribution>>;
    };
    const attribution = (withAttribution.attribution ?? []).slice(0, DEV_TRACE_ATTRIBUTION_LIMIT).map((a) => ({
      name: String(a.name ?? '').slice(0, 80),
      entryType: String(a.entryType ?? '').slice(0, 40),
      containerType: String(a.containerType ?? '').slice(0, 40),
      containerName: String(a.containerName ?? '').slice(0, 80),
      containerId: String(a.containerId ?? '').slice(0, 80),
      containerSrc: String(a.containerSrc ?? '').slice(0, 160),
    }));
    const startMs = Math.max(0, entry.startTime - this.startedAt);
    this.devLongTasks.push({
      startMs: round(startMs),
      endMs: round(startMs + entry.duration),
      durationMs: round(entry.duration),
      name: String(entry.name ?? '').slice(0, 80),
      entryType: String(entry.entryType ?? '').slice(0, 40),
      attribution,
    });
    if (this.devLongTasks.length > DEV_TRACE_LONG_TASK_LIMIT) {
      this.devLongTasks.splice(0, this.devLongTasks.length - DEV_TRACE_LONG_TASK_LIMIT);
    }
  }

  private devTraceLongTasks(): DevLongTaskRecord[] {
    return this.devLongTasks.map((task) => {
      let nearest: DevPerfTraceFrame | null = null;
      let nearestDelta = Infinity;
      let nearestSpan: DevPerfTraceSpan | null = null;
      let nearestSpanDelta = Infinity;
      const taskMid = (task.startMs + task.endMs) / 2;
      for (const frame of this.devTraceFrames) {
        const delta = Math.abs(frame.atMs - taskMid);
        if (delta < nearestDelta) {
          nearest = frame;
          nearestDelta = delta;
        }
      }
      for (const span of this.devTraceSpans) {
        const delta = taskMid >= span.startMs && taskMid <= span.endMs
          ? 0
          : Math.min(Math.abs(taskMid - span.startMs), Math.abs(taskMid - span.endMs));
        if (delta < nearestSpanDelta) {
          nearestSpan = span;
          nearestSpanDelta = delta;
        }
      }
      return nearest
        ? {
          ...task,
          nearestFrameAtMs: nearest.atMs,
          nearestFrameMs: nearest.frameMs,
          nearestFrameDeltaMs: round(nearestDelta),
          ...(nearestSpan
            ? {
              nearestSpanName: nearestSpan.name,
              nearestSpanMs: nearestSpan.durationMs,
              nearestSpanDeltaMs: round(nearestSpanDelta),
            }
            : {}),
        }
        : {
          ...task,
          ...(nearestSpan
            ? {
              nearestSpanName: nearestSpan.name,
              nearestSpanMs: nearestSpan.durationMs,
              nearestSpanDeltaMs: round(nearestSpanDelta),
            }
            : {}),
        };
    });
  }

  private recordDevTraceFrame(now: number): void {
    const renderer = this.renderer?.perfStats() ?? null;
    const rendererFrame = renderer?.lastFrame ?? null;
    const bucketMax = Math.max(...Object.values(this.lastBucketMs));
    const rendererTotal = rendererFrame?.phaseMs.total ?? 0;
    const rendererSubmit = rendererFrame?.phaseMs.submit ?? 0;
    const rendererWorld = rendererFrame?.phaseMs.world ?? 0;
    const rendererEntities = rendererFrame?.phaseMs.entities ?? 0;
    const scoreMs = Math.max(this.lastFrameMs, bucketMax, rendererTotal, rendererSubmit, rendererWorld, rendererEntities);
    const reasons: string[] = [];
    if (this.lastFrameMs >= DEV_TRACE_MIN_FRAME_MS) reasons.push('frame-gap');
    if (bucketMax >= DEV_TRACE_MIN_FRAME_MS) reasons.push('main-bucket');
    if (rendererTotal >= DEV_TRACE_MIN_FRAME_MS) reasons.push('renderer-total');
    if (rendererSubmit >= DEV_TRACE_MIN_FRAME_MS) reasons.push('renderer-submit');
    if (rendererWorld >= DEV_TRACE_MIN_FRAME_MS) reasons.push('renderer-world');
    if (rendererEntities >= DEV_TRACE_MIN_FRAME_MS) reasons.push('renderer-entities');
    if (reasons.length === 0) return;
    const memory = this.memorySnapshot();
    const devRendererFrame = rendererFrame
      ? (() => {
        const { renderDiagnostics: _renderDiagnostics, ...frame } = rendererFrame;
        return frame;
      })()
      : null;
    const stallAttribution = renderer && rendererFrame
      ? renderStallAttribution(renderer, rendererFrame)
      : undefined;
    const frame: DevPerfTraceFrame = {
      atMs: round(now - this.startedAt),
      frameMs: round(this.lastFrameMs),
      scoreMs: round(scoreMs),
      reasons,
      mainMs: { ...this.lastBucketMs },
      renderer: renderer ? {
        calls: renderer.calls,
        triangles: renderer.triangles,
        textures: renderer.textures,
        programs: renderer.programs,
        views: renderer.views,
        renderScale: renderer.renderScale,
        effectiveRenderScale: renderer.effectiveRenderScale,
        renderBudget: renderer.renderBudget,
        qualityBuckets: renderer.qualityBuckets,
        pixelRatio: renderer.pixelRatio,
        width: renderer.width,
        height: renderer.height,
        foliage: renderer.foliage,
        lastFrame: devRendererFrame,
      } : null,
      browser: {
        longTaskCount: this.longTaskMs.length,
        longTaskTotalMs: round(this.longTaskTotalMs),
        longTaskLastAgeMs: this.lastLongTaskAt > 0 ? round(now - this.lastLongTaskAt) : -1,
        memoryUsedMb: memory?.usedMB ?? null,
      },
      ...(stallAttribution ? { stallAttribution } : {}),
    };
    this.devTraceFrames.push(frame);
    this.devTraceFrames.sort((a, b) => b.scoreMs - a.scoreMs || b.frameMs - a.frameMs || a.atMs - b.atMs);
    if (this.devTraceFrames.length > DEV_TRACE_WORST_FRAME_LIMIT) {
      this.devTraceFrames.length = DEV_TRACE_WORST_FRAME_LIMIT;
    }
  }

  tick(now = performance.now()): void {
    if (this.traceEnabled) this.recordDevTraceFrame(now);
    if (now - this.lastOverlayAt < 1000) return;
    this.lastOverlayAt = now;
    this.lastSnapshot = this.snapshot(now);
    if (!this.enabled) return;
    this.renderOverlay(this.lastSnapshot);
  }

  snapshot(now = performance.now()): PerfSnapshot {
    const seconds = Math.max(0.001, (now - this.startedAt) / 1000);
    const mainMs = Object.fromEntries(
      (Object.keys(this.buckets) as TimedBucket[]).map((key) => [key, summarize(this.buckets[key])]),
    );
    const windowSummary = (windowMs: number): PerfSnapshot['windows']['last10s'] => {
      const samples = this.frameWindow.filter((s) => now - s.at <= windowMs);
      const span = samples.length > 1
        ? Math.max(0.001, (samples[samples.length - 1].at - samples[0].at) / 1000)
        : Math.min(seconds, windowMs / 1000);
      return {
        seconds: round(Math.min(seconds, windowMs / 1000)),
        frames: samples.length,
        fps: round(samples.length / Math.max(0.001, span)),
        frameMs: summarizeFrames(samples.map((s) => s.ms)),
      };
    };
    const inputDebug = this.readInputDebug();
    const snapshot: PerfSnapshot = {
      seconds: round(seconds),
      frames: this.frames,
      fps: round(this.frames / seconds),
      frameMs: summarizeFrames(this.frameMs),
      windows: {
        last10s: windowSummary(10_000),
        last30s: windowSummary(30_000),
      },
      mainMs: mainMs as PerfSnapshot['mainMs'],
      renderer: this.renderer?.perfStats() ?? null,
      hud: this.hud?.perfStats() ?? null,
      assets: assetTimingSnapshot(),
      network: this.network,
      input: {
        intents: this.inputIntents,
        lastKind: this.lastInputKind,
        lastIntentAge: this.lastInputAt > 0 ? round(now - this.lastInputAt) : -1,
        intentToFrame: summarize(this.inputToFrameMs),
        intentToSend: summarize(this.inputToSendMs),
        sendToEcho: summarize(this.inputToEchoMs),
        intentToVisible: summarize(this.inputToVisibleMs),
        ...(inputDebug ? { debug: inputDebug } : {}),
      },
      browser: {
        longTasks: {
          ...summarize(this.longTaskMs),
          totalMs: round(this.longTaskTotalMs),
          lastAge: this.lastLongTaskAt > 0 ? round(now - this.lastLongTaskAt) : -1,
        },
        memory: this.memorySnapshot(),
        visibilityState: document.visibilityState,
      },
      device: {
        dpr: window.devicePixelRatio || 1,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        mobileTouch: document.body.classList.contains('mobile-touch'),
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency || 0,
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        maxTouchPoints: navigator.maxTouchPoints || 0,
      },
    };
    if (this.traceEnabled) {
      snapshot.devTrace = {
        enabled: true,
        worstFrameLimit: DEV_TRACE_WORST_FRAME_LIMIT,
        minFrameMs: DEV_TRACE_MIN_FRAME_MS,
        frames: this.devTraceFrames,
        spans: this.devTraceSpans,
        longTasks: this.devTraceLongTasks(),
      };
    }
    return snapshot;
  }

  private readInputDebug(): PerfInputDebugState | null {
    if (!this.inputDebugProvider) return null;
    try {
      return this.inputDebugProvider();
    } catch {
      return null;
    }
  }

  report(): PerfSnapshot {
    this.lastSnapshot = this.snapshot();
    return this.lastSnapshot;
  }

  copyReport(): void {
    const text = JSON.stringify(this.report(), null, 2);
    void navigator.clipboard?.writeText(text).catch(() => {
      console.info('World of Claudecraft perf report:', text);
    });
  }

  reset(): void {
    this.startedAt = performance.now();
    this.frames = 0;
    this.frameMs = [];
    this.frameWindow = [];
    this.buckets = { renderer: [], hud: [], events: [], sim: [] };
    this.lastSnapshot = null;
    this.inputIntents = 0;
    this.lastInputAt = 0;
    this.lastInputKind = '';
    this.pendingFrameAt = 0;
    this.pendingSendAt = 0;
    this.pendingVisibleAt = 0;
    this.inputToFrameMs = [];
    this.inputToSendMs = [];
    this.inputToEchoMs = [];
    this.inputToVisibleMs = [];
    this.longTaskMs = [];
    this.longTaskTotalMs = 0;
    this.lastLongTaskAt = 0;
    this.lastFrameMs = 0;
    this.lastBucketMs = { renderer: 0, hud: 0, events: 0, sim: 0 };
    this.devTraceFrames = [];
    this.devTraceSpans = [];
    this.devLongTasks = [];
  }

  private mountOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = [
      'position:fixed',
      'right:8px',
      'top:8px',
      'z-index:2147483647',
      'min-width:210px',
      'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'color:#dbeafe',
      'background:rgba(4,10,18,0.82)',
      'border:1px solid rgba(147,197,253,0.45)',
      'border-radius:6px',
      'padding:8px',
      'pointer-events:auto',
      'white-space:pre',
      'box-shadow:0 8px 28px rgba(0,0,0,0.35)',
    ].join(';');
    this.overlay.title = 'Click to copy a JSON perf report';
    this.overlay.textContent = 'perf: collecting...';
    this.overlay.addEventListener('click', () => this.copyReport());
    document.body.appendChild(this.overlay);
  }

  private renderOverlay(s: PerfSnapshot): void {
    if (!this.overlay) return;
    const r = s.renderer;
    const hud = s.hud;
    const net = s.network;
    const gltf = s.assets.byType.gltf;
    const hdr = s.assets.byType.hdr;
    const tex = s.assets.byType.texture;
    const rp = r?.phaseMs;
    const lt = s.browser.longTasks;
    const mem = s.browser.memory;
    this.overlay.textContent = [
      `fps ${s.fps}  p95 ${s.frameMs.p95}ms  >50 ${s.frameMs.long50}`,
      `10s fps ${s.windows.last10s.fps}  p95 ${s.windows.last10s.frameMs.p95}ms  >50 ${s.windows.last10s.frameMs.long50}`,
      `longtask ${lt.count}  p95 ${lt.p95}ms  max ${lt.max}ms  heap ${mem ? `${mem.usedMB}/${mem.limitMB}MB` : '-'}`,
      `render ${s.mainMs.renderer.avg}/${s.mainMs.renderer.p95}ms  hud ${s.mainMs.hud.avg}/${s.mainMs.hud.p95}ms`,
      `hud writes ${hud?.hotDomWrites ?? 0}  skip ${Math.round((hud?.hotDomSkipRate ?? 0) * 100)}%`,
      `rph e ${rp?.entities.p95 ?? 0} w ${rp?.world.p95 ?? 0} np ${rp?.nameplates.p95 ?? 0} sub ${rp?.submit.p95 ?? 0}ms`,
      `calls ${r?.calls ?? 0}  tris ${r?.triangles ?? 0}  tex ${r?.textures ?? 0}`,
      `scale ${r?.effectiveRenderScale ?? 0}/${r?.renderScale ?? 0}  tier ${r?.tier ?? '-'}`,
      `assets wait ${s.assets.preload.waitMs}ms  gltf ${gltf?.count ?? 0}/${gltf?.p95Ms ?? 0}ms  hdr ${hdr?.count ?? 0}/${hdr?.p95Ms ?? 0}ms  tex ${tex?.count ?? 0}/${tex?.p95Ms ?? 0}ms`,
      `input f ${s.input.intentToFrame.p95}ms  send ${s.input.intentToSend.p95}ms  echo ${s.input.sendToEcho.p95}ms  vis ${s.input.intentToVisible.p95}ms`,
      `gl ${r?.glRenderer ? r.glRenderer.slice(0, 34) : '-'}  lost ${r?.contextLost ?? 0}`,
      net ? `net ${net.connected ? 'up' : 'down'} snap ${net.snapInterval}ms age ${net.lastSnapAge}ms a ${net.alpha}` : 'net offline',
      'click: copy json',
    ].join('\n');
  }
}

export function createPerfMonitor(renderer: Renderer | null): PerfMonitor {
  return new PerfMonitor(renderer);
}
