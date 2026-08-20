// Millisecond rounding and the per-phase sample rollup the renderer's frame
// and world telemetry report. Lifted out of renderer.ts unchanged: plain
// arithmetic over a number list, with no renderer state behind it, so the
// coordinator keeps only the call sites.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts).

export interface MsSummary {
  count: number;
  avg: number;
  p95: number;
  max: number;
}

/** Two decimals: the resolution every renderer stat is reported at. */
export function roundMs(v: number): number {
  return Math.round(v * 100) / 100;
}

export function summarizeMs(values: number[]): MsSummary {
  if (values.length === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return {
    count: values.length,
    avg: roundMs(total / values.length),
    p95: roundMs(sorted[p95Idx]),
    max: roundMs(sorted[sorted.length - 1]),
  };
}
