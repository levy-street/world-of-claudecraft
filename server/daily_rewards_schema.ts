// Post-commit index migration for the append-only Daily Rewards event ledger.
// The table can be large in production, so db.ts builds this index concurrently
// after the schema transaction and repairs an invalid interrupted build on boot.

export const DAILY_REWARD_EVENTS_CONCURRENT_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS daily_reward_events_account_day_created_id
  ON daily_reward_events(account_id, day, realm, created_at DESC, id DESC)
  WHERE points > 0;
`;

export const DAILY_REWARD_EVENTS_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('daily_reward_events_account_day_created_id')
   AND NOT i.indisvalid
`;

export const DAILY_REWARD_EVENTS_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS daily_reward_events_account_day_created_id';
