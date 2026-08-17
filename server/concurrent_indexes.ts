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
  ADMIN_OVERVIEW_ACTIVE_SESSIONS_INDEX_SQL,
  ADMIN_OVERVIEW_ACTIVE_SESSIONS_INVALID_INDEX_CHECK_SQL,
  ADMIN_OVERVIEW_ACTIVE_SESSIONS_INVALID_INDEX_DROP_SQL,
} from './admin_db_indexes';
import {
  GUILDS_REALM_CREATED_ID_INDEX_SQL,
  GUILDS_REALM_CREATED_ID_INVALID_INDEX_CHECK_SQL,
  GUILDS_REALM_CREATED_ID_INVALID_INDEX_DROP_SQL,
  GUILDS_REALM_LOWER_NAME_PREFIX_INDEX_SQL,
  GUILDS_REALM_LOWER_NAME_PREFIX_INVALID_INDEX_CHECK_SQL,
  GUILDS_REALM_LOWER_NAME_PREFIX_INVALID_INDEX_DROP_SQL,
} from './admin_guilds_schema';
import {
  BANK_LEDGER_CONTAINER_INDEX_SQL,
  BANK_LEDGER_CONTAINER_INVALID_INDEX_CHECK_SQL,
  BANK_LEDGER_CONTAINER_INVALID_INDEX_DROP_SQL,
} from './bank_ledger_indexes';
import {
  CHAT_VIOLATIONS_RETENTION_INDEX_SQL,
  CHAT_VIOLATIONS_RETENTION_INVALID_INDEX_CHECK_SQL,
  CHAT_VIOLATIONS_RETENTION_INVALID_INDEX_DROP_SQL,
} from './chat_violations_retention_index';
import {
  CLIENT_PERF_WORST10S_INDEX_SQL,
  CLIENT_PERF_WORST10S_INVALID_INDEX_CHECK_SQL,
  CLIENT_PERF_WORST10S_INVALID_INDEX_DROP_SQL,
} from './client_perf_indexes';
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
import {
  PLAYER_REPORTS_RETENTION_INDEX_SQL,
  PLAYER_REPORTS_RETENTION_INVALID_INDEX_CHECK_SQL,
  PLAYER_REPORTS_RETENTION_INVALID_INDEX_DROP_SQL,
} from './player_reports_retention_index';

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
  {
    name: 'client_perf_reports_worst10s_created',
    createSql: CLIENT_PERF_WORST10S_INDEX_SQL,
    checkSql: CLIENT_PERF_WORST10S_INVALID_INDEX_CHECK_SQL,
    dropSql: CLIENT_PERF_WORST10S_INVALID_INDEX_DROP_SQL,
  },
  {
    name: 'play_sessions_ended_account',
    createSql: ADMIN_OVERVIEW_ACTIVE_SESSIONS_INDEX_SQL,
    checkSql: ADMIN_OVERVIEW_ACTIVE_SESSIONS_INVALID_INDEX_CHECK_SQL,
    dropSql: ADMIN_OVERVIEW_ACTIVE_SESSIONS_INVALID_INDEX_DROP_SQL,
  },
  {
    name: 'guilds_realm_lower_name_prefix',
    createSql: GUILDS_REALM_LOWER_NAME_PREFIX_INDEX_SQL,
    checkSql: GUILDS_REALM_LOWER_NAME_PREFIX_INVALID_INDEX_CHECK_SQL,
    dropSql: GUILDS_REALM_LOWER_NAME_PREFIX_INVALID_INDEX_DROP_SQL,
  },
  {
    name: 'guilds_realm_created_id',
    createSql: GUILDS_REALM_CREATED_ID_INDEX_SQL,
    checkSql: GUILDS_REALM_CREATED_ID_INVALID_INDEX_CHECK_SQL,
    dropSql: GUILDS_REALM_CREATED_ID_INVALID_INDEX_DROP_SQL,
  },
  // The guild bank activity log's per-guild reader (server/guild_bank_log.ts).
  // Appended, never inserted: the order is load-bearing and pinned.
  {
    name: 'bank_ledger_container_recent',
    createSql: BANK_LEDGER_CONTAINER_INDEX_SQL,
    checkSql: BANK_LEDGER_CONTAINER_INVALID_INDEX_CHECK_SQL,
    dropSql: BANK_LEDGER_CONTAINER_INVALID_INDEX_DROP_SQL,
  },
  // The player_reports retention-sweep prune (moderation_db.ts
  // prunePlayerReportsBatch). Partial on the resolved-report predicate the
  // prune actually scans; see player_reports_retention_index.ts.
  {
    name: 'player_reports_retention_created',
    createSql: PLAYER_REPORTS_RETENTION_INDEX_SQL,
    checkSql: PLAYER_REPORTS_RETENTION_INVALID_INDEX_CHECK_SQL,
    dropSql: PLAYER_REPORTS_RETENTION_INVALID_INDEX_DROP_SQL,
  },
  // The chat_violations retention-sweep prune (chat_filter_db.ts
  // pruneChatViolationsBatch). See chat_violations_retention_index.ts.
  {
    name: 'chat_violations_retention_created',
    createSql: CHAT_VIOLATIONS_RETENTION_INDEX_SQL,
    checkSql: CHAT_VIOLATIONS_RETENTION_INVALID_INDEX_CHECK_SQL,
    dropSql: CHAT_VIOLATIONS_RETENTION_INVALID_INDEX_DROP_SQL,
  },
];
