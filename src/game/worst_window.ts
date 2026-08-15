// Rolling worst-10s tracker for fleet perf reports (packet 0 ruling R5).
// A 5-minute cumulative report dilutes a discrete hitch storm and the frame
// ring evicts it outright, so this module keeps the WORST 10-second window
// observed since the last drain: worst-per-report-interval semantics. The
// host (PerfMonitor) calls observe() from its 1 Hz tick; snapshot() stays a
// pure read of current(); the REPORTER drains after a successful send via
// PerfMonitor.drainWorstWindow(). Pure module: no clocks, no DOM; every
// timestamp rides in through arguments.

export interface WorstWindowFrameSample {
  at: number;
  ms: number;
}

export interface WorstWindowSummary {
  atMs: number;
  seconds: number;
  frames: number;
  fps: number;
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number; long50: number };
}

const DEFAULT_WINDOW_MS = 10_000;

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function summarizeWindow(
  samples: readonly WorstWindowFrameSample[],
  now: number,
  windowMs: number,
): WorstWindowSummary | null {
  const inWindow = samples.filter((s) => now - s.at <= windowMs);
  if (inWindow.length === 0) return null;
  const values = inWindow.map((s) => s.ms);
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  const span =
    inWindow.length > 1
      ? Math.max(0.001, (inWindow[inWindow.length - 1].at - inWindow[0].at) / 1000)
      : windowMs / 1000;
  return {
    atMs: round(now),
    seconds: round(Math.min(windowMs / 1000, span)),
    frames: inWindow.length,
    fps: round(inWindow.length / Math.max(0.001, span)),
    frameMs: {
      avg: round(total / values.length),
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
      max: round(sorted[sorted.length - 1]),
      long50: values.filter((v) => v >= 50).length,
    },
  };
}

export interface WorstWindow {
  /** Evaluate the trailing window at `now` and retain it if it is the worst
   *  (highest frameMs p95) since the last drain. Called at 1 Hz by the host. */
  observe(samples: readonly WorstWindowFrameSample[], now: number): void;
  /** The worst window since the last drain; null before the first evaluation. */
  current(): WorstWindowSummary | null;
  /** Reset the interval: the reporter calls this only after a SUCCESSFUL send. */
  drain(): void;
}

export function createWorstWindow(windowMs = DEFAULT_WINDOW_MS): WorstWindow {
  let worst: WorstWindowSummary | null = null;
  return {
    observe(samples, now) {
      const summary = summarizeWindow(samples, now, windowMs);
      if (!summary) return;
      if (worst === null || summary.frameMs.p95 > worst.frameMs.p95) worst = summary;
    },
    current() {
      return worst;
    },
    drain() {
      worst = null;
    },
  };
}
