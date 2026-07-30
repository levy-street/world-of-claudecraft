import type { NetPipelineSummary } from '../net/net_pipeline_stats';
import { type AssetTimingSnapshot, assetTimingSnapshot } from '../render/assets/stats';
import type { Renderer } from '../render/renderer';
import {
  censusTableLines,
  type HitchSummary,
  type SceneCensusReport,
} from '../render/scene_census_core';
import { createHeapSawtooth, type HeapSawtoothSummary } from './heap_sawtooth';
import { NumberSampleRing, TimedNumberSampleRing } from './sample_ring';
import { createWorstWindow, type WorstWindowSummary } from './worst_window';

export interface PerfSnapshot {
  seconds: number;
  frames: number;
  fps: number;
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number; long50: number };
  windows: {
    last10s: { seconds: number; frames: number; fps: number; frameMs: PerfSnapshot['frameMs'] };
    last30s: { seconds: number; frames: number; fps: number; frameMs: PerfSnapshot['frameMs'] };
    // Worst 10 s window since the reporter last drained it (ruling R5):
    // worst-per-report-interval, so a hitch storm survives the cumulative
    // dilution and the frame ring's eviction. Null before the first 1 Hz tick.
    worst10s: WorstWindowSummary | null;
  };
  mainMs: Record<string, { count: number; avg: number; p95: number; max: number }>;
  renderer: ReturnType<Renderer['perfStats']> | null;
  hud: { hotDomWrites: number; hotDomSkippedWrites: number; hotDomSkipRate: number } | null;
  assets: AssetTimingSnapshot;
  network: { connected: boolean; snapInterval: number; lastSnapAge: number; alpha: number } | null;
  // Always-on aggregate counters (ruling R9), unlike the overlay-gated
  // `network` block above: null offline, populated online even with the
  // overlay disabled so every fleet perf report carries them.
  netPipeline: NetPipelineSummary | null;
  // Always-on 1 Hz heap sawtooth (ruling R10); null off Chromium.
  heapSawtooth: HeapSawtoothSummary | null;
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
    longTasks: {
      count: number;
      totalMs: number;
      avg: number;
      p95: number;
      max: number;
      lastAge: number;
    };
    memory: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
      usedMB: number;
      limitMB: number;
    } | null;
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
  /** Last on-demand scene census (the overlay's census button); absent until run. */
  census?: SceneCensusReport;
  /** Overlay-gated hitch correlation from the renderer; absent when the overlay is off. */
  hitches?: HitchSummary;
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
  return {
    count: values.length,
    avg: round(total / values.length),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1]),
  };
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

function renderStallCategories(
  rendererFrame: NonNullable<RendererStats['lastFrame']>,
): DevRenderStallCategory[] {
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
    .sort((a, b) => b.triangles - a.triangles || b.draws - a.draws || a.name.localeCompare(b.name))
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
      out[cleanKey] = value
        .slice(0, 8)
        .map((v) => String(v).slice(0, 40))
        .join(',');
    } else if (value !== undefined) {
      out[cleanKey] = String(value).slice(0, 120);
    }
    count++;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
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
  private overlayText: HTMLDivElement | null = null;
  private lastCensus: SceneCensusReport | null = null;
  // Rendered once per census run, not on every 1 Hz overlay repaint.
  private lastCensusLines: string[] = [];
  // The census burst runs inside one task, so the following rAF gap is a
  // self-inflicted long frame; drop that one sample from the statistics.
  private skipNextFrameSample = false;
  private startedAt = performance.now();
  private lastOverlayAt = 0;
  private frames = 0;
  private frameMs = new NumberSampleRing(MAX_SAMPLES);
  private lastFrameMs = 0;
  private frameWindow = new TimedNumberSampleRing(MAX_SAMPLES);
  private buckets: Record<TimedBucket, NumberSampleRing> = {
    renderer: new NumberSampleRing(MAX_SAMPLES),
    hud: new NumberSampleRing(MAX_SAMPLES),
    events: new NumberSampleRing(MAX_SAMPLES),
    sim: new NumberSampleRing(MAX_SAMPLES),
  };
  private lastBucketMs: Record<TimedBucket, number> = { renderer: 0, hud: 0, events: 0, sim: 0 };
  private lastSnapshot: PerfSnapshot | null = null;
  private network: PerfSnapshot['network'] = null;
  private netPipelineSource: { summary(): NetPipelineSummary } | null = null;
  private heapSawtooth = createHeapSawtooth({
    readUsedHeapBytes: () => this.memorySnapshot()?.usedJSHeapSize ?? null,
  });
  private worstWindow = createWorstWindow();
  private inputIntents = 0;
  private lastInputAt = 0;
  private lastInputKind = '';
  private pendingFrameAt = 0;
  private pendingSendAt = 0;
  private pendingVisibleAt = 0;
  private inputToFrameMs = new NumberSampleRing(MAX_SAMPLES);
  private inputToSendMs = new NumberSampleRing(MAX_SAMPLES);
  private inputToEchoMs = new NumberSampleRing(MAX_SAMPLES);
  private inputToVisibleMs = new NumberSampleRing(MAX_SAMPLES);
  private longTaskMs = new NumberSampleRing(MAX_SAMPLES);
  private longTaskTotalMs = 0;
  private lastLongTaskAt = 0;
  private longTaskObserver: PerformanceObserver | null = null;
  private readonly traceEnabled: boolean;
  private inputDebugProvider: (() => PerfInputDebugState | null) | null = null;
  private devTraceFrames: DevPerfTraceFrame[] = [];
  private devTraceSpans: DevPerfTraceSpan[] = [];
  private devLongTasks: DevLongTaskRecord[] = [];

  constructor(
    private renderer: Renderer | null,
    private hud: { perfStats(): PerfSnapshot['hud'] } | null = null,
  ) {
    const params = new URLSearchParams(location.search);
    this.traceEnabled = localDevPerfTraceEnabled();
    this.enabled =
      this.traceEnabled || params.has('perf') || localStorage.getItem('woc_perf') === '1';
    if (this.enabled) {
      this.mountOverlay();
    }
    this.renderer?.setHitchLogEnabled(this.enabled);
    this.observeLongTasks();
  }

  setRenderer(renderer: Renderer): void {
    this.renderer = renderer;
    renderer.setHitchLogEnabled(this.enabled);
  }

  setHud(hud: { perfStats(): PerfSnapshot['hud'] }): void {
    this.hud = hud;
  }

  setInputDebugProvider(provider: () => PerfInputDebugState | null): void {
    this.inputDebugProvider = provider;
  }

  frame(dt: number, now = performance.now()): void {
    if (this.skipNextFrameSample) {
      this.skipNextFrameSample = false;
      return;
    }
    this.frames++;
    const ms = Math.min(250, Math.max(0, dt * 1000));
    this.lastFrameMs = ms;
    this.frameMs.push(ms);
    this.frameWindow.push(now, ms);
    this.frameWindow.pruneBefore(now - MAX_WINDOW_MS);
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
    this.inputToFrameMs.push(now - this.pendingFrameAt);
    this.pendingFrameAt = 0;
  }

  markInputSent(now = performance.now()): void {
    if (!this.enabled || this.pendingSendAt <= 0) return;
    this.inputToSendMs.push(now - this.pendingSendAt);
    this.pendingSendAt = 0;
  }

  markInputEcho(ms: number): void {
    if (!this.enabled || !Number.isFinite(ms) || ms < 0) return;
    this.inputToEchoMs.push(ms);
  }

  markInputVisible(now = performance.now()): void {
    if (!this.enabled || this.pendingVisibleAt <= 0) return;
    this.inputToVisibleMs.push(now - this.pendingVisibleAt);
    this.pendingVisibleAt = 0;
  }

  time<T>(bucket: TimedBucket, fn: () => T): T {
    // Bucket recording is deliberately UNGATED (packet 0, finding 20): the
    // four mainMs buckets ride in every fleet report, overlay on or off. The
    // overlay mount, the markInput* chain, and the dev-trace spans (gated
    // inside recordDevTraceSpan) stay behind their flags.
    const start = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - start;
      this.lastBucketMs[bucket] = round(ms);
      this.buckets[bucket].push(ms);
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

  setNetPipelineSource(source: { summary(): NetPipelineSummary } | null): void {
    // Deliberately NOT gated on this.enabled, unlike setNetwork above: the
    // fleet story rides always-on aggregate counters (ruling R9); only the
    // overlay and the dev-trace spans stay gated. Takes the stats SOURCE, not
    // a built summary: summary() allocates, so snapshot() draws it lazily at
    // its 1 Hz cadence instead of the caller paying it every animation frame.
    this.netPipelineSource = source;
  }

  /**
   * Reset the worst-10s interval. Only the reporter calls this, and only
   * after a SUCCESSFUL send (ruling R5), so a failed post never loses the
   * retained hitch storm; snapshot() itself stays a pure read.
   */
  drainWorstWindow(): void {
    this.worstWindow.drain();
  }

  /**
   * Feed an externally timed span into the dev trace on the 'external' span
   * kind. Dev traces only: a no-op unless perfTrace is active (the internal
   * recorder gates on traceEnabled), so it costs nothing in the fleet.
   */
  recordExternalSpan(
    name: string,
    startMs: number,
    durationMs: number,
    detail?: Record<string, unknown>,
  ): void {
    this.recordDevTraceSpan(name, startMs, durationMs, 'external', detail);
  }

  private recordDevTraceSpan(
    name: string,
    startMs: number,
    durationMs: number,
    kind: DevPerfTraceSpan['kind'],
    detail?: Record<string, unknown>,
  ): void {
    if (!this.traceEnabled || !Number.isFinite(durationMs) || durationMs < DEV_TRACE_SPAN_MIN_MS)
      return;
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
    const supported =
      typeof PerformanceObserver !== 'undefined' &&
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      PerformanceObserver.supportedEntryTypes.includes('longtask');
    if (!supported) return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Math.max(0, entry.duration || 0);
          this.longTaskMs.push(duration);
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
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;
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
    const attribution = (withAttribution.attribution ?? [])
      .slice(0, DEV_TRACE_ATTRIBUTION_LIMIT)
      .map((a) => ({
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
        const delta =
          taskMid >= span.startMs && taskMid <= span.endMs
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
    const scoreMs = Math.max(
      this.lastFrameMs,
      bucketMax,
      rendererTotal,
      rendererSubmit,
      rendererWorld,
      rendererEntities,
    );
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
    const stallAttribution =
      renderer && rendererFrame ? renderStallAttribution(renderer, rendererFrame) : undefined;
    const frame: DevPerfTraceFrame = {
      atMs: round(now - this.startedAt),
      frameMs: round(this.lastFrameMs),
      scoreMs: round(scoreMs),
      reasons,
      mainMs: { ...this.lastBucketMs },
      renderer: renderer
        ? {
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
          }
        : null,
      browser: {
        longTaskCount: this.longTaskMs.length,
        longTaskTotalMs: round(this.longTaskTotalMs),
        longTaskLastAgeMs: this.lastLongTaskAt > 0 ? round(now - this.lastLongTaskAt) : -1,
        memoryUsedMb: memory?.usedMB ?? null,
      },
      ...(stallAttribution ? { stallAttribution } : {}),
    };
    this.devTraceFrames.push(frame);
    this.devTraceFrames.sort(
      (a, b) => b.scoreMs - a.scoreMs || b.frameMs - a.frameMs || a.atMs - b.atMs,
    );
    if (this.devTraceFrames.length > DEV_TRACE_WORST_FRAME_LIMIT) {
      this.devTraceFrames.length = DEV_TRACE_WORST_FRAME_LIMIT;
    }
  }

  tick(now = performance.now()): void {
    if (this.traceEnabled) this.recordDevTraceFrame(now);
    if (now - this.lastOverlayAt < 1000) return;
    this.lastOverlayAt = now;
    // 1 Hz heap sample from the UNGATED tick path (ruling R10): the sawtooth
    // rides in every fleet report, overlay on or off.
    this.heapSawtooth.sample(now);
    // 1 Hz worst-10s evaluation, also ungated (ruling R5): snapshot() stays a
    // pure read of the retained window; only the reporter drains it.
    this.worstWindow.observe(
      this.frameWindow.entries().map((entry) => ({ at: entry.at, ms: entry.value })),
      now,
    );
    // Production telemetry reports on its own 75 s / 5 min cadence. Without a
    // visible diagnostic overlay there is nothing to ASSEMBLE every second:
    // doing so sorted every history and copied renderer stats for no consumer.
    // The two trackers above stay ungated: the fleet report reads them whether
    // or not the overlay is up.
    if (!this.enabled) return;
    this.lastSnapshot = this.snapshot(now);
    this.renderOverlay(this.lastSnapshot);
  }

  snapshot(now = performance.now()): PerfSnapshot {
    const seconds = Math.max(0.001, (now - this.startedAt) / 1000);
    const mainMs = Object.fromEntries(
      (Object.keys(this.buckets) as TimedBucket[]).map((key) => [
        key,
        summarize(this.buckets[key].toArray()),
      ]),
    );
    const windowSummary = (windowMs: number): PerfSnapshot['windows']['last10s'] => {
      const samples = this.frameWindow.snapshotSince(now - windowMs);
      const span =
        samples.values.length > 1 && samples.firstAt !== null && samples.lastAt !== null
          ? Math.max(0.001, (samples.lastAt - samples.firstAt) / 1000)
          : Math.min(seconds, windowMs / 1000);
      return {
        seconds: round(Math.min(seconds, windowMs / 1000)),
        frames: samples.values.length,
        fps: round(samples.values.length / Math.max(0.001, span)),
        frameMs: summarizeFrames(samples.values),
      };
    };
    const inputDebug = this.readInputDebug();
    const snapshot: PerfSnapshot = {
      seconds: round(seconds),
      frames: this.frames,
      fps: round(this.frames / seconds),
      frameMs: summarizeFrames(this.frameMs.toArray()),
      windows: {
        last10s: windowSummary(10_000),
        last30s: windowSummary(30_000),
        worst10s: this.worstWindow.current(),
      },
      mainMs: mainMs as PerfSnapshot['mainMs'],
      renderer: this.renderer?.perfStats() ?? null,
      hud: this.hud?.perfStats() ?? null,
      assets: assetTimingSnapshot(),
      network: this.network,
      netPipeline: this.netPipelineSource?.summary() ?? null,
      heapSawtooth: this.heapSawtooth.summary(),
      input: {
        intents: this.inputIntents,
        lastKind: this.lastInputKind,
        lastIntentAge: this.lastInputAt > 0 ? round(now - this.lastInputAt) : -1,
        intentToFrame: summarize(this.inputToFrameMs.toArray()),
        intentToSend: summarize(this.inputToSendMs.toArray()),
        sendToEcho: summarize(this.inputToEchoMs.toArray()),
        intentToVisible: summarize(this.inputToVisibleMs.toArray()),
        ...(inputDebug ? { debug: inputDebug } : {}),
      },
      browser: {
        longTasks: {
          ...summarize(this.longTaskMs.toArray()),
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
    if (this.lastCensus) snapshot.census = this.lastCensus;
    const hitches = this.renderer?.hitchStats() ?? null;
    if (hitches) snapshot.hitches = hitches;
    return snapshot;
  }

  /**
   * Run the one-shot scene census through the renderer, remember it for the
   * overlay table and the JSON report, and log it as copyable JSON. On demand
   * only (the overlay's census button and the capture harness); returns null
   * before the renderer exists.
   */
  runSceneCensus(): SceneCensusReport | null {
    if (!this.renderer) return null;
    const report = this.renderer.captureSceneCensus();
    this.lastCensus = report;
    this.lastCensusLines = censusTableLines(report);
    this.skipNextFrameSample = true;
    console.info('World of Claudecraft scene census:', JSON.stringify(report, null, 2));
    if (this.enabled) this.renderOverlay(this.lastSnapshot ?? this.snapshot());
    return report;
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
    this.frameMs.clear();
    this.frameWindow.clear();
    this.lastCensus = null;
    this.lastCensusLines = [];
    this.skipNextFrameSample = false;
    for (const samples of Object.values(this.buckets)) samples.clear();
    this.lastSnapshot = null;
    this.netPipelineSource = null;
    this.heapSawtooth.reset();
    this.worstWindow.drain();
    this.inputIntents = 0;
    this.lastInputAt = 0;
    this.lastInputKind = '';
    this.pendingFrameAt = 0;
    this.pendingSendAt = 0;
    this.pendingVisibleAt = 0;
    this.inputToFrameMs.clear();
    this.inputToSendMs.clear();
    this.inputToEchoMs.clear();
    this.inputToVisibleMs.clear();
    this.longTaskMs.clear();
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
    this.overlay.addEventListener('click', () => this.copyReport());
    this.overlayText = document.createElement('div');
    this.overlayText.textContent = 'perf: collecting...';
    this.overlay.appendChild(this.overlayText);
    const censusBtn = document.createElement('div');
    censusBtn.textContent = '[run scene census]';
    censusBtn.title =
      'One-shot per-system draw breakdown (a short burst of extra renders, results in the overlay + console JSON)';
    censusBtn.style.cssText =
      'margin-top:6px;cursor:pointer;color:#93c5fd;text-decoration:underline';
    censusBtn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      this.runSceneCensus();
    });
    this.overlay.appendChild(censusBtn);
    document.body.appendChild(this.overlay);
  }

  private renderOverlay(s: PerfSnapshot): void {
    if (!this.overlay || !this.overlayText) return;
    const r = s.renderer;
    const hud = s.hud;
    const net = s.network;
    const gltf = s.assets.byType.gltf;
    const hdr = s.assets.byType.hdr;
    const tex = s.assets.byType.texture;
    const rp = r?.phaseMs;
    const lt = s.browser.longTasks;
    const mem = s.browser.memory;
    const h = s.hitches;
    const hitchLine = h
      ? `hitch ${h.hitches} (compile ${h.byCause['shader-compile']} tex ${h.byCause['texture-upload']} view ${h.byCause['view-create']} other ${h.byCause.other})  prog +${h.programsAdded}`
      : null;
    const censusLines = this.lastCensusLines;
    this.overlayText.textContent = [
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
      net
        ? `net ${net.connected ? 'up' : 'down'} snap ${net.snapInterval}ms age ${net.lastSnapAge}ms a ${net.alpha}`
        : 'net offline',
      ...(hitchLine ? [hitchLine] : []),
      ...censusLines,
      'click: copy json',
    ].join('\n');
  }
}

export function createPerfMonitor(renderer: Renderer | null): PerfMonitor {
  return new PerfMonitor(renderer);
}
