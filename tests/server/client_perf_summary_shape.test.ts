// Pure coverage for server/client_perf_summary_shape.ts: the row mapper that
// rebuilds the client-perf summary response from the flat GROUPING SETS rows
// (classification by GROUPING() bits, ordering by the Postgres-computed rank
// ints, per-array cap slicing, the String(value ?? '') key fold, and the
// empty-window shape), plus the cleanHours clamp both perf reads share. No
// Postgres and no mocks: the module is host-agnostic by design.

import { describe, expect, it } from 'vitest';
import {
  type ClientPerfSummaryRow,
  cleanHours,
  mapClientPerfSummaryRows,
  mapSuggestionCountRows,
  PERF_SUMMARY_LIMITS,
  type PerfSuggestionCountRow,
  perfAggregateFromRow,
} from '../../server/client_perf_summary_shape';

// Fixture rows are typed with the module's documented row contract, so
// ClientPerfSummaryRow stays compile-checked against what the tests feed in.
type Row = ClientPerfSummaryRow;
type AggColumns = Pick<
  Row,
  | 'sample_count'
  | 'median_fps'
  | 'p95_frame_ms'
  | 'p99_frame_ms'
  | 'context_loss_count'
  | 'avg_render_scale'
  | 'avg_effective_render_scale'
>;

// Distinct recognizable aggregate values per seed so a cross-wired mapping
// (wrong row landing in the wrong slot) cannot produce a passing comparison.
function agg(seed: number): AggColumns {
  return {
    sample_count: seed,
    median_fps: seed + 0.5,
    p95_frame_ms: seed + 0.25,
    p99_frame_ms: seed + 0.75,
    context_loss_count: seed + 1,
    avg_render_scale: seed + 0.1,
    avg_effective_render_scale: seed + 0.2,
  };
}

// The camelCase aggregate the mapper should emit for agg(seed).
function expectedAgg(seed: number) {
  return {
    sampleCount: seed,
    medianFps: seed + 0.5,
    p95FrameMs: seed + 0.25,
    p99FrameMs: seed + 0.75,
    contextLossCount: seed + 1,
    avgRenderScale: seed + 0.1,
    avgEffectiveRenderScale: seed + 0.2,
  };
}

const KEY_COLUMNS = {
  preset: 'graphics_preset',
  gfxtier: 'gfx_tier',
  gpu: 'gl_renderer_bucket',
  browser: 'browser_family',
  os: 'os_family',
  scenario: 'zone_or_scenario',
  crowd: 'crowd_bucket',
} as const;

// The () set row: every GROUPING() bit rolled up (1), every key column NULL.
function totalsRow(seed: number): Row {
  return {
    graphics_preset: null,
    gfx_tier: null,
    gl_renderer_bucket: null,
    browser_family: null,
    os_family: null,
    zone_or_scenario: null,
    crowd_bucket: null,
    g_preset: 1,
    g_gfxtier: 1,
    g_gpu: 1,
    g_browser: 1,
    g_os: 1,
    g_scenario: 1,
    g_crowd: 1,
    vol_rank: 1,
    worst_rank: 1,
    ...agg(seed),
  };
}

// A single-column grouping-set row: exactly one bit at 0, its key column set.
function bucketRow(
  set: keyof typeof KEY_COLUMNS,
  key: string | null,
  volRank: number,
  worstRank: number,
  seed: number,
): Row {
  const row = totalsRow(seed);
  row[`g_${set}`] = 0;
  row[KEY_COLUMNS[set]] = key;
  row.vol_rank = volRank;
  row.worst_rank = worstRank;
  return row;
}

describe('mapClientPerfSummaryRows classification', () => {
  it('routes rows by GROUPING bits alone: an empty-string key is a bucket, the all-rolled-up row is totals', () => {
    // The '' preset key would read as falsy or be confused with a rolled-up NULL
    // under key-based classification; the bits keep the two apart.
    const out = mapClientPerfSummaryRows([
      bucketRow('preset', '', 1, 1, 3),
      totalsRow(9),
      bucketRow('gpu', 'adreno', 1, 1, 4),
      bucketRow('browser', 'Chrome', 1, 1, 5),
      bucketRow('os', 'Windows', 1, 1, 6),
      bucketRow('scenario', 'elwynn', 1, 1, 7),
      bucketRow('crowd', '25-49', 1, 1, 8),
      bucketRow('gfxtier', 'ultra', 1, 1, 10),
    ]);
    expect(out.totals).toEqual(expectedAgg(9));
    expect(out.byPreset).toEqual([{ key: '', ...expectedAgg(3) }]);
    expect(out.byGpu).toEqual([{ key: 'adreno', ...expectedAgg(4) }]);
    expect(out.byBrowser).toEqual([{ key: 'Chrome', ...expectedAgg(5) }]);
    expect(out.byOs).toEqual([{ key: 'Windows', ...expectedAgg(6) }]);
    expect(out.byScenario).toEqual([{ key: 'elwynn', ...expectedAgg(7) }]);
    expect(out.byCrowd).toEqual([{ key: '25-49', ...expectedAgg(8) }]);
    expect(out.worstGpuBuckets).toEqual([{ key: 'adreno', ...expectedAgg(4) }]);
    expect(out.byGfxTier).toEqual([{ key: 'ultra', ...expectedAgg(10) }]);
  });

  it('folds the legacy empty-string crowd key to unknown at read time, and ONLY there', () => {
    // Pre-column rows aggregate under crowd_bucket '' (ruling R3); the mapper
    // relabels them 'unknown' without merging them into the real unknown
    // bucket (percentiles do not compose), while every other list keeps ''
    // as-is (the preset '' key is legitimate data).
    const out = mapClientPerfSummaryRows([
      bucketRow('crowd', '', 1, 1, 3),
      bucketRow('crowd', 'unknown', 2, 2, 4),
      bucketRow('preset', '', 1, 1, 5),
    ]);
    expect(out.byCrowd).toEqual([
      { key: 'unknown', ...expectedAgg(3) },
      { key: 'unknown', ...expectedAgg(4) },
    ]);
    expect(out.byPreset).toEqual([{ key: '', ...expectedAgg(5) }]);
  });

  it('returns the totals row as-is, never rebuilt from the bucket rows', () => {
    // Percentiles do not compose, so totals must be the () row verbatim even when
    // its values disagree with any recombination of the buckets.
    const out = mapClientPerfSummaryRows([
      totalsRow(100),
      bucketRow('preset', 'high', 1, 1, 1),
      bucketRow('preset', 'low', 2, 2, 2),
    ]);
    expect(out.totals).toEqual({
      sampleCount: 100,
      medianFps: 100.5,
      p95FrameMs: 100.25,
      p99FrameMs: 100.75,
      contextLossCount: 101,
      avgRenderScale: 100.1,
      avgEffectiveRenderScale: 100.2,
    });
  });

  it('folds a defensive NULL bucket key to the empty string', () => {
    const out = mapClientPerfSummaryRows([bucketRow('preset', null, 1, 1, 2)]);
    expect(out.byPreset).toEqual([{ key: '', ...expectedAgg(2) }]);
  });

  it('routes a gfx_tier row by its own bit, distinct from graphics_preset', () => {
    // gfx_tier and graphics_preset are two independent segmentation columns on
    // the same table; a row grouped by one must never be misread as the other.
    const out = mapClientPerfSummaryRows([
      bucketRow('gfxtier', 'low', 1, 1, 11),
      bucketRow('preset', 'low', 1, 1, 12),
    ]);
    expect(out.byGfxTier).toEqual([{ key: 'low', ...expectedAgg(11) }]);
    expect(out.byPreset).toEqual([{ key: 'low', ...expectedAgg(12) }]);
  });
});

describe('mapClientPerfSummaryRows ordering', () => {
  it('orders by the rank ints, never by comparing key strings in JS', () => {
    // 'zeta' outranks 'alpha' by volume; a lexicographic sort would flip them.
    // Input arrives in neither order.
    const out = mapClientPerfSummaryRows([
      bucketRow('browser', 'alpha', 2, 1, 1),
      bucketRow('browser', 'zeta', 1, 2, 2),
    ]);
    expect(out.byBrowser.map((b) => b.key)).toEqual(['zeta', 'alpha']);
  });

  it('orders byGfxTier by the volume rank, same as every other single-column set', () => {
    const out = mapClientPerfSummaryRows([
      bucketRow('gfxtier', 'insane', 2, 1, 1),
      bucketRow('gfxtier', 'medium', 1, 2, 2),
    ]);
    expect(out.byGfxTier.map((b) => b.key)).toEqual(['medium', 'insane']);
  });

  it('serves byGpu and worstGpuBuckets from the SAME gpu rows under their own rank each', () => {
    // 50 volume-ranked gpu buckets plus one low-volume bucket whose worst-p95
    // rank is 1: the volume cap alone would drop it, the worst rank surfaces it.
    const pad = (n: number): string => String(n).padStart(2, '0');
    const rows: Row[] = [bucketRow('gpu', 'gpu-lowvol-worst', 51, 1, 999)];
    for (let i = 50; i >= 1; i--) {
      rows.push(bucketRow('gpu', `gpu-${pad(i)}`, i, i + 1, i));
    }
    const out = mapClientPerfSummaryRows(rows);
    expect(out.byGpu).toHaveLength(50);
    expect(out.byGpu[0].key).toBe('gpu-01');
    expect(out.byGpu[49].key).toBe('gpu-50');
    expect(out.byGpu.map((b) => b.key)).not.toContain('gpu-lowvol-worst');
    expect(out.worstGpuBuckets).toHaveLength(20);
    expect(out.worstGpuBuckets[0]).toEqual({ key: 'gpu-lowvol-worst', ...expectedAgg(999) });
    expect(out.worstGpuBuckets.slice(1).map((b) => b.key)).toEqual(
      Array.from({ length: 19 }, (_, i) => `gpu-${pad(i + 1)}`),
    );
    // Same bucket, two lists: equal by value but never the same object, so an
    // in-process mutation of one list can never bleed into the other.
    expect(out.byGpu[0]).toEqual(out.worstGpuBuckets[1]);
    expect(out.byGpu[0]).not.toBe(out.worstGpuBuckets[1]);
  });
});

describe('mapClientPerfSummaryRows caps', () => {
  it('slices each bucket array at its cap, keeping the boundary rank and dropping the next', () => {
    const rows: Row[] = [];
    for (let i = 1; i <= 22; i++) rows.push(bucketRow('preset', `p${i}`, i, i, i));
    for (let i = 1; i <= 32; i++) rows.push(bucketRow('scenario', `z${i}`, i, i, i));
    for (let i = 1; i <= 21; i++) rows.push(bucketRow('os', `o${i}`, i, i, i));
    for (let i = 1; i <= 22; i++) rows.push(bucketRow('browser', `b${i}`, i, i, i));
    for (let i = 1; i <= 10; i++) rows.push(bucketRow('crowd', `c${i}`, i, i, i));
    for (let i = 1; i <= 22; i++) rows.push(bucketRow('gfxtier', `t${i}`, i, i, i));
    const out = mapClientPerfSummaryRows(rows);
    expect(out.byPreset).toHaveLength(20);
    expect(out.byPreset[19].key).toBe('p20');
    expect(out.byPreset.map((b) => b.key)).not.toContain('p21');
    expect(out.byScenario).toHaveLength(30);
    expect(out.byScenario[29].key).toBe('z30');
    expect(out.byScenario.map((b) => b.key)).not.toContain('z31');
    expect(out.byOs).toHaveLength(20);
    expect(out.byOs.map((b) => b.key)).not.toContain('o21');
    expect(out.byBrowser).toHaveLength(20);
    expect(out.byBrowser[19].key).toBe('b20');
    expect(out.byBrowser.map((b) => b.key)).not.toContain('b21');
    expect(out.byCrowd).toHaveLength(8);
    expect(out.byCrowd[7].key).toBe('c8');
    expect(out.byCrowd.map((b) => b.key)).not.toContain('c9');
    expect(out.byGfxTier).toHaveLength(20);
    expect(out.byGfxTier[19].key).toBe('t20');
    expect(out.byGfxTier.map((b) => b.key)).not.toContain('t21');
  });

  it('pins the per-array caps to the literal numbers the admin lists show', () => {
    expect(PERF_SUMMARY_LIMITS).toEqual({
      byPreset: 20,
      byGfxTier: 20,
      byGpu: 50,
      byBrowser: 20,
      byOs: 20,
      byScenario: 30,
      byCrowd: 8,
      worstGpu: 20,
      suggestionCounts: 12,
    });
  });
});

describe('mapSuggestionCountRows', () => {
  it('maps the unnest rows preserving the statement order', () => {
    const rows: PerfSuggestionCountRow[] = [
      { suggestion_id: 'hardware-acceleration', sample_count: 9 },
      { suggestion_id: 'integrated-gpu', sample_count: 4 },
    ];
    expect(mapSuggestionCountRows(rows)).toEqual([
      { id: 'hardware-acceleration', sampleCount: 9 },
      { id: 'integrated-gpu', sampleCount: 4 },
    ]);
  });

  it('caps defensively at the suggestionCounts limit, keeping the boundary row', () => {
    const rows: PerfSuggestionCountRow[] = [];
    for (let i = 1; i <= 14; i++) rows.push({ suggestion_id: `s${i}`, sample_count: 100 - i });
    const out = mapSuggestionCountRows(rows);
    expect(out).toHaveLength(12);
    expect(out[11]).toEqual({ id: 's12', sampleCount: 88 });
    expect(out.map((c) => c.id)).not.toContain('s13');
  });

  it('folds a defensive NULL id to the empty string and a missing count to zero', () => {
    expect(mapSuggestionCountRows([{ suggestion_id: null, sample_count: 3 }, {}])).toEqual([
      { id: '', sampleCount: 3 },
      { id: '', sampleCount: 0 },
    ]);
  });

  it('yields an empty list for an empty window', () => {
    expect(mapSuggestionCountRows([])).toEqual([]);
  });
});

describe('mapClientPerfSummaryRows empty window', () => {
  it('yields all-zero totals and empty arrays when no rows arrive', () => {
    const out = mapClientPerfSummaryRows([]);
    expect(out.totals).toEqual({
      sampleCount: 0,
      medianFps: 0,
      p95FrameMs: 0,
      p99FrameMs: 0,
      contextLossCount: 0,
      avgRenderScale: 0,
      avgEffectiveRenderScale: 0,
    });
    // The no-rows fallback and an explicit empty record produce the same shape.
    expect(out.totals).toEqual(perfAggregateFromRow({}));
    expect(out.byPreset).toEqual([]);
    expect(out.byGfxTier).toEqual([]);
    expect(out.byGpu).toEqual([]);
    expect(out.byBrowser).toEqual([]);
    expect(out.byOs).toEqual([]);
    expect(out.byScenario).toEqual([]);
    expect(out.byCrowd).toEqual([]);
    expect(out.worstGpuBuckets).toEqual([]);
  });
});

describe('cleanHours', () => {
  it('clamps to whole hours in [1, 168] and defaults non-finite input to 24', () => {
    expect(cleanHours(0)).toBe(1);
    expect(cleanHours(1000)).toBe(168);
    expect(cleanHours(Number.NaN)).toBe(24);
    expect(cleanHours(24)).toBe(24);
    expect(cleanHours(7.9)).toBe(7);
  });
});
