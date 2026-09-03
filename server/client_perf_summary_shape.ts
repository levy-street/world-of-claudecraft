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

// The GPU model dimensions, which are PAIRS rather than single columns, so they
// cannot ride the single-bit GROUPING contract below and get their own bounded
// statement instead. byModel is (os_family, gl_model): the same card behaves
// differently under different drivers, so the OS is part of the key. Explicit
// named fields rather than one joined `key` because a reader segments on either
// half, and re-splitting a composite string at read time invites a delimiter bug.
export interface PerfModelBucket extends PerfAggregate {
  osFamily: string;
  glModel: string;
}

// byHpMismatch adds the WebGPU high-performance adapter's family, and holds ONLY
// the rows whose VENDOR differs from glModel's: the page is rendering on one
// vendor's GPU while the machine offers another's. Vendor granularity rather
// than the whole key because that is as far as a browser's adapter info
// reliably goes (Chrome hands a normal page {vendor, architecture} and leaves
// device and description empty), so a model-level comparison would call every
// single-GPU Chrome client a mismatch; the reason is spelled out at the
// statement in server/admin_db.ts. The statement filters the adapter-less rows,
// the unparsed ones, and the agreeing ones out before ranking, so the list
// means what its name says and its cap can never truncate the signal in favour
// of agreement. An empty list therefore means "no mismatch reported", and the
// agreeing population is not counted here at all (byModel is the denominator).
export interface PerfHpAdapterBucket extends PerfModelBucket {
  gpuHpAdapter: string;
}

export interface ClientPerfSummaryBuckets {
  totals: PerfAggregate;
  byPreset: PerfBucket[];
  byGfxTier: PerfBucket[];
  byGpu: PerfBucket[];
  byBrowser: PerfBucket[];
  byOs: PerfBucket[];
  byScenario: PerfBucket[];
  byCrowd: PerfBucket[];
  worstGpuBuckets: PerfBucket[];
}

// One perf-doctor suggestion id with the number of reports that carried it in
// the window (ruling R14). Produced by the summary's SECOND bounded statement
// (an unnest over suggestion_ids), not the GROUPING SETS roll-up: a report can
// carry up to three ids, so these counts are per-id report counts, never a
// partition of the totals row.
export interface PerfSuggestionCount {
  id: string;
  sampleCount: number;
}

// Per-array caps. The SQL interpolates these same numbers into its per-set rank
// filter (the defensive cap on what crosses to Node) and the mapper slices with
// them, so the two sides can never drift apart. Frozen because the numbers are
// interpolated into SQL text: runtime mutation must be structurally impossible.
export const PERF_SUMMARY_LIMITS = Object.freeze({
  byPreset: 20,
  // Same cap as byPreset: gfx_tier is the other half of the closed-vocabulary
  // segmentation pair (low/medium/high/ultra/insane today, see
  // choiceIn(body.gfxTier, ...) in perf_report.ts), not a high-cardinality
  // dimension like gpu or scenario.
  byGfxTier: 20,
  byGpu: 50,
  byBrowser: 20,
  byOs: 20,
  byScenario: 30,
  // Six fixed labels (ruling R3) plus the legacy '' bucket and headroom.
  byCrowd: 8,
  worstGpu: 20,
  // gl_model is higher cardinality than the vendor bucket by construction (that
  // is the point), and byModel keys on the os_family pair on top of it, so this
  // cap is what keeps the statement's result set bounded whatever the fleet
  // looks like. byHpMismatch is filtered to the adapter-carrying minority and
  // shares the cap for one reason to reason about.
  byModel: 50,
  byHpMismatch: 50,
  // Eight allowlisted suggestion ids (ruling R14) plus headroom; only
  // sanitizer-approved ids can reach the column, so this cap is defensive.
  suggestionCounts: 12,
} as const);

/**
 * Minimum reports a (os, model) group needs before the GPU model statement
 * aggregates it.
 *
 * Not a display nicety: gl_model is derived from a client-supplied renderer
 * string, so while every KEY is shape-bounded, the number of DISTINCT keys is
 * attacker-influenced. The per-set rank caps bound what crosses to Node but not
 * what Postgres sorts, so without a floor a wide spread of junk keys makes the
 * server materialize and sort hundreds of thousands of groups to return 100
 * rows. The floor makes that structural: surviving groups are at most the
 * window's row count divided by this number.
 *
 * Interpolated into SQL text, so it is a module constant, not a parameter.
 * The cost is that a group seen fewer than this many times in the window is not
 * counted; both lists are volume-ranked and capped at 50, so on a real fleet
 * such a group could never have been shown anyway, and single-report forensics
 * ride clientPerfRaw instead.
 */
export const PERF_SUMMARY_MIN_GROUP_SAMPLES = 5;

// Clamp an admin-supplied hours window to whole hours in [1, 168]; a non-finite
// input falls back to the 24h default. Shared by clientPerfSummary and clientPerfRaw.
export function cleanHours(hours: number): number {
  return Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.floor(hours))) : 24;
}

// One flat row of the GROUPING SETS result, as the reading contract the mapper
// relies on. The g_* fields are GROUPING() bits: 1 means the column is rolled up
// in this row's grouping set, 0 means the row is grouped by that column. Exactly
// one bit is 0 on a bucket row; all seven are 1 on the totals row. The shape and
// SQL suites type their fixture rows with this contract, so it stays
// compile-checked against what the tests feed the mapper.
export type ClientPerfSummaryRow = {
  graphics_preset: string | null;
  gfx_tier: string | null;
  gl_renderer_bucket: string | null;
  browser_family: string | null;
  os_family: string | null;
  zone_or_scenario: string | null;
  crowd_bucket: string | null;
  g_preset: number;
  g_gfxtier: number;
  g_gpu: number;
  g_browser: number;
  g_os: number;
  g_scenario: number;
  g_crowd: number;
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

// One flat row of the GPU model statement. g_hp is the ONE GROUPING() bit that
// separates its two sets: 1 is the (os_family, gl_model) pair set, 0 is the
// (os_family, gl_model, gpu_hp_adapter) triple set. vol_rank is computed AFTER
// the statement's own WHERE, so the triple set's rank is over adapter-carrying
// rows only and the empty-adapter majority cannot starve the list.
export type ClientPerfModelRow = {
  os_family: string | null;
  gl_model: string | null;
  gpu_hp_adapter: string | null;
  g_hp: number;
  vol_rank: number;
  sample_count: number;
  median_fps: number;
  p95_frame_ms: number;
  p99_frame_ms: number;
  context_loss_count: number;
  avg_render_scale: number;
  avg_effective_render_scale: number;
};

// One flat row of the suggestion-count statement: the unnested id plus its
// report count. Kept as a documented contract like ClientPerfSummaryRow so the
// shape and SQL suites type their fixtures against what the mapper consumes.
export type PerfSuggestionCountRow = {
  suggestion_id: string | null;
  sample_count: number;
};

/**
 * Rebuild byModel and byHpMismatch from the GPU model statement's flat rows.
 *
 * Classification is the g_hp bit alone, never the gpu_hp_adapter value: the
 * column is TEXT NOT NULL DEFAULT '', so a data key of '' must not be confused
 * with the rolled-up NULL of the pair set (the same rule the GROUPING-bits
 * mapper below follows). Ordering comes from the statement's rank; the mapper
 * only maps, sorts by that rank, and defensively caps.
 */
export function mapClientPerfModelRows(rows: ReadonlyArray<Record<string, unknown>>): {
  byModel: PerfModelBucket[];
  byHpMismatch: PerfHpAdapterBucket[];
} {
  const model: { rank: number; bucket: PerfModelBucket }[] = [];
  const mismatch: { rank: number; bucket: PerfHpAdapterBucket }[] = [];
  for (const r of rows) {
    const base = {
      osFamily: String(r.os_family ?? ''),
      glModel: String(r.gl_model ?? ''),
      ...perfAggregateFromRow(r),
    };
    const rank = Number(r.vol_rank);
    if (Number(r.g_hp) === 0) {
      mismatch.push({ rank, bucket: { ...base, gpuHpAdapter: String(r.gpu_hp_adapter ?? '') } });
    } else {
      model.push({ rank, bucket: base });
    }
  }
  const byRank = <T>(list: { rank: number; bucket: T }[], limit: number): T[] =>
    [...list]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit)
      .map((e) => ({ ...e.bucket }));
  return {
    byModel: byRank(model, PERF_SUMMARY_LIMITS.byModel),
    byHpMismatch: byRank(mismatch, PERF_SUMMARY_LIMITS.byHpMismatch),
  };
}

// Rebuild the suggestionCounts list from the flat rows. Ordering comes from the
// statement (sample_count DESC, id ASC); the mapper only maps and defensively
// caps, mirroring the byRank slice contract of the grouped lists.
export function mapSuggestionCountRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): PerfSuggestionCount[] {
  return rows.slice(0, PERF_SUMMARY_LIMITS.suggestionCounts).map((r) => ({
    id: String(r.suggestion_id ?? ''),
    sampleCount: Number(r.sample_count ?? 0),
  }));
}

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
  { bit: 'g_gfxtier', column: 'gfx_tier', list: 'byGfxTier' },
  { bit: 'g_gpu', column: 'gl_renderer_bucket', list: 'byGpu' },
  { bit: 'g_browser', column: 'browser_family', list: 'byBrowser' },
  { bit: 'g_os', column: 'os_family', list: 'byOs' },
  { bit: 'g_scenario', column: 'zone_or_scenario', list: 'byScenario' },
  { bit: 'g_crowd', column: 'crowd_bucket', list: 'byCrowd' },
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
    byGfxTier: [],
    byGpu: [],
    byBrowser: [],
    byOs: [],
    byScenario: [],
    byCrowd: [],
  };
  for (const r of rows) {
    const set = BUCKET_SETS.find((s) => Number(r[s.bit]) === 0);
    if (!set) {
      // All seven bits rolled up: the () grouping set, i.e. the totals row.
      totals = perfAggregateFromRow(r);
      continue;
    }
    // Defensive fold: a data row never carries a NULL key (NOT NULL DEFAULT ''),
    // but the mapping mirrors the String(value ?? '') contract regardless. The
    // crowd list additionally folds the legacy pre-column '' rows to 'unknown'
    // at read time (ruling R3); the '' and 'unknown' groups stay separate
    // aggregates because percentiles do not compose.
    const rawKey = String(r[set.column] ?? '');
    const key = set.list === 'byCrowd' && rawKey === '' ? 'unknown' : rawKey;
    ranked[set.list].push({
      volRank: Number(r.vol_rank),
      worstRank: Number(r.worst_rank),
      bucket: { key, ...perfAggregateFromRow(r) },
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
    byGfxTier: byRank(ranked.byGfxTier, 'volRank', PERF_SUMMARY_LIMITS.byGfxTier),
    byGpu: byRank(ranked.byGpu, 'volRank', PERF_SUMMARY_LIMITS.byGpu),
    byBrowser: byRank(ranked.byBrowser, 'volRank', PERF_SUMMARY_LIMITS.byBrowser),
    byOs: byRank(ranked.byOs, 'volRank', PERF_SUMMARY_LIMITS.byOs),
    byScenario: byRank(ranked.byScenario, 'volRank', PERF_SUMMARY_LIMITS.byScenario),
    byCrowd: byRank(ranked.byCrowd, 'volRank', PERF_SUMMARY_LIMITS.byCrowd),
    worstGpuBuckets: byRank(ranked.byGpu, 'worstRank', PERF_SUMMARY_LIMITS.worstGpu),
  };
}
