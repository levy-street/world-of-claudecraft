// Pure response shaping for admin_db.clientPerfSummary. The DB side runs ONE
// GROUPING SETS statement over client_perf_reports: every row of the flat result
// carries the per-column GROUPING() bits that identify its grouping set, the two
// Postgres-computed window ranks (volume order and worst-p95 order), the grouped
// key column, and the seven aggregate columns. This module rebuilds the summary
// response from those rows. Host-agnostic on purpose: no SQL and no database
// import, so Vitest exercises classification, ordering, and slicing directly.

export interface PerfAggregate {
  sampleCount: number;
  medianFps: number;
  p95FrameMs: number;
  p99FrameMs: number;
  contextLossCount: number;
  avgRenderScale: number;
  avgEffectiveRenderScale: number;
}

export interface PerfBucket extends PerfAggregate {
  key: string;
}

export interface ClientPerfSummaryBuckets {
  totals: PerfAggregate;
  byPreset: PerfBucket[];
  byGpu: PerfBucket[];
  byBrowser: PerfBucket[];
  byOs: PerfBucket[];
  byScenario: PerfBucket[];
  worstGpuBuckets: PerfBucket[];
}

// Per-array caps. The SQL interpolates these same numbers into its per-set rank
// filter (the defensive cap on what crosses to Node) and the mapper slices with
// them, so the two sides can never drift apart. Frozen because the numbers are
// interpolated into SQL text: runtime mutation must be structurally impossible.
export const PERF_SUMMARY_LIMITS = Object.freeze({
  byPreset: 20,
  byGpu: 50,
  byBrowser: 20,
  byOs: 20,
  byScenario: 30,
  worstGpu: 20,
} as const);

// Clamp an admin-supplied hours window to whole hours in [1, 168]; a non-finite
// input falls back to the 24h default. Shared by clientPerfSummary and clientPerfRaw.
export function cleanHours(hours: number): number {
  return Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.floor(hours))) : 24;
}

// One flat row of the GROUPING SETS result, as the reading contract the mapper
// relies on. The g_* fields are GROUPING() bits: 1 means the column is rolled up
// in this row's grouping set, 0 means the row is grouped by that column. Exactly
// one bit is 0 on a bucket row; all five are 1 on the totals row. The shape and
// SQL suites type their fixture rows with this contract, so it stays
// compile-checked against what the tests feed the mapper.
export type ClientPerfSummaryRow = {
  graphics_preset: string | null;
  gl_renderer_bucket: string | null;
  browser_family: string | null;
  os_family: string | null;
  zone_or_scenario: string | null;
  g_preset: number;
  g_gpu: number;
  g_browser: number;
  g_os: number;
  g_scenario: number;
  vol_rank: number;
  worst_rank: number;
  sample_count: number;
  median_fps: number;
  p95_frame_ms: number;
  p99_frame_ms: number;
  context_loss_count: number;
  avg_render_scale: number;
  avg_effective_render_scale: number;
};

// The one canonical snake_case-to-camelCase aggregate mapping (formerly private
// to admin_db). An absent field folds to 0, which also makes an empty record
// produce the all-zeros empty-window totals shape.
export function perfAggregateFromRow(r: Record<string, unknown>): PerfAggregate {
  return {
    sampleCount: Number(r.sample_count ?? 0),
    medianFps: Number(r.median_fps ?? 0),
    p95FrameMs: Number(r.p95_frame_ms ?? 0),
    p99FrameMs: Number(r.p99_frame_ms ?? 0),
    contextLossCount: Number(r.context_loss_count ?? 0),
    avgRenderScale: Number(r.avg_render_scale ?? 0),
    avgEffectiveRenderScale: Number(r.avg_effective_render_scale ?? 0),
  };
}

// Which GROUPING() bit routes a row to which bucket list, and which column
// carries the row's key when that bit is 0.
const BUCKET_SETS = [
  { bit: 'g_preset', column: 'graphics_preset', list: 'byPreset' },
  { bit: 'g_gpu', column: 'gl_renderer_bucket', list: 'byGpu' },
  { bit: 'g_browser', column: 'browser_family', list: 'byBrowser' },
  { bit: 'g_os', column: 'os_family', list: 'byOs' },
  { bit: 'g_scenario', column: 'zone_or_scenario', list: 'byScenario' },
] as const;

type BucketListName = (typeof BUCKET_SETS)[number]['list'];

interface RankedBucket {
  volRank: number;
  worstRank: number;
  bucket: PerfBucket;
}

// Rebuild the summary body from the flat GROUPING SETS rows. Classification uses
// ONLY the GROUPING() bits: every grouped column is TEXT NOT NULL DEFAULT '', so
// a data key of '' must never be confused with a rolled-up NULL. Ordering uses
// ONLY the Postgres-computed rank ints: the volume tie-break (key ASC) follows
// the database text collation, which a JS string sort does not reproduce for
// non-ASCII keys. The totals row (the () set) is returned as-is, never rebuilt
// from the buckets: percentiles do not compose. The gl_renderer_bucket set feeds
// BOTH byGpu (volume order) and worstGpuBuckets (worst-p95 order).
export function mapClientPerfSummaryRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): ClientPerfSummaryBuckets {
  let totals: PerfAggregate | null = null;
  const ranked: Record<BucketListName, RankedBucket[]> = {
    byPreset: [],
    byGpu: [],
    byBrowser: [],
    byOs: [],
    byScenario: [],
  };
  for (const r of rows) {
    const set = BUCKET_SETS.find((s) => Number(r[s.bit]) === 0);
    if (!set) {
      // All five bits rolled up: the () grouping set, i.e. the totals row.
      totals = perfAggregateFromRow(r);
      continue;
    }
    ranked[set.list].push({
      volRank: Number(r.vol_rank),
      worstRank: Number(r.worst_rank),
      // Defensive fold: a data row never carries a NULL key (NOT NULL DEFAULT ''),
      // but the mapping mirrors the String(value ?? '') contract regardless.
      bucket: { key: String(r[set.column] ?? ''), ...perfAggregateFromRow(r) },
    });
  }
  const byRank = (
    list: RankedBucket[],
    rank: 'volRank' | 'worstRank',
    limit: number,
  ): PerfBucket[] =>
    [...list]
      .sort((a, b) => a[rank] - b[rank])
      .slice(0, limit)
      // Fresh object per list: a gpu bucket appears in BOTH byGpu and
      // worstGpuBuckets, and a shared reference would couple later mutations.
      .map((e) => ({ ...e.bucket }));
  return {
    // An empty window still yields the () row (a grand aggregate over zero input
    // rows produces one row), so this fallback only guards a statement that
    // returned no rows at all; both paths give the same all-zeros shape.
    totals: totals ?? perfAggregateFromRow({}),
    byPreset: byRank(ranked.byPreset, 'volRank', PERF_SUMMARY_LIMITS.byPreset),
    byGpu: byRank(ranked.byGpu, 'volRank', PERF_SUMMARY_LIMITS.byGpu),
    byBrowser: byRank(ranked.byBrowser, 'volRank', PERF_SUMMARY_LIMITS.byBrowser),
    byOs: byRank(ranked.byOs, 'volRank', PERF_SUMMARY_LIMITS.byOs),
    byScenario: byRank(ranked.byScenario, 'volRank', PERF_SUMMARY_LIMITS.byScenario),
    worstGpuBuckets: byRank(ranked.byGpu, 'worstRank', PERF_SUMMARY_LIMITS.worstGpu),
  };
}
