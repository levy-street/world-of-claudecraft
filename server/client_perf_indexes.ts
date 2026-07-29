// Concurrent-index SQL for client_perf_reports (packet 0 ruling R7). The
// table is large and live in production, so the worst-10s ranking index goes
// through the post-commit CONCURRENTLY seam (server/concurrent_indexes.ts),
// NEVER boot DDL. Constants live in this dependency-free module because the
// registry evaluates its list at import time and server/db.ts already imports
// the registry: defining them in db.ts would put the registry's import inside
// that cycle before db.ts's body runs. db.ts re-exports them.

// Ships reader-less by design (R7): production accrues indexed history before
// the fleet-view reader lands. Before a future reader relies on this column
// order, re-EXPLAIN its real "worst sessions, last N hours" query first: a
// created_at-leading or partial index may win (the packet 0 close-out record).
export const CLIENT_PERF_WORST10S_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS client_perf_reports_worst10s_created
  ON client_perf_reports(worst_10s_frame_p95_ms DESC, created_at DESC);
`;

// A CREATE INDEX CONCURRENTLY killed mid-build strands the index INVALID and
// IF NOT EXISTS then treats it as existing on every later boot (the
// player_metrics_db.ts carcass note); the boot coordinator drops the carcass
// before re-running the create.
export const CLIENT_PERF_WORST10S_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('client_perf_reports_worst10s_created')
   AND NOT i.indisvalid
`;

export const CLIENT_PERF_WORST10S_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS client_perf_reports_worst10s_created';
