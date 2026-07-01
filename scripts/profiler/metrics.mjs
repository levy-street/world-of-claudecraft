// Pure performance-metric math for the profiler. No DOM, no puppeteer - every
// input is plain data, so it unit-tests directly (tests/profiler_metrics.test.ts)
// and is shared by the CLI today and an MCP server later.

const round = (v, d = 2) => {
  if (!Number.isFinite(v)) return 0;
  const m = 10 ** d;
  return Math.round(v * m) / m;
};

/**
 * State-of-the-art frame-time stats from a raw per-frame duration array (ms).
 * Beyond mean FPS this reports the percentiles and the gamer-standard 1%/0.1%
 * lows (the mean of the slowest 1%/0.1% of frames, expressed as FPS) plus jank
 * and stutter counts - these capture perceived smoothness that an average hides.
 *
 * @param deltasMs per-frame durations in milliseconds
 * @param targetFps the frame budget to judge jank against (default 60)
 */
export function frameStats(deltasMs, targetFps = 60) {
  const d = (deltasMs ?? []).filter((x) => Number.isFinite(x) && x > 0);
  const n = d.length;
  if (n === 0) return null;
  const sorted = [...d].sort((a, b) => a - b);
  const sum = d.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = d.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const pctMs = (p) => sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  // mean of the slowest `frac` of frames -> FPS (the "1% low" / "0.1% low")
  const lowFps = (frac) => {
    const k = Math.max(1, Math.ceil(n * frac));
    const worst = sorted.slice(n - k);
    const avg = worst.reduce((a, b) => a + b, 0) / k;
    return avg > 0 ? 1000 / avg : 0;
  };
  const budgetMs = 1000 / targetFps;
  const jank = d.filter((x) => x > budgetMs * 1.5).length; // >1.5x budget = visible hitch
  const long50 = d.filter((x) => x >= 50).length; // classic "long frame"
  const stutter100 = d.filter((x) => x >= 100).length; // hard stalls
  return {
    frames: n,
    seconds: round(sum / 1000, 2),
    fpsMean: round(1000 / mean, 1),
    fpsMedian: round(1000 / pctMs(0.5), 1),
    fpsLow1: round(lowFps(0.01), 1), // 1% low (worst 1% of frames)
    fpsLow01: round(lowFps(0.001), 1), // 0.1% low
    meanMs: round(mean, 2),
    p50Ms: round(pctMs(0.5), 2),
    p95Ms: round(pctMs(0.95), 2),
    p99Ms: round(pctMs(0.99), 2),
    p999Ms: round(pctMs(0.999), 2),
    maxMs: round(sorted[n - 1], 2),
    stdevMs: round(stdev, 2), // frame-time consistency (lower = smoother)
    jankPct: round((100 * jank) / n, 2), // % of frames over 1.5x budget
    long50, // frames >= 50ms
    stutter100, // frames >= 100ms
  };
}

/**
 * Per-frame freeze attribution. Given per-frame samples that each carry the
 * cumulative WebGL program (shader) count and created-view count, find the worst
 * frames and attribute each to a likely cause: a shader program that linked this
 * frame (compile stall), a character view that was built, or "other" (GC/upload/
 * CPU). This is what turns "there was a 250ms hitch" into "it compiled 3 shaders".
 *
 * @param samples array of { dt, programs, createdViews, longTaskMs? }
 * @param topN how many worst frames to return
 */
export function attributeFreezes(samples, topN = 8, hitchMs = 50) {
  const s = (samples ?? []).filter((x) => x && Number.isFinite(x.dt));
  const events = [];
  for (let i = 1; i < s.length; i++) {
    const cur = s[i];
    const prev = s[i - 1];
    if (cur.dt < hitchMs) continue;
    const programDelta = Math.max(0, (cur.programs ?? 0) - (prev.programs ?? 0));
    const viewDelta = Math.max(0, (cur.createdViews ?? 0) - (prev.createdViews ?? 0));
    const texDelta = Math.max(0, (cur.textures ?? 0) - (prev.textures ?? 0));
    const geoDelta = Math.max(0, (cur.geometries ?? 0) - (prev.geometries ?? 0));
    const cause =
      programDelta > 0
        ? 'shader-compile' // a WebGL program linked (the worst, fully synchronous)
        : viewDelta > 0
          ? 'view-build' // a character rig was instantiated
          : texDelta > 0 || geoDelta > 0
            ? 'asset-upload' // texture/geometry streamed to the GPU
            : cur.longTaskMs
              ? 'long-task' // a main-thread long task (JS/GC)
              : 'other';
    events.push({
      frame: i,
      ms: round(cur.dt, 1),
      programDelta,
      viewDelta,
      texDelta,
      geoDelta,
      longTaskMs: round(cur.longTaskMs ?? 0, 1),
      cause,
    });
  }
  events.sort((a, b) => b.ms - a.ms);
  const byCause = {};
  for (const e of events) byCause[e.cause] = (byCause[e.cause] ?? 0) + 1;
  return {
    hitchCount: events.length,
    worstMs: events[0]?.ms ?? 0,
    byCause,
    worst: events.slice(0, topN),
  };
}

/** Flatten a window.__game.perf.report() into a stable, comparable metric set. */
export function normalizeReport(report) {
  const r = report ?? {};
  const w10 = r.windows?.last10s ?? {};
  const rr = r.renderer ?? {};
  const fol = rr.foliage ?? {};
  const budget = rr.renderBudget ?? {};
  const lt = r.browser?.longTasks ?? {};
  const mem = r.browser?.memory ?? {};
  const phase = rr.phaseMs ?? {};
  const ph = (k) => round(phase[k]?.avg ?? phase[k] ?? 0, 2);
  const main = r.mainMs ?? {};
  const mn = (k) => round(main[k]?.avg ?? 0, 2);
  return {
    fps: round(r.fps ?? 0, 1),
    fps10s: round(w10.fps ?? 0, 1),
    frameP95: round(r.frameMs?.p95 ?? 0, 2),
    frameP99: round(r.frameMs?.p99 ?? 0, 2),
    frameMax: round(r.frameMs?.max ?? 0, 2),
    long50: r.frameMs?.long50 ?? 0,
    tier: rr.tier ?? '',
    renderScale: round(rr.effectiveRenderScale ?? 0, 3),
    calls: rr.calls ?? 0,
    triangles: rr.triangles ?? 0,
    programs: rr.programs ?? 0,
    textures: rr.textures ?? 0,
    views: rr.views ?? 0,
    entities: r.entities ?? null,
    grassTufts: fol.grassVisibleTufts ?? 0,
    foliageDraws: fol.modelVisibleDraws ?? 0,
    foliageTris: fol.modelVisibleTriangles ?? 0,
    phaseEntitiesMs: ph('entities'),
    phaseWorldMs: ph('world'),
    phaseSubmitMs: ph('submit'),
    phaseTotalMs: ph('total'),
    mainSimMs: mn('sim'),
    mainRendererMs: mn('renderer'),
    mainHudMs: mn('hud'),
    longTaskCount: lt.count ?? 0,
    longTaskP95: round(lt.p95 ?? 0, 1),
    longTaskMax: round(lt.max ?? 0, 1),
    heapUsedMb: round(mem.usedMB ?? 0, 1),
    heapLimitMb: round(mem.limitMB ?? 0, 1),
    budgetMode: budget.mode ?? '',
    budgetReason: budget.reason ?? '',
    budgetPressure: round(budget.pressure ?? 0, 2),
    autoGovernor: rr.autoGovernor ?? false,
  };
}

const PCT_KEYS = new Set([
  'fps',
  'fps10s',
  'fpsMean',
  'fpsMedian',
  'fpsLow1',
  'fpsLow01',
  'frameP95',
  'frameP99',
  'frameMax',
  'meanMs',
  'p95Ms',
  'p99Ms',
  'maxMs',
  'stdevMs',
  'calls',
  'triangles',
  'programs',
  'views',
  'foliageDraws',
  'foliageTris',
  'phaseSubmitMs',
  'phaseEntitiesMs',
  'phaseTotalMs',
  'mainRendererMs',
  'heapUsedMb',
  'long50',
  'jankPct',
]);

/**
 * Diff two flat metric sets (before/after a change). Reports the absolute and
 * percent delta and a verdict per key (FPS-like keys: up is better; ms/count
 * keys: down is better), so an A/B run reads at a glance.
 */
export function diffMetrics(before, after, keys) {
  const ks = keys ?? [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const higherBetter = new Set([
    'fps',
    'fps10s',
    'fpsMean',
    'fpsMedian',
    'fpsLow1',
    'fpsLow01',
    'renderScale',
  ]);
  const out = {};
  for (const k of ks) {
    const a = before?.[k];
    const b = after?.[k];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const delta = round(b - a, 2);
    const pct = a !== 0 ? round((100 * (b - a)) / Math.abs(a), 1) : 0;
    const better = delta === 0 ? 'same' : higherBetter.has(k) === delta > 0 ? 'better' : 'worse';
    out[k] = { before: a, after: b, delta, pct, better };
  }
  return out;
}

export const profilerMetricsInternals = { round, PCT_KEYS };
