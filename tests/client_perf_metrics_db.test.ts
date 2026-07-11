// Integration coverage for the client-perf cardinality cap (Phase 4), which is
// enforced IN THE SQL (server/client_perf_metrics_db.ts), not by hoping the data is
// small. This runs the EXACT production query (CLIENT_PERF_METRICS_SQL via
// runClientPerfMetricRows) against a real Postgres, seeding MANY releases and GPU
// buckets, and asserts the result is capped to current + previous release and top-N
// GPU buckets + 'other', with the total series count under the fixed ceiling.
//
// It needs a real Postgres (the cap uses window functions + percentile_cont that no
// in-memory fake models), so it is GATED on TEST_DATABASE_URL / DATABASE_URL and
// SKIPS cleanly when neither is set, keeping the default `vitest run` DB-free per
// tests/CLAUDE.md. Locally: `npm run db:up` then
// `TEST_DATABASE_URL=postgres://wocc:wocc@localhost:5433/wocc npx vitest run
// tests/client_perf_metrics_db.test.ts`. It confines every object to a throwaway
// schema it drops at the end, so it never touches real tables.

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OTHER_GPU_BUCKET,
  RELEASE_WINDOW,
  runClientPerfMetricRows,
} from '../server/client_perf_metrics_db';

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const SCHEMA = 'client_perf_metrics_cap_test';

// Skip the whole suite (rather than fail) when no test database is configured.
const describeDb = DB_URL ? describe : describe.skip;

describeDb('client-perf cardinality cap (SQL-enforced, real Postgres)', () => {
  let pool: Pool;
  let reachable = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await pool.query(`CREATE SCHEMA ${SCHEMA}`);
      await pool.query(`SET search_path TO ${SCHEMA}`);
      await pool.query(`
        CREATE TABLE client_perf_reports (
          id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          release_version TEXT NOT NULL DEFAULT '',
          gl_renderer_bucket TEXT NOT NULL DEFAULT '',
          fps_avg REAL NOT NULL DEFAULT 0,
          frame_p95_ms REAL NOT NULL DEFAULT 0,
          long_frame_count INT NOT NULL DEFAULT 0,
          long_task_count INT NOT NULL DEFAULT 0
        )
      `);
      reachable = true;
    } catch (err) {
      // A configured-but-unreachable DB should not hard-fail the default suite.
      console.warn('client-perf cap test: database unreachable, skipping:', err);
    }
  });

  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      } catch {
        // best effort cleanup
      }
      await pool.end();
    }
  });

  // A Queryable that pins search_path to the throwaway schema on every call, so the
  // production SQL's unqualified `client_perf_reports` resolves to the seeded table.
  function scopedDb() {
    return {
      async query(text: string, params: unknown[]) {
        const client = await pool.connect();
        try {
          await client.query(`SET search_path TO ${SCHEMA}`);
          return await client.query(text, params);
        } finally {
          client.release();
        }
      },
    };
  }

  it('caps to current + previous release and top-N GPU buckets + other', async () => {
    if (!reachable) return;
    // Seed FIVE releases (only the two newest should survive) and, in each, MANY GPU
    // buckets (well over the top-N so the rest fold into 'other'). Older releases get
    // older ids so the id-recency ranking drops them.
    const releases = ['v0.20.0', 'v0.21.0', 'v0.22.0', 'v0.22.1', 'v0.23.0'];
    const GPU_COUNT = 30;
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (let ri = 0; ri < releases.length; ri++) {
      const release = releases[ri];
      for (let g = 0; g < GPU_COUNT; g++) {
        // Give higher-index GPUs more reports so the top-N ordering is deterministic,
        // and make newer releases carry larger ids (inserted later).
        const reportsForGpu = g + 1;
        for (let n = 0; n < reportsForGpu; n++) {
          values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
          params.push(release, `gpu-${String(g).padStart(2, '0')}`, 60 - g, 10 + g, 1, 100);
        }
      }
    }
    await scopedDb().query(
      `INSERT INTO client_perf_reports
         (release_version, gl_renderer_bucket, fps_avg, frame_p95_ms, long_frame_count, long_task_count)
       VALUES ${values.join(',')}`,
      params,
    );

    const topN = 8;
    const rows = await runClientPerfMetricRows(scopedDb(), { hours: 24, topGpuBuckets: topN });

    // Release window: only the two newest releases survive.
    const seenReleases = new Set(rows.map((r) => r.releaseVersion));
    expect(seenReleases.size).toBe(RELEASE_WINDOW);
    expect(seenReleases).toEqual(new Set(['v0.22.1', 'v0.23.0']));

    // GPU cap: within each release, at most top-N real buckets plus one 'other'.
    for (const release of seenReleases) {
      const buckets = rows.filter((r) => r.releaseVersion === release);
      expect(buckets.length).toBeLessThanOrEqual(topN + 1);
      const others = buckets.filter((b) => b.glRendererBucket === OTHER_GPU_BUCKET);
      expect(others.length).toBe(1); // the fold row exists (30 buckets > topN)
      const realBuckets = buckets.filter((b) => b.glRendererBucket !== OTHER_GPU_BUCKET);
      expect(realBuckets.length).toBe(topN);
    }

    // Total series count under the fixed ceiling regardless of the 5 releases x 30 GPUs seeded.
    const ceiling = RELEASE_WINDOW * (topN + 1);
    expect(rows.length).toBeLessThanOrEqual(ceiling);
  });

  it('computes median fps, frame p95 in seconds, and a weighted long-frame rate', async () => {
    if (!reachable) return;
    await scopedDb().query('TRUNCATE client_perf_reports', []);
    // One release, one GPU bucket, three reports: fps 40/50/60 (median 50),
    // frame_p95 20/30/40 ms (median 30 ms -> 0.03 s), long frames 1+2+3=6 over
    // sampled frames 100+100+100=300 -> rate 0.02.
    await scopedDb().query(
      `INSERT INTO client_perf_reports
         (release_version, gl_renderer_bucket, fps_avg, frame_p95_ms, long_frame_count, long_task_count)
       VALUES
         ('v0.23.0','gpu-a',40,20,1,100),
         ('v0.23.0','gpu-a',50,30,2,100),
         ('v0.23.0','gpu-a',60,40,3,100)`,
      [],
    );

    const rows = await runClientPerfMetricRows(scopedDb(), { hours: 24, topGpuBuckets: 8 });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.medianFps).toBeCloseTo(50, 5);
    expect(row.frameP95Seconds).toBeCloseTo(0.03, 5);
    expect(row.longFramesRate).toBeCloseTo(0.02, 5);
  });

  it('excludes reports outside the recent window', async () => {
    if (!reachable) return;
    await scopedDb().query('TRUNCATE client_perf_reports', []);
    await scopedDb().query(
      `INSERT INTO client_perf_reports
         (created_at, release_version, gl_renderer_bucket, fps_avg, frame_p95_ms, long_frame_count, long_task_count)
       VALUES
         (now(), 'v0.23.0','gpu-a',60,16,0,100),
         (now() - interval '5 hours', 'v0.23.0','gpu-a',10,99,50,100)`,
      [],
    );
    // Only the fresh report is in the 1h window, so the median fps is 60, not ~35.
    const rows = await runClientPerfMetricRows(scopedDb(), { hours: 1, topGpuBuckets: 8 });
    expect(rows).toHaveLength(1);
    expect(rows[0].medianFps).toBeCloseTo(60, 5);
    expect(rows[0].sampleCount).toBe(1);
  });
});
