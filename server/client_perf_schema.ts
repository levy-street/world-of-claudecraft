// Storage for the client perf report beacon (server/perf_report.ts): one row
// per report, read back by the admin JSON extraction and the fleet aggregates
// in server/admin_db.ts. Extracted from db.ts SCHEMA verbatim so the file stays
// under its monolith ceiling.
//
// FK-references accounts(id) and characters(id), so ensureSchema applies this
// AFTER the core SCHEMA, never inside it.
//
// The post-CREATE ALTERs are how this table has always grown: additive,
// idempotent, re-applied every boot. Every column added that way is TEXT NOT
// NULL DEFAULT '' when it is a grouped dimension, which keeps the admin
// summary's GROUPING-bits contract intact (a rolled-up NULL and a data key of
// '' must stay distinguishable), and its pre-column rows fold to 'unknown' in
// the read-time mapper.
//
// The worst-10s ranking index is NOT here: it builds concurrently through
// CONCURRENT_INDEX_MIGRATIONS (server/client_perf_indexes.ts).

import { REALM } from './realm';

// Same single-quote escape db.ts applies to REALM for its own realm-scoped
// DEFAULTs, kept identical so the moved DDL is byte-for-byte what it was.
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
-- Which graphics API the client's WebGL context talks to (d3d11, vulkan,
-- opengl-es, ...), derived server-side from the adapter name the report already
-- carries (server/gl_backend.ts). Orthogonal to gl_renderer_bucket, which says
-- whose hardware it is and discards the API token for every recognised vendor.
-- Same GROUPING-bits contract as the other grouped columns (TEXT NOT NULL
-- DEFAULT ''); pre-column rows fold to 'unknown' in the read-time mapper.
ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS gl_backend TEXT NOT NULL DEFAULT '';
-- GPU model dimensions. gl_renderer_bucket is VENDOR level by design and its
-- coarseness is pinned, so it stays exactly as it is and these sit beside it:
-- gl_renderer_raw is the full UNMASKED_RENDERER_WEBGL string the client already
-- sends and the ingest used to drop (clamped to 160 chars, the same bound that
-- wire field always had), gl_model and gl_laptop are its parsed family key and
-- form-factor verdict (server/gpu_model_bucket.ts), and gpu_hp_adapter is the
-- SAME family key parsed from the client's WebGPU high-performance adapter
-- description, so a row whose VENDOR segment disagrees with gl_model's is a
-- laptop rendering on its iGPU while a discrete part sits idle. Vendor and not
-- the whole key because the adapter text a normal Chrome page can read is
-- {vendor, architecture} only, so gpu_hp_adapter is usually vendor-level even
-- when gl_model is not. gl_model and gpu_hp_adapter are
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
