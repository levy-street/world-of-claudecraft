// Dependency-free client-perf telemetry DDL: the client_perf_reports table, its
// read indexes, and every additive column added to it since. Kept out of
// server/db.ts SCHEMA so the table's DDL sits with its own domain (the
// module-first rule for a growing monolith), and kept dependency-free like
// admin_guilds_schema.ts so importing it from db.ts cannot form a
// db.ts -> schema -> db.ts cycle.
//
// ensureSchema applies this AFTER SCHEMA: the table FK-references accounts(id)
// and characters(id), which SCHEMA creates. The worst-10s ranking index is NOT
// here: it builds CONCURRENTLY after listen (server/client_perf_indexes.ts).

import { REALM } from './realm';

// Same escape the sibling schema modules use for a realm default (social_db.ts).
const REALM_SQL_DEFAULT = REALM.replace(/'/g, "''");

export const CLIENT_PERF_REPORTS_SCHEMA = `
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
-- The shader warm-up worker's end state on the reporting client: the one
-- fleet-visible readout of whether that worker is alive and, when it is not,
-- why. Typed columns rather than raw_summary keys so perf reports can be
-- FILTERED on them; both are bounded at ingest (perf_report_entry_blocks.ts
-- shaderWarmToken), and the per-session detail stays in raw_summary.shaderWarm.
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS shader_warm_worker_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS shader_warm_refusal TEXT NOT NULL DEFAULT '';
`;
