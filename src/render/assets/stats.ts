export interface AssetTimingSummary {
  count: number;
  failed: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  bytes: number;
  slowest: { url: string; ms: number; bytes: number }[];
}

export interface AssetTimingSnapshot {
  preload: {
    tasks: number;
    waitMs: number;
    complete: boolean;
  };
  byType: Record<string, AssetTimingSummary>;
  files: { type: string; url: string; ms: number; bytes: number }[];
}

interface AssetSample {
  type: string;
  url: string;
  ms: number;
  bytes: number;
  failed: boolean;
}

const samples: AssetSample[] = [];
let preloadTasks = 0;
let preloadWaitMs = 0;
let preloadComplete = false;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : 'http://local/');
    return parsed.pathname;
  } catch {
    return url;
  }
}

function resourceBytes(url: string): number {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') return 0;
  const entries = performance.getEntriesByName(url) as PerformanceResourceTiming[];
  const r = entries[entries.length - 1];
  return Math.max(0, Number(r?.transferSize || r?.encodedBodySize || 0));
}

export function assetLoadStarted(): number {
  return now();
}

export function recordAssetLoad(type: string, url: string, startedAt: number, failed = false): void {
  const ms = Math.max(0, now() - startedAt);
  samples.push({ type, url: shortUrl(url), ms, bytes: failed ? 0 : resourceBytes(url), failed });
}

export function recordPreloadWait(tasks: number, startedAt: number, complete: boolean): void {
  preloadTasks = tasks;
  preloadWaitMs = Math.max(0, now() - startedAt);
  preloadComplete = complete;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function summarize(typeSamples: AssetSample[]): AssetTimingSummary {
  const ok = typeSamples.filter((s) => !s.failed);
  const sorted = ok.map((s) => s.ms).sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  return {
    count: ok.length,
    failed: typeSamples.length - ok.length,
    avgMs: round(total / Math.max(1, sorted.length)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    bytes: ok.reduce((a, b) => a + b.bytes, 0),
    slowest: ok
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
      .map((s) => ({ url: s.url, ms: round(s.ms), bytes: s.bytes })),
  };
}

export function assetTimingSnapshot(): AssetTimingSnapshot {
  const byType: Record<string, AssetTimingSummary> = {};
  for (const s of samples) {
    byType[s.type] ??= summarize([]);
  }
  for (const type of Object.keys(byType)) {
    byType[type] = summarize(samples.filter((s) => s.type === type));
  }
  return {
    preload: { tasks: preloadTasks, waitMs: round(preloadWaitMs), complete: preloadComplete },
    byType,
    files: samples
      .filter((s) => !s.failed)
      .map((s) => ({ type: s.type, url: s.url, ms: round(s.ms), bytes: s.bytes })),
  };
}

export function resetAssetTimingForTests(): void {
  samples.length = 0;
  preloadTasks = 0;
  preloadWaitMs = 0;
  preloadComplete = false;
}
