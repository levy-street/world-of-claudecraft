import { pool } from './db';

// Read-side aggregate for the client-perf /metrics gauges (Phase 4). This is NEW
// SQL (it does not exist in admin_db.ts, whose clientPerfSummary aggregates a
// different, uncapped shape for the admin dashboard), and its whole job is to
// ENFORCE the Prometheus cardinality cap IN THE QUERY, not to hope the data is
// small:
//   - release window: only the CURRENT and PREVIOUS release_version by recency
//     (at most two release label values), everything older is dropped.
//   - GPU bucket: only the TOP-N gl_renderer_bucket by sample volume; every other
//     bucket is folded into a single 'other' row.
//   - time window: only rows in the last `hours` (default 1h), so the gauges track
//     "now" and the read hits client_perf_reports_release_created / _gpu_created.
// The resulting series count is bounded by 2 releases * (N + 1) GPU buckets,
// regardless of how many distinct releases or GPUs the table actually holds.
//
// SQL lives only in db.ts / *_db.ts (server/CLAUDE.md invariant); the exporter
// (server/http/client_perf_metrics.ts) does zero SQL and only shapes these rows
// into gauges.

/** One aggregated client-perf row for a (release_version, gl_renderer_bucket) pair. */
export interface ClientPerfRow {
  releaseVersion: string;
  glRendererBucket: string;
  /** Number of reports behind this row (used for a weighted long-frame rate). */
  sampleCount: number;
  /** Median (p50) of fps_avg across the row's reports. */
  medianFps: number;
  /** Median (p50) of frame_p95_ms across the row's reports, in SECONDS. */
  frameP95Seconds: number;
  /** Long frames per reported frame: sum(long_frame_count) / sum(sampled frames). */
  longFramesRate: number;
}

/** Options for {@link clientPerfMetricRows}; all bounded and defaulted. */
export interface ClientPerfMetricsOptions {
  /** Recent window in hours (default 1). Clamped to [1, 24]. */
  hours?: number;
  /** Max distinct GPU buckets kept per release before 'other' (default 8). Clamped to [1, 25]. */
  topGpuBuckets?: number;
}

/** The minimal query surface both the shared pool and a test pool satisfy. */
export interface Queryable {
  query(text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The label value every non-top GPU bucket is folded into. */
export const OTHER_GPU_BUCKET = 'other';

/** The number of releases the window keeps: the current and the previous one. */
export const RELEASE_WINDOW = 2;

const MS_PER_SECOND = 1000;

function cleanHours(hours: number | undefined): number {
  if (hours === undefined || !Number.isFinite(hours)) return 1;
  return Math.min(24, Math.max(1, Math.floor(hours)));
}

function cleanTopGpuBuckets(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 8;
  return Math.min(25, Math.max(1, Math.floor(n)));
}

/**
 * The capped aggregate SQL, parameterized by $1 = hours, $2 = release window,
 * $3 = top-N GPU buckets. Exported (with mapClientPerfRow / runClientPerfMetricRows)
 * so the SQL cap is exercised by an integration test against a real Postgres pool
 * without reaching through the module-level shared pool.
 */
export const CLIENT_PERF_METRICS_SQL = `
    WITH recent AS (
      SELECT id, release_version, gl_renderer_bucket, fps_avg, frame_p95_ms,
             long_frame_count, long_task_count
      FROM client_perf_reports
      WHERE created_at > now() - ($1 || ' hours')::interval
    ),
    -- The current + previous release, defined as the RELEASE_WINDOW releases with the
    -- most recent activity in the window (ranked by their newest report id, a
    -- monotonic proxy for recency). Older releases are dropped here, so
    -- release_version can take at most RELEASE_WINDOW distinct label values.
    top_releases AS (
      SELECT release_version
      FROM (
        SELECT release_version,
               row_number() OVER (ORDER BY max(id) DESC) AS rn
        FROM recent
        GROUP BY release_version
      ) ranked
      WHERE rn <= $2
    ),
    scoped AS (
      SELECT * FROM recent WHERE release_version IN (SELECT release_version FROM top_releases)
    ),
    -- Rank GPU buckets WITHIN each release by sample volume; keep the top N, fold the
    -- rest to 'other'. The fold is what makes the GPU label bounded regardless of how
    -- many distinct buckets exist.
    ranked_gpu AS (
      SELECT release_version, gl_renderer_bucket,
             row_number() OVER (
               PARTITION BY release_version
               ORDER BY count(*) DESC, gl_renderer_bucket ASC
             ) AS rn
      FROM scoped
      GROUP BY release_version, gl_renderer_bucket
    ),
    labeled AS (
      SELECT s.release_version,
             CASE WHEN rg.rn <= $3 THEN s.gl_renderer_bucket ELSE '${OTHER_GPU_BUCKET}' END AS gpu_bucket,
             s.fps_avg, s.frame_p95_ms, s.long_frame_count, s.long_task_count
      FROM scoped s
      JOIN ranked_gpu rg
        ON rg.release_version = s.release_version
       AND rg.gl_renderer_bucket = s.gl_renderer_bucket
    )
    SELECT
      release_version,
      gpu_bucket,
      count(*)::int AS sample_count,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY fps_avg), 0)::real AS median_fps,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS median_frame_p95_ms,
      COALESCE(sum(long_frame_count), 0)::bigint AS long_frames,
      COALESCE(sum(long_task_count), 0)::bigint AS sampled_frames
    FROM labeled
    GROUP BY release_version, gpu_bucket
    ORDER BY release_version, gpu_bucket
    `;

/** Map one raw aggregate row onto a ClientPerfRow (ms -> seconds, weighted rate). */
export function mapClientPerfRow(r: Record<string, unknown>): ClientPerfRow {
  const longFrames = Number(r.long_frames);
  const sampledFrames = Number(r.sampled_frames);
  return {
    releaseVersion: String(r.release_version ?? ''),
    glRendererBucket: String(r.gpu_bucket ?? ''),
    sampleCount: Number(r.sample_count),
    medianFps: Number(r.median_fps),
    frameP95Seconds: Number(r.median_frame_p95_ms) / MS_PER_SECOND,
    longFramesRate: sampledFrames > 0 ? longFrames / sampledFrames : 0,
  };
}

/**
 * Run the capped aggregate against any Queryable and map the rows. Used by the
 * shared-pool entry point below and directly by the integration test's own pool.
 */
export async function runClientPerfMetricRows(
  db: Queryable,
  options: ClientPerfMetricsOptions = {},
): Promise<ClientPerfRow[]> {
  const hours = cleanHours(options.hours);
  const topGpuBuckets = cleanTopGpuBuckets(options.topGpuBuckets);
  const res = await db.query(CLIENT_PERF_METRICS_SQL, [
    String(hours),
    RELEASE_WINDOW,
    topGpuBuckets,
  ]);
  return res.rows.map(mapClientPerfRow);
}

/**
 * Aggregate recent client_perf_reports into the bounded gauge rows. The cap is
 * enforced in SQL: at most RELEASE_WINDOW releases (current + previous by recency),
 * and within each release at most `topGpuBuckets` real GPU buckets plus one 'other'
 * fold, all over the last `hours`. Long frames per frame uses reported frame counts
 * where present (long_task_count is the sampled-frame proxy the client reports), so
 * the rate is a true fraction rather than a raw per-report sum.
 */
export async function clientPerfMetricRows(
  options: ClientPerfMetricsOptions = {},
): Promise<ClientPerfRow[]> {
  return runClientPerfMetricRows(pool, options);
}
