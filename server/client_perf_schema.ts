// Client performance telemetry DDL: the client_perf_reports table, its indexes,
// and the additive column blocks every later packet added. Kept out of db.ts
// SCHEMA and out of client_perf_db-style accessors alike, for the reason
// admin_guilds_schema.ts states: a schema module that db.ts imports must not
// import db.ts back. The table's accessors (insertClientPerfReport,
// pruneClientPerfReportsBatch) stay in db.ts beside the pool.
//
// ensureSchema applies this AFTER the core SCHEMA, under the same boot advisory
// lock, because account_id and character_id reference accounts and characters.
// Every statement here is idempotent and additive, so a boot against a
// populated production table rewrites no rows.
import { REALM } from './realm';

// The realm as a SQL string-literal body for the column default below. Spelled
// here rather than imported from db.ts because a schema module db.ts imports
// must not import db.ts back (the admin_guilds_schema.ts rule), and this is the
// SAME shape social_db.ts already uses for the characters.realm default: the
// house pattern for a schema module that needs it, not a new one. Safe as a
// complete escape because resolveRealm (realm.ts) bounds REALM to 24 chars of
// [A-Za-z0-9 '_-], so doubling the apostrophe is the only sequence that can
// matter; if that validation is ever loosened, all three spellings change
// together (db.ts REALM_SQL_DEFAULT, social_db.ts, here).
const REALM_SQL_DEFAULT = REALM.replace(/'/g, "''");

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
-- GPU model dimensions. gl_renderer_bucket is VENDOR level by design and its
-- coarseness is pinned, so it stays exactly as it is and these sit beside it:
-- gl_renderer_raw is the full UNMASKED_RENDERER_WEBGL string the client already
-- sends and the ingest used to drop (clamped to 160 chars, the same bound that
-- wire field always had), gl_model and gl_laptop are its parsed family key and
-- form-factor verdict (server/gpu_model_bucket.ts), and gpu_hp_adapter is the
-- SAME family key parsed from the client's WebGPU high-performance adapter
-- description, so a row where it disagrees with gl_model is a laptop rendering
-- on its iGPU while a discrete part sits idle. gl_model and gpu_hp_adapter are
-- TEXT NOT NULL DEFAULT '' because they are GROUPED columns in the admin
-- summary, which reads '' as "no data" for pre-column and no-evidence rows
-- alike; gl_laptop is nullable because "cannot tell" is its common answer.
-- NO new index: the summary aggregates over a created_at window, so an index
-- led by os_family or gl_model cannot serve it, and a big live table's indexes
-- go through server/client_perf_indexes.ts (CONCURRENTLY), never boot DDL.
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS gl_renderer_raw TEXT NOT NULL DEFAULT '';
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS gl_model TEXT NOT NULL DEFAULT '';
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS gl_laptop BOOLEAN;
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS gpu_hp_adapter TEXT NOT NULL DEFAULT '';
`;
