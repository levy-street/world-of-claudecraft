// Concurrent-index SQL for chat_violations' retention-sweep prune
// (pruneChatViolationsBatch in chat_filter_db.ts).
//
// WHY THIS INDEX EXISTS. The prune scans account-agnostically: "the oldest
// rows past the retention cutoff", ordered by (created_at ASC, id ASC) so the
// LIMIT batch is deterministic. The only existing chat_violations index
// (chat_violations_account) leads with account_id, which serves the
// per-account admin reader (chatModerationForAccount) but not this
// whole-table age scan: without a matching index the prune degrades to a
// sequential scan plus sort of the hard-word incident log, which the PR
// description calls out as explicitly unbounded, and risks the sweep's
// per-run statement timeout the larger this table grows.
//
// Not partial: unlike player_reports, chat_violations carries no status
// column excluding rows from the prune, so every row is eventually eligible
// and the index should cover the whole table.
//
// CONCURRENTLY, never boot DDL: chat_violations is a live, unbounded table in
// production and a transactional CREATE INDEX would hold its lock for the
// whole scan. Constants live in this dependency-free module (the
// client_perf_indexes.ts precedent) because the registry
// (server/concurrent_indexes.ts) evaluates its list at import time and
// server/db.ts already imports the registry.

export const CHAT_VIOLATIONS_RETENTION_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_violations_retention_created
  ON chat_violations(created_at ASC, id ASC);
`;

// A CREATE INDEX CONCURRENTLY killed mid-build strands the index INVALID, and
// IF NOT EXISTS then treats that carcass as existing on every later boot (the
// player_metrics_db.ts carcass note), so the sweep would silently keep
// sequential-scanning forever. The boot coordinator drops the carcass before
// re-running the create.
export const CHAT_VIOLATIONS_RETENTION_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('chat_violations_retention_created')
   AND NOT i.indisvalid
`;

export const CHAT_VIOLATIONS_RETENTION_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS chat_violations_retention_created';
