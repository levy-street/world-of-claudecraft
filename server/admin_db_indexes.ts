// Concurrent-index SQL for the admin Overview's active/returning-account
// subqueries (overviewCounts in server/admin_db.ts). play_sessions is large
// and live in production, so this index builds through the post-commit
// CONCURRENTLY seam (server/concurrent_indexes.ts), never boot DDL. Kept in
// this dependency-free module for the same reason as client_perf_indexes.ts:
// the registry evaluates its list at import time and server/db.ts already
// imports the registry, so defining this in admin_db.ts (which itself
// imports db.ts) would put the registry's import inside that cycle before
// db.ts's body finishes running.
//
// (ended_at, account_id) serves the sargable "still open or ended after
// cutoff" predicate (ended_at IS NULL OR ended_at > cutoff) that
// overviewCounts's active/returning-account subqueries filter on: the
// planner rewrites that OR into a BitmapOr of an IS NULL arm and an
// ended_at > cutoff range arm, both served by this one index, with
// account_id trailing for the count(DISTINCT account_id) aggregate.
export const ADMIN_OVERVIEW_ACTIVE_SESSIONS_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_ended_account
  ON play_sessions(ended_at, account_id);
`;

// A CREATE INDEX CONCURRENTLY killed mid-build (a deploy-watchdog restart, a
// crash) strands the index INVALID, and IF NOT EXISTS then treats it as
// existing on every later boot: never rebuilt, unusable to the planner, yet
// maintained on every play_sessions write. The boot coordinator checks for
// that carcass and drops it (CONCURRENTLY, so peer realms' session writes
// never stall behind the drop) before running the create above.
export const ADMIN_OVERVIEW_ACTIVE_SESSIONS_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('play_sessions_ended_account')
   AND NOT i.indisvalid
`;

export const ADMIN_OVERVIEW_ACTIVE_SESSIONS_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS play_sessions_ended_account';
