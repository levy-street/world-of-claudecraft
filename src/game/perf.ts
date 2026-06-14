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
}

type TimedBucket = 'renderer' | 'hud' | 'events' | 'sim';
const MAX_SAMPLES = 7200; // ~2 minutes at 60fps; enough for stable p95/p99 without unbounded growth.
const MAX_WINDOW_MS = 30_000;

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

export class PerfMonitor {
  readonly enabled: boolean;
  private overlay: HTMLDivElement | null = null;
  private startedAt = performance.now();
  private lastOverlayAt = 0;
  private frames = 0;
  private frameMs: number[] = [];
  private frameWindow: FrameSample[] = [];
  private buckets: Record<TimedBucket, number[]> = { renderer: [], hud: [], events: [], sim: [] };
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

  constructor(private renderer: Renderer | null, private hud: { perfStats(): PerfSnapshot['hud'] } | null = null) {
    const params = new URLSearchParams(location.search);
    this.enabled = params.has('perf') || localStorage.getItem('woc_perf') === '1';
    if (this.enabled) {
      this.mountOverlay();
      this.observeLongTasks();
    }
  }

  setRenderer(renderer: Renderer): void {
    this.renderer = renderer;
  }

  setHud(hud: { perfStats(): PerfSnapshot['hud'] }): void {
    this.hud = hud;
  }

  frame(dt: number, now = performance.now()): void {
    if (!this.enabled) return;
    this.frames++;
    const ms = Math.min(250, Math.max(0, dt * 1000));
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
      pushSample(this.buckets[bucket], performance.now() - start);
    }
  }

  setNetwork(stats: PerfSnapshot['network']): void {
    if (!this.enabled) return;
    this.network = stats;
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

  tick(now = performance.now()): void {
    if (!this.enabled) return;
    if (now - this.lastOverlayAt < 1000) return;
    this.lastOverlayAt = now;
    this.lastSnapshot = this.snapshot(now);
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
    return {
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
