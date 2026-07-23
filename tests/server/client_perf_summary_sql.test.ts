// admin_db.clientPerfSummary's SQL collapse: the seven serialized statements
// (one totals aggregate plus six bucket reads) became ONE GROUPING SETS statement
// whose window ranks carry both orderings, with the pure shape module
// (server/client_perf_summary_shape.ts) rebuilding the response.
//
// Two layers of coverage, modeled on deeds_board_sql.test.ts:
//   1. Always-run (mocked pool): the function issues exactly ONE real statement
//      inside the raised-timeout transaction, plus decisive text pins on the
//      load-bearing SQL (the GROUPING SETS list, both window ORDER BYs, the
//      hours predicate, the per-set caps) and the canned-row response mapping.
//   2. pg-gated differential (WOCC_PG_DIFFERENTIAL=1, a reachable Postgres at
//      DATABASE_URL): the OLD seven-statement roll-up is retained below as a
//      test-side executable spec; both it and the collapsed read run against the
//      same live table and must agree field-for-field, row-for-row. Skipped in
//      normal CI (no dev Postgres), where the text pins are the guard.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_client_perf_sql';

import type { PoolClient, QueryResult } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientPerfSummary } from '../../server/admin_db';
import type { ClientPerfSummaryRow } from '../../server/client_perf_summary_shape';
import { ensureSchema, pool } from '../../server/db';

// ---------------------------------------------------------------------------
// Layer 1: always-run statement-count + text + mapping pins (mocked pool).
// ---------------------------------------------------------------------------

function queryResult(rows: unknown[]): QueryResult {
  return { command: '', rowCount: rows.length, oid: 0, fields: [], rows: rows as never[] };
}

// clientPerfSummary runs inside runWithStatementTimeout (server/db.ts): a
// dedicated pooled client issues BEGIN, SET LOCAL statement_timeout, the real
// read, then COMMIT. Stub pool.connect to a client that answers those control
// statements itself and forwards the real reads through the spied pool.query, so
// the spy captures exactly the real statements in order.
function stubStatementTimeoutConnect(): void {
  vi.spyOn(pool, 'connect').mockImplementation(
    async () =>
      ({
        query: (text: string, values?: unknown[]) =>
          text === 'BEGIN' ||
          text === 'COMMIT' ||
          text === 'ROLLBACK' ||
          text.startsWith('SET LOCAL')
            ? Promise.resolve({ rows: [] })
            : (pool.query as (t: string, v?: unknown[]) => Promise<unknown>)(text, values),
        release() {},
      }) as unknown as PoolClient,
  );
}

describe('clientPerfSummary SQL shape (mocked pool)', () => {
  beforeEach(() => {
    stubStatementTimeoutConnect();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues exactly ONE real statement, carrying the whole roll-up', async () => {
    const spy = vi.spyOn(pool, 'query').mockResolvedValue(queryResult([]) as never);
    const out = await clientPerfSummary(24);
    expect(spy).toHaveBeenCalledTimes(1);
    const sql = String(spy.mock.calls[0][0]);
    expect(spy.mock.calls[0][1]).toEqual(['24']);

    // The one statement computes the totals row and every bucket grouping.
    expect(sql).toContain('GROUP BY GROUPING SETS');
    expect(sql).toContain(
      '((), (graphics_preset), (gl_renderer_bucket), (browser_family), (os_family), (zone_or_scenario))',
    );
    expect(sql).toContain("WHERE created_at > now() - ($1 || ' hours')::interval");
    // Both orderings live in Postgres as window ranks (collation-proof: the
    // key ASC tie-break must never move into a JS string sort).
    expect(sql).toContain(
      'ORDER BY sample_count DESC, COALESCE(graphics_preset, gl_renderer_bucket, browser_family, os_family, zone_or_scenario) ASC',
    );
    expect(sql).toContain('ORDER BY p95_frame_ms DESC, sample_count DESC');
    // The deliberate quirk: p99_frame_ms is percentile 0.99 over frame_p95_ms.
    expect(sql).toContain(
      'COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p99_frame_ms',
    );
    // Every outer WHERE arm is pinned: dropping the totals arm would silently
    // fall production totals back to the mapper's all-zeros shape, and dropping
    // any bucket arm would empty that admin list, with only the env-gated
    // differential (skipped in normal CI) left to notice.
    expect(sql).toContain('(g_preset + g_gpu + g_browser + g_os + g_scenario = 5)');
    // The per-set caps bound what crosses to Node; the gpu set keeps candidates
    // for BOTH orderings so a low-volume worst-p95 bucket still surfaces.
    expect(sql).toContain('(g_preset = 0 AND vol_rank <= 20)');
    expect(sql).toContain('(g_gpu = 0 AND (vol_rank <= 50 OR worst_rank <= 20))');
    expect(sql).toContain('(g_browser = 0 AND vol_rank <= 20)');
    expect(sql).toContain('(g_os = 0 AND vol_rank <= 20)');
    expect(sql).toContain('(g_scenario = 0 AND vol_rank <= 30)');

    // An empty result still shapes a full response.
    expect(out.hours).toBe(24);
    expect(out.totals.sampleCount).toBe(0);
    expect(out.byGpu).toEqual([]);
  });

  it('clamps the hours window before it reaches SQL', async () => {
    const spy = vi.spyOn(pool, 'query').mockResolvedValue(queryResult([]) as never);
    await clientPerfSummary(0);
    expect(spy.mock.calls[0][1]).toEqual(['1']);
    await clientPerfSummary(1000);
    expect(spy.mock.calls[1][1]).toEqual(['168']);
  });

  it('maps canned GROUPING SETS rows through the ranks into the response arrays', async () => {
    // Typed with the shape module's row contract so this canned fixture cannot
    // silently drift from what the mapper documents itself as consuming.
    const base: ClientPerfSummaryRow = {
      graphics_preset: null,
      gl_renderer_bucket: null,
      browser_family: null,
      os_family: null,
      zone_or_scenario: null,
      g_preset: 1,
      g_gpu: 1,
      g_browser: 1,
      g_os: 1,
      g_scenario: 1,
      vol_rank: 1,
      worst_rank: 1,
      sample_count: 12,
      median_fps: 58.5,
      p95_frame_ms: 22.5,
      p99_frame_ms: 31.25,
      context_loss_count: 1,
      avg_render_scale: 0.9,
      avg_effective_render_scale: 0.85,
    };
    vi.spyOn(pool, 'query').mockResolvedValue(
      queryResult([
        // Volume order and worst order DIVERGE for the two gpu rows.
        {
          ...base,
          g_gpu: 0,
          gl_renderer_bucket: 'mali',
          vol_rank: 2,
          worst_rank: 1,
          sample_count: 3,
          p95_frame_ms: 40,
        },
        base,
        {
          ...base,
          g_gpu: 0,
          gl_renderer_bucket: 'adreno',
          vol_rank: 1,
          worst_rank: 2,
          sample_count: 9,
          p95_frame_ms: 18,
        },
        { ...base, g_preset: 0, graphics_preset: 'high', sample_count: 7 },
      ]) as never,
    );
    const out = await clientPerfSummary(12);
    expect(out.hours).toBe(12);
    // generatedAt is stamped fresh per call; a frozen or empty stamp is a bug.
    expect(Number.isNaN(Date.parse(out.generatedAt))).toBe(false);
    expect(out.totals.sampleCount).toBe(12);
    expect(out.byPreset.map((b) => b.key)).toEqual(['high']);
    expect(out.byGpu.map((b) => b.key)).toEqual(['adreno', 'mali']);
    expect(out.worstGpuBuckets.map((b) => b.key)).toEqual(['mali', 'adreno']);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: pg-gated differential against the retained seven-statement spec.
// Runs only with WOCC_PG_DIFFERENTIAL=1 and a reachable Postgres at DATABASE_URL.
// ---------------------------------------------------------------------------

const PG_ON = process.env.WOCC_PG_DIFFERENTIAL === '1';

type BoundQueryLike = (text: string, values?: unknown[]) => Promise<QueryResult>;

interface LegacyAggregate {
  sampleCount: number;
  medianFps: number;
  p95FrameMs: number;
  p99FrameMs: number;
  contextLossCount: number;
  avgRenderScale: number;
  avgEffectiveRenderScale: number;
}

// The OLD roll-up, retained VERBATIM (SQL text and JS assembly) as the
// executable spec the collapsed statement must reproduce byte-for-byte.
function legacyAggregateFromRow(r: Record<string, unknown>): LegacyAggregate {
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

async function legacyPerfAggregate(query: BoundQueryLike, hours: number): Promise<LegacyAggregate> {
  const res = await query(
    `SELECT
       count(*)::int AS sample_count,
       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY fps_avg), 0)::real AS median_fps,
       COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p95_frame_ms,
       COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p99_frame_ms,
       COALESCE(sum(context_lost_count), 0)::int AS context_loss_count,
       COALESCE(avg(render_scale), 0)::real AS avg_render_scale,
       COALESCE(avg(effective_render_scale), 0)::real AS avg_effective_render_scale
     FROM client_perf_reports
     WHERE created_at > now() - ($1 || ' hours')::interval`,
    [String(hours)],
  );
  return legacyAggregateFromRow(res.rows[0] ?? {});
}

async function legacyPerfBuckets(
  query: BoundQueryLike,
  column: string,
  hours: number,
  limit: number,
  worstFirst = false,
): Promise<Array<LegacyAggregate & { key: string }>> {
  const order = worstFirst ? 'p95_frame_ms DESC, sample_count DESC' : 'sample_count DESC, key ASC';
  const res = await query(
    `SELECT
       ${column} AS key,
       count(*)::int AS sample_count,
       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY fps_avg), 0)::real AS median_fps,
       COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p95_frame_ms,
       COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p99_frame_ms,
       COALESCE(sum(context_lost_count), 0)::int AS context_loss_count,
       COALESCE(avg(render_scale), 0)::real AS avg_render_scale,
       COALESCE(avg(effective_render_scale), 0)::real AS avg_effective_render_scale
     FROM client_perf_reports
     WHERE created_at > now() - ($1 || ' hours')::interval
     GROUP BY ${column}
     ORDER BY ${order}
     LIMIT $2`,
    [String(hours), limit],
  );
  return res.rows.map((r) => ({ key: String(r.key ?? ''), ...legacyAggregateFromRow(r) }));
}

async function legacySummary(query: BoundQueryLike, hours: number) {
  const [totals, byPreset, byGpu, byBrowser, byOs, byScenario, worstGpuBuckets] = await Promise.all(
    [
      legacyPerfAggregate(query, hours),
      legacyPerfBuckets(query, 'graphics_preset', hours, 20),
      legacyPerfBuckets(query, 'gl_renderer_bucket', hours, 50),
      legacyPerfBuckets(query, 'browser_family', hours, 20),
      legacyPerfBuckets(query, 'os_family', hours, 20),
      legacyPerfBuckets(query, 'zone_or_scenario', hours, 30),
      legacyPerfBuckets(query, 'gl_renderer_bucket', hours, 20, true),
    ],
  );
  return { totals, byPreset, byGpu, byBrowser, byOs, byScenario, worstGpuBuckets };
}

// Fixture rows carry a recognizable session_id marker for exact cleanup.
const MARKER = 'perfsumdiff';

interface SeedRow {
  preset: string;
  gpu: string;
  browser: string;
  os: string;
  zone: string;
  fps: number;
  p95: number;
  ctx: number;
  rs: number;
  ers: number;
}

// Includes '' keys on two dimensions (every grouped column defaults to '') and
// a non-ASCII zone name: the volume tie-break (key ASC) then runs under the
// database collation on BOTH sides, so a JS re-sort anywhere in the new path
// diverges. Every dimension exceeds its list cap (presets 22 and browsers/oses
// 21 vs 20, gpus 62 vs 50, zones 35 vs 30), so ALL the per-set cap arms get a
// live boundary in the differential, not just the gpu and zone ones.
const PRESETS = ['', 'high', 'medium', 'low'];
for (let i = 0; i < 18; i++) PRESETS.push(`sqlperf-preset-${String(i + 1).padStart(2, '0')}`);
const BROWSERS = ['', 'Chrome', 'Firefox', 'Safari'];
for (let i = 0; i < 17; i++) BROWSERS.push(`sqlperf-browser-${String(i + 1).padStart(2, '0')}`);
const OSES = ['Windows', 'macOS', 'Linux'];
for (let i = 0; i < 18; i++) OSES.push(`sqlperf-os-${String(i + 1).padStart(2, '0')}`);
const ZONES: string[] = [];
for (let i = 0; i < 34; i++) ZONES.push(`sqlperf-zone-${String(i + 1).padStart(2, '0')}`);
ZONES.push('sqlperf-zöne-Öland');

// 59 gpu buckets with two rows each, one low-volume bucket whose p95 is the
// worst in the fixture (it reaches worstGpuBuckets only through the worst
// ordering), and a deliberate bucket-level p95 TIE pair (identical p95, three
// rows vs one) exercising the worst ordering's sample_count DESC tie-break
// live. Frame p95 values are otherwise distinct so the worst ordering stays
// fully determined (full ties were nondeterministic in the old code too).
const SEED_ROWS: SeedRow[] = [];
for (let b = 0; b < 59; b++) {
  for (let k = 0; k < 2; k++) {
    const i = SEED_ROWS.length;
    SEED_ROWS.push({
      preset: PRESETS[i % PRESETS.length],
      gpu: `sqlperf-gpu-${String(b + 1).padStart(2, '0')}`,
      browser: BROWSERS[i % BROWSERS.length],
      os: OSES[i % OSES.length],
      zone: ZONES[i % ZONES.length],
      fps: 30 + (i % 47),
      p95: 10 + i * 0.37,
      ctx: i % 3,
      rs: 0.5 + (i % 5) * 0.1,
      ers: 0.4 + (i % 6) * 0.1,
    });
  }
}
SEED_ROWS.push({
  preset: '',
  gpu: 'sqlperf-gpu-lowvol',
  browser: 'Chrome',
  os: 'Windows',
  zone: ZONES[SEED_ROWS.length % ZONES.length],
  fps: 5,
  p95: 999,
  ctx: 2,
  rs: 0.5,
  ers: 0.4,
});
// The tie pair: every row in both buckets carries p95 998, so both buckets
// aggregate to exactly 998 and only sample_count DESC (3 rows vs 1) decides
// their worst order; 998 sits just under the low-volume bucket's 999, keeping
// the tie observable near the top of worstGpuBuckets.
for (let k = 0; k < 3; k++) {
  SEED_ROWS.push({
    preset: PRESETS[SEED_ROWS.length % PRESETS.length],
    gpu: 'sqlperf-gpu-tie-heavy',
    browser: BROWSERS[SEED_ROWS.length % BROWSERS.length],
    os: OSES[SEED_ROWS.length % OSES.length],
    zone: ZONES[SEED_ROWS.length % ZONES.length],
    fps: 20 + k,
    p95: 998,
    ctx: 0,
    rs: 0.6,
    ers: 0.5,
  });
}
SEED_ROWS.push({
  preset: PRESETS[SEED_ROWS.length % PRESETS.length],
  gpu: 'sqlperf-gpu-tie-light',
  browser: BROWSERS[SEED_ROWS.length % BROWSERS.length],
  os: OSES[SEED_ROWS.length % OSES.length],
  zone: ZONES[SEED_ROWS.length % ZONES.length],
  fps: 19,
  p95: 998,
  ctx: 1,
  rs: 0.6,
  ers: 0.5,
});

async function cleanupRows(): Promise<void> {
  await pool.query('DELETE FROM client_perf_reports WHERE session_id LIKE $1', [`${MARKER}-%`]);
}

async function seed(): Promise<void> {
  await cleanupRows();
  await pool.query(
    `INSERT INTO client_perf_reports
       (session_id, graphics_preset, gl_renderer_bucket, browser_family, os_family,
        zone_or_scenario, fps_avg, frame_p95_ms, context_lost_count, render_scale,
        effective_render_scale)
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::real[], $8::real[], $9::int[], $10::real[], $11::real[])`,
    [
      SEED_ROWS.map((_, i) => `${MARKER}-${i}`),
      SEED_ROWS.map((r) => r.preset),
      SEED_ROWS.map((r) => r.gpu),
      SEED_ROWS.map((r) => r.browser),
      SEED_ROWS.map((r) => r.os),
      SEED_ROWS.map((r) => r.zone),
      SEED_ROWS.map((r) => r.fps),
      SEED_ROWS.map((r) => r.p95),
      SEED_ROWS.map((r) => r.ctx),
      SEED_ROWS.map((r) => r.rs),
      SEED_ROWS.map((r) => r.ers),
    ],
  );
}

describe.skipIf(!PG_ON)(
  'clientPerfSummary differential vs the seven-statement spec (pg-gated)',
  () => {
    beforeAll(async () => {
      await ensureSchema();
      await seed();
    });

    afterAll(async () => {
      await cleanupRows();
      await pool.end();
    });

    it('matches the spec field-for-field, row-for-row, on totals and every bucket array', async () => {
      // Both sides read the SAME live table (pre-existing rows in the window are
      // fine: they are visible to both), so any classification, ordering,
      // collation, or cap divergence in the collapsed statement surfaces here.
      const fresh = await clientPerfSummary(24);
      const spec = await legacySummary((text, values) => pool.query(text, values), 24);
      expect(fresh.totals).toEqual(spec.totals);
      expect(fresh.byPreset).toEqual(spec.byPreset);
      expect(fresh.byGpu).toEqual(spec.byGpu);
      expect(fresh.byBrowser).toEqual(spec.byBrowser);
      expect(fresh.byOs).toEqual(spec.byOs);
      expect(fresh.byScenario).toEqual(spec.byScenario);
      expect(fresh.worstGpuBuckets).toEqual(spec.worstGpuBuckets);
    });

    it('caps every list at its limit, surfaces the low-volume worst-p95 bucket, and breaks the p95 tie by volume', async () => {
      const fresh = await clientPerfSummary(24);
      expect(fresh.totals.sampleCount).toBeGreaterThanOrEqual(SEED_ROWS.length);
      expect(fresh.byGpu).toHaveLength(50);
      expect(fresh.byGpu.map((b) => b.key)).not.toContain('sqlperf-gpu-lowvol');
      expect(fresh.byScenario).toHaveLength(30);
      // The seeded presets/browsers/oses exceed 20 distinct keys each, so these
      // three cap arms are exercised at a live boundary, not just by text pins.
      expect(fresh.byPreset).toHaveLength(20);
      expect(fresh.byBrowser).toHaveLength(20);
      expect(fresh.byOs).toHaveLength(20);
      // Worst ordering: the 999 bucket leads the 998 tie pair, and within the
      // tie the three-row bucket precedes the one-row bucket (sample_count DESC).
      const worstKeys = fresh.worstGpuBuckets.map((b) => b.key);
      const lowvolIdx = worstKeys.indexOf('sqlperf-gpu-lowvol');
      const heavyIdx = worstKeys.indexOf('sqlperf-gpu-tie-heavy');
      const lightIdx = worstKeys.indexOf('sqlperf-gpu-tie-light');
      expect(lowvolIdx).toBeGreaterThan(-1);
      expect(heavyIdx).toBeGreaterThan(-1);
      expect(lightIdx).toBeGreaterThan(-1);
      expect(lowvolIdx).toBeLessThan(heavyIdx);
      expect(heavyIdx).toBeLessThan(lightIdx);
    });
  },
);
