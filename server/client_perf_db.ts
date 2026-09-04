// Client performance telemetry: the client_perf_reports table (stored /api/
// perf-report samples) plus its insert and batched-prune accessors. The
// schema is applied by ensureSchema() in db.ts, immediately after the core
// SCHEMA (the table's account_id/character_id FKs need accounts/characters to
// exist first); see the CLIENT_PERF_SCHEMA registration there for the exact
// ordering note.
//
// This module and db.ts import each other (db.ts needs CLIENT_PERF_SCHEMA for
// boot DDL; this module needs the pool to run queries), so a module-scope
// `import { pool } from './db'` would read the pool out of a half-evaluated
// db.ts during that circular import (the same hazard documented in
// db_backend_cancel.ts). loadDb() below defers the import to call time,
// memoized, by which point db.ts is long since evaluated.

import { REALM } from './realm';

// Mirrors db.ts's private REALM_SQL_DEFAULT (same derivation, kept local so
// this module never imports db.ts at module scope; see the header note).
const REALM_SQL_DEFAULT = REALM.replace(/'/g, "''");

// Memoized as the in-flight promise (not the resolved module) so two callers
// racing before the first resolves both await the same import rather than
// issuing a second one.
let dbModulePromise: Promise<typeof import('./db')> | null = null;
function loadDb(): Promise<typeof import('./db')> {
  if (!dbModulePromise) {
    // A rejected import must not stay memoized: it would poison every later
    // insert and retention sweep for the life of the process.
    dbModulePromise = import('./db').catch((err: unknown) => {
      dbModulePromise = null;
      throw err;
    });
  }
  return dbModulePromise;
}

export const CLIENT_PERF_SCHEMA = `
CREATE TABLE IF NOT EXISTS client_perf_reports (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  schema_version INT NOT NULL DEFAULT 1,
  release_version TEXT NOT NULL DEFAULT '',
  build_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  graphics_preset TEXT NOT NULL DEFAULT '',
  gfx_tier TEXT NOT NULL DEFAULT '',
  auto_governor BOOLEAN NOT NULL DEFAULT FALSE,
  target_fps INT NOT NULL DEFAULT 0,
  render_scale REAL NOT NULL DEFAULT 1,
  effective_render_scale REAL NOT NULL DEFAULT 1,
  fps_avg REAL NOT NULL DEFAULT 0,
  frame_p95_ms REAL NOT NULL DEFAULT 0,
  frame_p99_ms REAL NOT NULL DEFAULT 0,
  long_frame_count INT NOT NULL DEFAULT 0,
  renderer_calls INT NOT NULL DEFAULT 0,
  renderer_triangles INT NOT NULL DEFAULT 0,
  renderer_textures INT NOT NULL DEFAULT 0,
  renderer_programs INT NOT NULL DEFAULT 0,
  context_lost_count INT NOT NULL DEFAULT 0,
  long_task_count INT NOT NULL DEFAULT 0,
  long_task_p95_ms REAL NOT NULL DEFAULT 0,
  memory_used_mb REAL,
  memory_limit_mb REAL,
  dpr REAL NOT NULL DEFAULT 1,
  viewport_bucket TEXT NOT NULL DEFAULT '',
  device_memory REAL,
  hardware_concurrency INT NOT NULL DEFAULT 0,
  mobile_touch BOOLEAN NOT NULL DEFAULT FALSE,
  browser_family TEXT NOT NULL DEFAULT '',
  os_family TEXT NOT NULL DEFAULT '',
  gl_vendor TEXT NOT NULL DEFAULT '',
  gl_renderer_bucket TEXT NOT NULL DEFAULT '',
  zone_or_scenario TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'gameplay',
  raw_summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS client_perf_reports_created ON client_perf_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS client_perf_reports_release_created ON client_perf_reports(release_version, created_at DESC);
CREATE INDEX IF NOT EXISTS client_perf_reports_gpu_created ON client_perf_reports(gl_renderer_bucket, created_at DESC);
CREATE INDEX IF NOT EXISTS client_perf_reports_session_created ON client_perf_reports(session_id, created_at DESC);
-- Packet 0 report dimensions (rulings R3-R7). crowd_bucket keeps the summary
-- statement's GROUPING-bits contract (every grouped column TEXT NOT NULL
-- DEFAULT ''; pre-column rows fold to 'unknown' in the read-time mapper). The
-- worst-10s ranking index builds via CONCURRENT_INDEX_MIGRATIONS
-- (server/client_perf_indexes.ts), never here.
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS crowd_bucket TEXT NOT NULL DEFAULT '';
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS sim_entities INT NOT NULL DEFAULT 0;
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS active_views INT NOT NULL DEFAULT 0;
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS visible_views INT NOT NULL DEFAULT 0;
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS worst_10s_frame_p95_ms REAL NOT NULL DEFAULT 0;
-- Phase 05 (ruling R14): client-computed perf-doctor suggestion ids, validated
-- against the server allowlist in perf_report.ts before storage (filter,
-- dedupe, cap 3). Pre-column and healthy rows both read as the empty array.
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS suggestion_ids TEXT[] NOT NULL DEFAULT '{}';
-- WebGL context restore telemetry (mirrors context_lost_count above):
-- contextRestoredCount counts webglcontextrestored events, contextRestoreFailures
-- counts restore units (render-target re-bakes or KTX2 texture re-transcodes)
-- that failed to come back after a restore.
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS context_restored_count INT NOT NULL DEFAULT 0;
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS context_restore_failures INT NOT NULL DEFAULT 0;
`;

// The worst-10s concurrent index (ruling R7). Defined in the dependency-free
// client_perf_indexes.ts (the registry evaluates before this module's body;
// see the note there) and re-exported here beside the table's accessors.
export {
  CLIENT_PERF_WORST10S_INDEX_SQL,
  CLIENT_PERF_WORST10S_INVALID_INDEX_CHECK_SQL,
  CLIENT_PERF_WORST10S_INVALID_INDEX_DROP_SQL,
} from './client_perf_indexes';

export interface ClientPerfReportInsert {
  schemaVersion: number;
  releaseVersion: string;
  buildId: string;
  sessionId: string;
  accountId: number | null;
  characterId: number | null;
  realm: string;
  graphicsPreset: string;
  gfxTier: string;
  autoGovernor: boolean;
  targetFps: number;
  renderScale: number;
  effectiveRenderScale: number;
  fpsAvg: number;
  frameP95Ms: number;
  frameP99Ms: number;
  longFrameCount: number;
  rendererCalls: number;
  rendererTriangles: number;
  rendererTextures: number;
  rendererPrograms: number;
  contextLostCount: number;
  contextRestoredCount: number;
  contextRestoreFailures: number;
  longTaskCount: number;
  longTaskP95Ms: number;
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  dpr: number;
  viewportBucket: string;
  deviceMemory: number | null;
  hardwareConcurrency: number;
  mobileTouch: boolean;
  browserFamily: string;
  osFamily: string;
  glVendor: string;
  glRendererBucket: string;
  zoneOrScenario: string;
  source: string;
  crowdBucket: string;
  simEntities: number;
  activeViews: number;
  visibleViews: number;
  worst10sFrameP95Ms: number;
  suggestionIds: string[];
  rawSummary: Record<string, unknown>;
}

export async function insertClientPerfReport(row: ClientPerfReportInsert): Promise<void> {
  const { pool } = await loadDb();
  await pool.query(
    `INSERT INTO client_perf_reports (
       schema_version, release_version, build_id, session_id, account_id, character_id, realm,
       graphics_preset, gfx_tier, auto_governor, target_fps, render_scale, effective_render_scale,
       fps_avg, frame_p95_ms, frame_p99_ms, long_frame_count,
       renderer_calls, renderer_triangles, renderer_textures, renderer_programs, context_lost_count,
       long_task_count, long_task_p95_ms, memory_used_mb, memory_limit_mb,
       dpr, viewport_bucket, device_memory, hardware_concurrency, mobile_touch,
       browser_family, os_family, gl_vendor, gl_renderer_bucket, zone_or_scenario, source,
       crowd_bucket, sim_entities, active_views, visible_views, worst_10s_frame_p95_ms,
       suggestion_ids, raw_summary, context_restored_count, context_restore_failures
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17,
       $18, $19, $20, $21, $22,
       $23, $24, $25, $26,
       $27, $28, $29, $30, $31,
       $32, $33, $34, $35, $36, $37,
       $38, $39, $40, $41, $42,
       $43, $44, $45, $46
     )`,
    [
      row.schemaVersion,
      row.releaseVersion,
      row.buildId,
      row.sessionId,
      row.accountId,
      row.characterId,
      row.realm,
      row.graphicsPreset,
      row.gfxTier,
      row.autoGovernor,
      row.targetFps,
      row.renderScale,
      row.effectiveRenderScale,
      row.fpsAvg,
      row.frameP95Ms,
      row.frameP99Ms,
      row.longFrameCount,
      row.rendererCalls,
      row.rendererTriangles,
      row.rendererTextures,
      row.rendererPrograms,
      row.contextLostCount,
      row.longTaskCount,
      row.longTaskP95Ms,
      row.memoryUsedMb,
      row.memoryLimitMb,
      row.dpr,
      row.viewportBucket,
      row.deviceMemory,
      row.hardwareConcurrency,
      row.mobileTouch,
      row.browserFamily,
      row.osFamily,
      row.glVendor,
      row.glRendererBucket,
      row.zoneOrScenario,
      row.source,
      row.crowdBucket,
      row.simEntities,
      row.activeViews,
      row.visibleViews,
      row.worst10sFrameP95Ms,
      row.suggestionIds,
      JSON.stringify(row.rawSummary),
      row.contextRestoredCount,
      row.contextRestoreFailures,
    ],
  );
}

// Keeps production telemetry bounded. PERF_REPORT_RETENTION_DAYS=0 disables
// pruning for a short manual capture window. One bounded batch per call: the
// caller (the retention sweep) drives iteration, so each DELETE is a short
// autocommit statement on the default statement timeout, riding
// client_perf_reports_created via the oldest-first ORDER BY.
export async function pruneClientPerfReportsBatch(
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const { pool } = await loadDb();
  const res = await pool.query(
    `DELETE FROM client_perf_reports
      WHERE id IN (
        SELECT id FROM client_perf_reports
         WHERE created_at < now() - ($1 || ' days')::interval
         ORDER BY created_at
         LIMIT $2)`,
    [String(days), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}
