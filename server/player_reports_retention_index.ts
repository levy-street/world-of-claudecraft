// Concurrent-index SQL for player_reports' retention-sweep prune
// (prunePlayerReportsBatch in moderation_db.ts).
//
// WHY THIS INDEX EXISTS. The prune scans account-agnostically: "the oldest
// resolved (status != 'open') rows past the retention cutoff", ordered by
// (created_at ASC, id ASC) so the LIMIT batch is deterministic. The two
// existing player_reports indexes (player_reports_reported_status, keyed on
// reported_account_id first; player_reports_reporter_created, keyed on
// reporter_account_id first) both lead with an account column neither the
// prune nor the sweep ever filters on, so neither can serve this scan: it
// degrades to a sequential scan plus sort of the whole table under the
// sweep's statement timeout, which grows worse every night this table stays
// unbounded and can stall the sweep's progress on this table indefinitely.
//
// WHY IT IS PARTIAL. moderationQueue reads WHERE status = 'open' exclusively
// and the prune predicate is status != 'open', so an open report is never a
// candidate: a full index would carry an entry for every currently-open
// report as well, which is exactly the subset the prune must never touch and
// gains it nothing. `WHERE status <> 'open'` keeps the index scoped to the
// rows the prune actually walks.
//
// CONCURRENTLY, never boot DDL: player_reports is a live, unbounded table in
// production and a transactional CREATE INDEX would hold its lock for the
// whole scan. Constants live in this dependency-free module (the
// client_perf_indexes.ts precedent) because the registry
// (server/concurrent_indexes.ts) evaluates its list at import time and
// server/db.ts already imports the registry.

export const PLAYER_REPORTS_RETENTION_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS player_reports_retention_created
  ON player_reports(created_at ASC, id ASC)
  WHERE status <> 'open';
`;

// A CREATE INDEX CONCURRENTLY killed mid-build strands the index INVALID, and
// IF NOT EXISTS then treats that carcass as existing on every later boot (the
// player_metrics_db.ts carcass note), so the sweep would silently keep
// sequential-scanning forever. The boot coordinator drops the carcass before
// re-running the create.
export const PLAYER_REPORTS_RETENTION_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('player_reports_retention_created')
   AND NOT i.indisvalid
`;

export const PLAYER_REPORTS_RETENTION_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS player_reports_retention_created';
