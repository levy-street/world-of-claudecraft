// Opt-in real-Postgres roundtrip for insertClientPerfReport and the phase 03
// dimension columns plus the phase 05 suggestion_ids array. The insert's 44
// positional parameters are the one place a renumbering slip lands values in
// the wrong columns while every mocked-pool suite stays green, so this
// roundtrip is the ONLY decisive guard: it writes a row of pairwise-distinct
// values through the real statement, reads every column back by name, and
// asserts each landed where it was aimed. It also proves the boot DDL applied
// the ADD COLUMNs and that the worst-10s concurrent index exists and is valid
// (ruling R7). The default suite stays DB-free; set TEST_DATABASE_URL
// (npm run db:up) to exercise it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_URL = process.env.TEST_DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;
const MARKER = 'perfroundtrip';

// server/db.ts reads DATABASE_URL at module load; the dynamic import in
// beforeAll runs after this assignment, pointing its pool at the test
// database (the play_session_retention_integration pattern).
type Db = typeof import('../server/db');
let db: Db;

describeDb('client perf report insert roundtrip (real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    db = await import('../server/db');
    await db.ensureSchema();
    await db.pool.query('DELETE FROM client_perf_reports WHERE session_id LIKE $1', [
      `${MARKER}-%`,
    ]);
  });

  afterAll(async () => {
    await db.pool.query('DELETE FROM client_perf_reports WHERE session_id LIKE $1', [
      `${MARKER}-%`,
    ]);
    await db.pool.end();
  });

  it('lands every insert value in its own column, including the five phase 03 dimensions', async () => {
    // Every value is distinct from every other so ANY positional swap between
    // two columns of a compatible type flips at least one assertion below.
    await db.insertClientPerfReport({
      schemaVersion: 2,
      releaseVersion: '0.30.0-test',
      buildId: 'roundtripbuild',
      sessionId: `${MARKER}-row`,
      accountId: null,
      characterId: null,
      realm: 'roundtrip-realm',
      graphicsPreset: 'high',
      gfxTier: 'ultra',
      autoGovernor: true,
      targetFps: 61,
      renderScale: 0.93,
      effectiveRenderScale: 0.87,
      fpsAvg: 58.5,
      frameP95Ms: 21.5,
      frameP99Ms: 34.5,
      longFrameCount: 3,
      rendererCalls: 411,
      rendererTriangles: 123456,
      rendererTextures: 82,
      rendererPrograms: 37,
      contextLostCount: 1,
      longTaskCount: 5,
      longTaskP95Ms: 71.5,
      memoryUsedMb: 143.5,
      memoryLimitMb: 4096.5,
      dpr: 1.75,
      viewportBucket: 'large-1440x900',
      deviceMemory: 8.5,
      hardwareConcurrency: 12,
      mobileTouch: false,
      browserFamily: 'safari',
      osFamily: 'macos',
      glVendor: 'RoundtripVendor',
      glRendererBucket: 'apple-m3-pro',
      zoneOrScenario: 'dungeon:hollow_crypt',
      source: 'gameplay',
      crowdBucket: '25-49',
      simEntities: 244,
      activeViews: 57,
      visibleViews: 31,
      worst10sFrameP95Ms: 180.5,
      suggestionIds: ['hardware-acceleration', 'high-dpi'],
      rawSummary: { roundtrip: true, seconds: 77 },
    });

    const res = await db.pool.query('SELECT * FROM client_perf_reports WHERE session_id = $1', [
      `${MARKER}-row`,
    ]);
    expect(res.rowCount).toBe(1);
    const r = res.rows[0];
    expect(r.schema_version).toBe(2);
    expect(r.release_version).toBe('0.30.0-test');
    expect(r.build_id).toBe('roundtripbuild');
    expect(r.account_id).toBeNull();
    expect(r.character_id).toBeNull();
    expect(r.realm).toBe('roundtrip-realm');
    expect(r.graphics_preset).toBe('high');
    expect(r.gfx_tier).toBe('ultra');
    expect(r.auto_governor).toBe(true);
    expect(r.target_fps).toBe(61);
    expect(r.render_scale).toBeCloseTo(0.93, 5);
    expect(r.effective_render_scale).toBeCloseTo(0.87, 5);
    expect(r.fps_avg).toBeCloseTo(58.5, 5);
    expect(r.frame_p95_ms).toBeCloseTo(21.5, 5);
    expect(r.frame_p99_ms).toBeCloseTo(34.5, 5);
    expect(r.long_frame_count).toBe(3);
    expect(r.renderer_calls).toBe(411);
    expect(r.renderer_triangles).toBe(123456);
    expect(r.renderer_textures).toBe(82);
    expect(r.renderer_programs).toBe(37);
    expect(r.context_lost_count).toBe(1);
    expect(r.long_task_count).toBe(5);
    expect(r.long_task_p95_ms).toBeCloseTo(71.5, 5);
    expect(r.memory_used_mb).toBeCloseTo(143.5, 5);
    expect(r.memory_limit_mb).toBeCloseTo(4096.5, 5);
    expect(r.dpr).toBeCloseTo(1.75, 5);
    expect(r.viewport_bucket).toBe('large-1440x900');
    expect(r.device_memory).toBeCloseTo(8.5, 5);
    expect(r.hardware_concurrency).toBe(12);
    expect(r.mobile_touch).toBe(false);
    expect(r.browser_family).toBe('safari');
    expect(r.os_family).toBe('macos');
    expect(r.gl_vendor).toBe('RoundtripVendor');
    expect(r.gl_renderer_bucket).toBe('apple-m3-pro');
    expect(r.zone_or_scenario).toBe('dungeon:hollow_crypt');
    expect(r.source).toBe('gameplay');
    expect(r.crowd_bucket).toBe('25-49');
    expect(r.sim_entities).toBe(244);
    expect(r.active_views).toBe(57);
    expect(r.visible_views).toBe(31);
    expect(r.worst_10s_frame_p95_ms).toBeCloseTo(180.5, 5);
    // The pg driver maps a JS string array to TEXT[]; order must survive.
    expect(r.suggestion_ids).toEqual(['hardware-acceleration', 'high-dpi']);
    expect(r.raw_summary).toEqual({ roundtrip: true, seconds: 77 });
  });

  it('serves the row back through clientPerfRaw with the dimensions and suggestion ids mapped', async () => {
    const adminDb = await import('../server/admin_db');
    const rows = await adminDb.clientPerfRaw(24, 1000);
    const row = rows.find((x) => x.sessionId === `${MARKER}-row`);
    expect(row).toBeDefined();
    expect(row?.crowdBucket).toBe('25-49');
    expect(row?.simEntities).toBe(244);
    expect(row?.activeViews).toBe(57);
    expect(row?.visibleViews).toBe(31);
    expect(row?.worst10sFrameP95Ms).toBeCloseTo(180.5, 5);
    expect(row?.zoneOrScenario).toBe('dungeon:hollow_crypt');
    expect(row?.suggestionIds).toEqual(['hardware-acceleration', 'high-dpi']);
  });

  it('aggregates suggestionCounts through clientPerfSummary from the live rows', async () => {
    const adminDb = await import('../server/admin_db');
    const summary = await adminDb.clientPerfSummary(24);
    const byId = new Map(summary.suggestionCounts.map((c) => [c.id, c.sampleCount]));
    // Other rows may exist in the shared dev-DB window, so assert floors, not
    // exact equality; the marker row contributes one report to EACH of its ids.
    expect(byId.get('hardware-acceleration') ?? 0).toBeGreaterThanOrEqual(1);
    expect(byId.get('high-dpi') ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('leaves an existing pre-phase row on the column defaults the mapper folds', async () => {
    await db.pool.query(
      'INSERT INTO client_perf_reports (session_id, zone_or_scenario) VALUES ($1, $2)',
      [`${MARKER}-legacy`, 'gameplay'],
    );
    const res = await db.pool.query(
      'SELECT crowd_bucket, sim_entities, active_views, visible_views, worst_10s_frame_p95_ms, suggestion_ids FROM client_perf_reports WHERE session_id = $1',
      [`${MARKER}-legacy`],
    );
    expect(res.rows[0]).toEqual({
      crowd_bucket: '',
      sim_entities: 0,
      active_views: 0,
      visible_views: 0,
      worst_10s_frame_p95_ms: 0,
      suggestion_ids: [],
    });
  });

  it('built the worst-10s concurrent index and it is valid', async () => {
    const res = await db.pool.query(
      `SELECT i.indisvalid
         FROM pg_index i
        WHERE i.indexrelid = to_regclass('client_perf_reports_worst10s_created')`,
    );
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].indisvalid).toBe(true);
  });
});
