// Post-commit concurrent index builds. These indexes build via CREATE INDEX
// CONCURRENTLY because their tables are large in production and a
// transactional CREATE INDEX would hold its lock for the whole scan, so the
// boot coordinator (ensureSchema in server/db.ts) runs this list after the
// schema COMMIT, under the session-level form of the schema advisory lock.
// Order is load-bearing and pinned by tests/schema_wiring.test.ts. Each entry
// self-heals an INVALID carcass left by an interrupted build (a
// deploy-watchdog restart, a crash): checkSql finds the carcass, dropSql
// removes it (CONCURRENTLY, so peer realms' writes never stall behind the
// drop), and createSql rebuilds it.

import {
  DAILY_REWARD_EVENTS_CONCURRENT_INDEX_SQL,
  DAILY_REWARD_EVENTS_INVALID_INDEX_CHECK_SQL,
  DAILY_REWARD_EVENTS_INVALID_INDEX_DROP_SQL,
} from './daily_rewards_schema';
import {
  PLAY_SESSIONS_OPEN_INDEX_SQL,
  PLAY_SESSIONS_OPEN_INVALID_INDEX_CHECK_SQL,
  PLAY_SESSIONS_OPEN_INVALID_INDEX_DROP_SQL,
  PLAYER_METRICS_CONCURRENT_INDEX_SQL,
  PLAYER_METRICS_INVALID_INDEX_CHECK_SQL,
  PLAYER_METRICS_INVALID_INDEX_DROP_SQL,
} from './player_metrics_db';

export interface ConcurrentIndexMigration {
  name: string;
  createSql: string;
  checkSql: string;
  dropSql: string;
}

export const CONCURRENT_INDEX_MIGRATIONS: readonly ConcurrentIndexMigration[] = [
  {
    name: 'play_sessions_account_started_id',
    createSql: PLAYER_METRICS_CONCURRENT_INDEX_SQL,
    checkSql: PLAYER_METRICS_INVALID_INDEX_CHECK_SQL,
    dropSql: PLAYER_METRICS_INVALID_INDEX_DROP_SQL,
  },
  {
    name: 'daily_reward_events_account_day_created_id',
    createSql: DAILY_REWARD_EVENTS_CONCURRENT_INDEX_SQL,
    checkSql: DAILY_REWARD_EVENTS_INVALID_INDEX_CHECK_SQL,
    dropSql: DAILY_REWARD_EVENTS_INVALID_INDEX_DROP_SQL,
  },
  {
    name: 'play_sessions_open_character',
    createSql: PLAY_SESSIONS_OPEN_INDEX_SQL,
    checkSql: PLAY_SESSIONS_OPEN_INVALID_INDEX_CHECK_SQL,
    dropSql: PLAY_SESSIONS_OPEN_INVALID_INDEX_DROP_SQL,
  },
];
