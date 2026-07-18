// Durable, low-write player analytics facts and their bounded read-side aggregate.
// Writes happen only at lifecycle boundaries (character creation, world entry,
// and session close). The game loop never queries these tables.
// Business reads touch at most two activity days plus three fixed retention cohorts,
// and run in a read-only transaction with short server-side timeouts.

import type { Pool, PoolClient } from 'pg';

export const PLAYER_METRICS_SCHEMA = `
CREATE TABLE IF NOT EXISTS player_account_facts (
  realm TEXT NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_created_at TIMESTAMPTZ NOT NULL,
  first_character_at TIMESTAMPTZ,
  first_play_at TIMESTAMPTZ,
  first_session_id INT REFERENCES play_sessions(id) ON DELETE SET NULL,
  first_session_ended_at TIMESTAMPTZ,
  first_session_seconds INT,
  first_session_max_level INT NOT NULL DEFAULT 1,
  PRIMARY KEY (realm, account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS player_account_facts_first_session_realm
  ON player_account_facts(first_session_id, realm);
ALTER TABLE player_account_facts
  DROP CONSTRAINT IF EXISTS player_account_facts_realm_first_session_id_key;
CREATE INDEX IF NOT EXISTS player_account_facts_first_character
  ON player_account_facts(realm, first_character_at)
  WHERE first_character_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS player_account_facts_first_play
  ON player_account_facts(realm, first_play_at)
  WHERE first_play_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS player_activity_daily (
  realm TEXT NOT NULL,
  day DATE NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sessions INT NOT NULL DEFAULT 0,
  playtime_seconds BIGINT NOT NULL DEFAULT 0,
  max_level INT NOT NULL DEFAULT 1,
  PRIMARY KEY (realm, day, account_id)
);

CREATE TABLE IF NOT EXISTS player_business_daily (
  realm TEXT NOT NULL,
  day DATE NOT NULL,
  characters_created INT NOT NULL DEFAULT 0,
  PRIMARY KEY (realm, day)
);
`;

// play_sessions can be large in production. This index is deliberately kept
// out of PLAYER_METRICS_SCHEMA because ensureSchema applies that schema inside
// a transaction, where CREATE INDEX CONCURRENTLY is not allowed. The boot
// coordinator runs this idempotent migration after committing the schema DDL.
export const PLAYER_METRICS_CONCURRENT_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_account_started_id
  ON play_sessions(account_id, started_at, id);
`;

// A CREATE INDEX CONCURRENTLY killed mid-build (a deploy-watchdog restart, a
// crash) strands the index INVALID, and IF NOT EXISTS then treats it as
// existing on every later boot: never rebuilt, unusable to the planner, yet
// maintained on every play_sessions write. The boot coordinator checks for
// that carcass and drops it (CONCURRENTLY, so peer realms' session writes
// never stall behind the drop) before running the create above. to_regclass
// resolves via search_path and returns NULL when the index does not exist.
export const PLAYER_METRICS_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('play_sessions_account_started_id')
   AND NOT i.indisvalid
`;

export const PLAYER_METRICS_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS play_sessions_account_started_id';

/** Fixed first-day playtime buckets; a bounded label set, never per-player data. */
export const FIRST_DAY_PLAYTIME_BUCKETS = [
  'lt_10m',
  '10m_30m',
  '30m_1h',
  '1h_3h',
  'gte_3h',
] as const;

export type FirstDayPlaytimeBucket = (typeof FIRST_DAY_PLAYTIME_BUCKETS)[number];

/** Ordered stages for the same-day account-created funnel. */
export const DAY_ONE_FUNNEL_STAGES = [
  'created',
  'first_character',
  'entered_world',
  'played_10m',
  'reached_level_2',
  'reached_level_5',
] as const;

export type DayOneFunnelStage = (typeof DAY_ONE_FUNNEL_STAGES)[number];

export interface PlayerBusinessDay {
  period: 'today' | 'yesterday';
  charactersCreated: number;
  firstCharacterAccounts: number;
  activeNew: number;
  activeReturning: number;
  avgPlaytimeSecondsAll: number | null;
  avgPlaytimeSecondsNew: number | null;
  avgPlaytimeSecondsLevel20: number | null;
  firstSessionMedianSeconds: number | null;
  firstSessionLevel2Rate: number | null;
  firstSessionLevel5Rate: number | null;
  firstDayPlaytimeP50Seconds: number | null;
  firstDayPlaytimeP90Seconds: number | null;
  firstDaySessionsMedian: number | null;
  firstDayPlaytimeAccounts: Record<FirstDayPlaytimeBucket, number>;
}

export interface PlayerFunnelDay {
  period: 'today' | 'yesterday';
  accountsCreated: number;
  firstWorldEntryRate: number | null;
  dayOneFunnelAccounts: Record<DayOneFunnelStage, number>;
}

export interface PlayerRetentionMetric {
  period: 'today' | 'yesterday';
  day: 1 | 7 | 30;
  rate: number | null;
}

export interface PlayerBusinessSnapshot {
  days: PlayerBusinessDay[];
  retention: PlayerRetentionMetric[];
}

export interface PlayerFunnelSnapshot {
  days: PlayerFunnelDay[];
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Whole-refresh deadline, including waiting for a pooled client. */
export const PLAYER_BUSINESS_SNAPSHOT_TIMEOUT_MS = 3_000;

function snapshotTimeoutError(snapshotName = 'player metrics snapshot'): Error {
  return new Error(`${snapshotName} timed out`);
}

/**
 * Wait for a pooled client until the snapshot deadline. If the pool hands the
 * client out after the deadline, destroy it immediately instead of leaking a
 * checked-out connection into shutdown.
 */
function acquireSnapshotClient(pool: Pool, signal: AbortSignal): Promise<PoolClient> {
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : snapshotTimeoutError());
  }

  const pending = pool.connect();
  return new Promise((resolve, reject) => {
    let settled = false;
    const removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(signal.reason instanceof Error ? signal.reason : snapshotTimeoutError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    void pending.then(
      (client) => {
        if (settled) {
          client.release(true);
          return;
        }
        settled = true;
        removeAbortListener();
        resolve(client);
      },
      (err) => {
        if (settled) return;
        settled = true;
        removeAbortListener();
        reject(err);
      },
    );
  });
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Record one successful character creation in the same transaction as the character. */
export async function recordCharacterCreation(
  db: Queryable,
  accountId: number,
  realm: string,
): Promise<void> {
  await db.query(
    `WITH account_fact AS (
       INSERT INTO player_account_facts (
         realm, account_id, account_created_at, first_character_at
       )
       SELECT $2, a.id, a.created_at, min(c.created_at)
         FROM accounts a
         JOIN characters c ON c.account_id = a.id AND c.realm = $2
        WHERE a.id = $1
        GROUP BY a.id, a.created_at
       ON CONFLICT (realm, account_id) DO UPDATE SET
         account_created_at = LEAST(
           player_account_facts.account_created_at,
           EXCLUDED.account_created_at
         ),
         first_character_at = CASE
           WHEN player_account_facts.first_character_at IS NULL
             THEN EXCLUDED.first_character_at
           ELSE LEAST(player_account_facts.first_character_at, EXCLUDED.first_character_at)
         END
     )
     INSERT INTO player_business_daily (realm, day, characters_created)
     VALUES ($2, (now() AT TIME ZONE 'UTC')::date, 1)
     ON CONFLICT (realm, day) DO UPDATE SET
       characters_created = player_business_daily.characters_created + 1`,
    [accountId, realm],
  );
}

export interface OpenPlayerSessionInput {
  accountId: number;
  characterId: number;
  characterName: string;
  realm: string;
  initialLevel: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Open the normal play session and seed the compact account/day facts in one statement. */
export async function openPlayerSession(
  db: Queryable,
  input: OpenPlayerSessionInput,
): Promise<number> {
  const res = await db.query(
    `WITH opened AS (
       INSERT INTO play_sessions (
         account_id, character_id, character_name, ip_address, user_agent
       )
       VALUES ($1, $2, $3, $6, $7)
       RETURNING id, account_id, started_at
     ), account_seed AS (
       SELECT a.id AS account_id, a.created_at AS account_created_at,
              min(c.created_at) AS first_character_at
         FROM accounts a
         LEFT JOIN characters c ON c.account_id = a.id AND c.realm = $4
        WHERE a.id = $1
        GROUP BY a.id, a.created_at
     ), prior_session AS (
       SELECT sessions.id, sessions.started_at, sessions.ended_at
         FROM play_sessions sessions
         JOIN characters c ON c.id = sessions.character_id AND c.realm = $4
        WHERE sessions.account_id = $1
        ORDER BY sessions.started_at, sessions.id
        LIMIT 1
     ), account_fact AS (
       INSERT INTO player_account_facts (
         realm, account_id, account_created_at, first_character_at,
         first_play_at, first_session_id, first_session_ended_at,
         first_session_seconds, first_session_max_level
       )
       SELECT $4, seed.account_id, seed.account_created_at, seed.first_character_at,
              COALESCE(prior.started_at, opened.started_at),
              COALESCE(prior.id, opened.id),
              prior.ended_at,
              CASE WHEN prior.ended_at IS NULL THEN NULL ELSE GREATEST(
                0,
                FLOOR(EXTRACT(EPOCH FROM (prior.ended_at - prior.started_at)))::int
              ) END,
              CASE WHEN prior.id IS NULL THEN $5 ELSE 1 END
         FROM account_seed seed
         CROSS JOIN opened
         LEFT JOIN prior_session prior ON TRUE
       ON CONFLICT (realm, account_id) DO UPDATE SET
         account_created_at = LEAST(
           player_account_facts.account_created_at,
           EXCLUDED.account_created_at
         ),
         first_character_at = CASE
           WHEN player_account_facts.first_character_at IS NULL
             THEN EXCLUDED.first_character_at
           WHEN EXCLUDED.first_character_at IS NULL
             THEN player_account_facts.first_character_at
           ELSE LEAST(player_account_facts.first_character_at, EXCLUDED.first_character_at)
         END,
         first_play_at = COALESCE(player_account_facts.first_play_at, EXCLUDED.first_play_at),
         first_session_id = COALESCE(
           player_account_facts.first_session_id,
           EXCLUDED.first_session_id
         ),
         first_session_max_level = CASE
           WHEN player_account_facts.first_session_id IS NULL
             THEN EXCLUDED.first_session_max_level
           ELSE player_account_facts.first_session_max_level
         END
       RETURNING 1
     ), activity AS (
       -- A reconnect can race the prior session's grace-expiry close. Reading
       -- account_fact here enforces facts-before-activity lock order in both
       -- statements instead of relying on textual CTE order.
       INSERT INTO player_activity_daily (
         realm, day, account_id, sessions, playtime_seconds, max_level
       )
       SELECT $4, (opened.started_at AT TIME ZONE 'UTC')::date,
              opened.account_id, 1, 0, $5
         FROM opened
        CROSS JOIN (SELECT count(*) FROM account_fact) AS account_fact_done
       ON CONFLICT (realm, day, account_id) DO UPDATE SET
         sessions = player_activity_daily.sessions + 1,
         max_level = GREATEST(player_activity_daily.max_level, EXCLUDED.max_level)
       RETURNING 1
     )
     SELECT opened.id
       FROM opened
      CROSS JOIN (SELECT count(*) FROM activity) AS activity_done`,
    [
      input.accountId,
      input.characterId,
      input.characterName,
      input.realm,
      input.initialLevel,
      input.ipAddress,
      input.userAgent,
    ],
  );
  return Number(res.rows[0]?.id);
}

/**
 * Close one session exactly once, split its duration across UTC calendar days,
 * and finalize first-session facts when this was the account's first session.
 */
export async function closePlayerSession(
  db: Queryable,
  sessionId: number,
  realm: string,
  maxLevel: number,
): Promise<void> {
  await db.query(
    `WITH closed AS (
       UPDATE play_sessions
          SET ended_at = now()
        WHERE id = $1 AND ended_at IS NULL
       RETURNING id, account_id, started_at, ended_at
     ), segments AS (
       SELECT closed.account_id,
              (boundary AT TIME ZONE 'UTC')::date AS day,
              FLOOR(EXTRACT(EPOCH FROM (
                LEAST(closed.ended_at, boundary + interval '1 day')
                - GREATEST(closed.started_at, boundary)
              )))::bigint AS playtime_seconds
         FROM closed
         CROSS JOIN LATERAL generate_series(
           date_trunc('day', closed.started_at, 'UTC'),
           date_trunc('day', closed.ended_at, 'UTC'),
           interval '1 day'
         ) AS boundary
    ), account_fact AS (
       UPDATE player_account_facts facts
        SET first_session_ended_at = closed.ended_at,
            first_session_seconds = GREATEST(
              0,
              FLOOR(EXTRACT(EPOCH FROM (closed.ended_at - closed.started_at)))::int
            ),
            first_session_max_level = GREATEST(facts.first_session_max_level, $3)
       FROM closed
      WHERE facts.realm = $2
        AND facts.account_id = closed.account_id
        AND facts.first_session_id = closed.id
       RETURNING 1
     )
     INSERT INTO player_activity_daily (
       realm, day, account_id, sessions, playtime_seconds, max_level
     )
     SELECT $2, day, account_id, 0, GREATEST(playtime_seconds, 0), $3
       FROM segments
      CROSS JOIN (SELECT count(*) FROM account_fact) AS account_fact_done
     ON CONFLICT (realm, day, account_id) DO UPDATE SET
       playtime_seconds = player_activity_daily.playtime_seconds
         + EXCLUDED.playtime_seconds,
       max_level = GREATEST(player_activity_daily.max_level, EXCLUDED.max_level)`,
    [sessionId, realm, maxLevel],
  );
}

/** Close crash-orphaned sessions at zero duration without scanning completed sessions. */
export async function closeOrphanPlayerSessions(db: Queryable, realm: string): Promise<number> {
  const res = await db.query(
    `WITH closed AS (
       UPDATE play_sessions ps
          SET ended_at = ps.started_at
         FROM characters c
        WHERE ps.character_id = c.id
          AND c.realm = $1
          AND ps.ended_at IS NULL
       RETURNING ps.id, ps.account_id, ps.started_at
     ), finalized AS (
       UPDATE player_account_facts facts
          SET first_session_ended_at = closed.started_at,
              first_session_seconds = 0
         FROM closed
        WHERE facts.realm = $1
          AND facts.account_id = closed.account_id
          AND facts.first_session_id = closed.id
     )
     SELECT count(*)::int AS closed_count FROM closed`,
    [realm],
  );
  return Number(res.rows[0]?.closed_count ?? 0);
}

export const PLAYER_BUSINESS_SNAPSHOT_SQL = `
WITH days(period, day) AS (
  VALUES
    ('today'::text, current_date),
    ('yesterday'::text, current_date - 1)
), daily AS (
  SELECT days.period, days.day,
         COALESCE((SELECT characters_created
                     FROM player_business_daily
                    WHERE realm = $1 AND day = days.day), 0)::int AS characters_created,
         (SELECT count(*)::int
            FROM player_account_facts
           WHERE realm = $1
             AND first_character_at >= days.day
             AND first_character_at < days.day + 1) AS first_character_accounts
    FROM days
), activity AS (
  -- Keep active-account reads proportional to each selected day. The lateral
  -- range uses the activity primary key instead of letting a grouped two-day
  -- join hash the durable activity and fact tables in full.
  SELECT days.period, activity_stats.*
    FROM days
    CROSS JOIN LATERAL (
      SELECT count(activity.account_id)::int AS active_total,
             avg(activity.playtime_seconds)::double precision AS avg_playtime_all,
             avg(activity.playtime_seconds) FILTER (
               WHERE activity.max_level >= 20
             )::double precision AS avg_playtime_level_20
        FROM player_activity_daily activity
       WHERE activity.realm = $1 AND activity.day = days.day
    ) AS activity_stats
), day_one AS (
  -- Day-one aggregates live in their own per-day LATERAL so the ordered-set
  -- percentiles sort only that day's new-player cohort (facts via the
  -- first_play partial index, one primary-key activity row per account).
  -- Folding them into the activity CTE would disable hashed aggregation for
  -- that node (ordered-set aggregates force sorted grouping) and push the
  -- whole two-day rowset through an external sort; a per-day plain aggregate
  -- has no grouping sort at all and still returns one row for an empty day.
  SELECT days.period, day_stats.*
    FROM days
    CROSS JOIN LATERAL (
      SELECT count(activity.account_id)::int AS active_new,
             avg(activity.playtime_seconds)::double precision AS avg_playtime_new,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY activity.playtime_seconds
             )::double precision AS playtime_p50_new,
             percentile_cont(0.9) WITHIN GROUP (
               ORDER BY activity.playtime_seconds
             )::double precision AS playtime_p90_new,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY activity.sessions
             )::double precision AS sessions_p50_new,
             count(activity.account_id) FILTER (
               WHERE activity.playtime_seconds < 600
             )::int AS new_playtime_lt_10m,
             count(activity.account_id) FILTER (
               WHERE activity.playtime_seconds >= 600
                 AND activity.playtime_seconds < 1800
             )::int AS new_playtime_10m_30m,
             count(activity.account_id) FILTER (
               WHERE activity.playtime_seconds >= 1800
                 AND activity.playtime_seconds < 3600
             )::int AS new_playtime_30m_1h,
             count(activity.account_id) FILTER (
               WHERE activity.playtime_seconds >= 3600
                 AND activity.playtime_seconds < 10800
             )::int AS new_playtime_1h_3h,
             count(activity.account_id) FILTER (
               WHERE activity.playtime_seconds >= 10800
             )::int AS new_playtime_gte_3h
        FROM player_account_facts facts
        JOIN player_activity_daily activity
          ON activity.realm = $1
         AND activity.day = days.day
         AND activity.account_id = facts.account_id
       WHERE facts.realm = $1
         AND facts.first_play_at >= days.day
         AND facts.first_play_at < days.day + 1
    ) AS day_stats
), first_sessions AS (
  SELECT days.period, first_session_stats.*
    FROM days
    CROSS JOIN LATERAL (
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY facts.first_session_seconds
             )::double precision AS median_seconds,
             count(*) FILTER (
               WHERE facts.first_session_max_level >= 2
             )::double precision / NULLIF(count(facts.account_id), 0) AS level_2_rate,
             count(*) FILTER (
               WHERE facts.first_session_max_level >= 5
             )::double precision / NULLIF(count(facts.account_id), 0) AS level_5_rate
        FROM player_account_facts facts
       WHERE facts.realm = $1
         AND facts.first_play_at >= days.day
         AND facts.first_play_at < days.day + 1
         AND facts.first_session_ended_at IS NOT NULL
    ) AS first_session_stats
), retention_offsets(retention_day) AS (
  VALUES (1), (7), (30)
), retention AS (
  -- Resolve each fixed cohort through the first-play and daily-activity
  -- indexes. Grouping all six cohorts together invites full-table hash joins
  -- as the durable fact and activity tables grow.
  SELECT days.period, retention_offsets.retention_day, retention_stats.retention_rate
    FROM days
    CROSS JOIN retention_offsets
    CROSS JOIN LATERAL (
      SELECT count(activity.account_id)::double precision
               / NULLIF(count(facts.account_id), 0) AS retention_rate
        FROM player_account_facts facts
        LEFT JOIN player_activity_daily activity
          ON activity.realm = facts.realm
         AND activity.account_id = facts.account_id
         AND activity.day = days.day
       WHERE facts.realm = $1
         AND facts.first_play_at >= days.day - retention_offsets.retention_day
         AND facts.first_play_at < days.day - retention_offsets.retention_day + 1
    ) AS retention_stats
)
SELECT daily.period,
       daily.characters_created,
       daily.first_character_accounts,
       day_one.active_new,
       GREATEST(activity.active_total - day_one.active_new, 0)::int AS active_returning,
       activity.avg_playtime_all,
       day_one.avg_playtime_new,
       activity.avg_playtime_level_20,
       first_sessions.median_seconds,
       first_sessions.level_2_rate,
       first_sessions.level_5_rate,
       day_one.playtime_p50_new,
       day_one.playtime_p90_new,
       day_one.sessions_p50_new,
       day_one.new_playtime_lt_10m,
       day_one.new_playtime_10m_30m,
       day_one.new_playtime_30m_1h,
       day_one.new_playtime_1h_3h,
       day_one.new_playtime_gte_3h,
       (SELECT jsonb_object_agg(retention_day, retention_rate)
          FROM retention
         WHERE retention.period = daily.period) AS retention
  FROM daily
  JOIN activity USING (period)
  JOIN first_sessions USING (period)
  JOIN day_one USING (period)
 ORDER BY CASE daily.period WHEN 'today' THEN 0 ELSE 1 END
`;

export const PLAYER_FUNNEL_SNAPSHOT_SQL = `
WITH days(period, day) AS (
  VALUES
    ('today'::text, current_date),
    ('yesterday'::text, current_date - 1)
), created AS (
  -- Count factless registrations with one contiguous accounts.created_at range
  -- scan per selected day. Later stages never probe from this account rowset.
  SELECT days.period, days.day, count(accounts.id)::int AS funnel_created
    FROM days
    LEFT JOIN accounts
      ON accounts.created_at >= days.day
     AND accounts.created_at < days.day + 1
   GROUP BY days.period, days.day
), first_character AS (
  -- Start at the completed stage, not at every signup. account_created_at keeps
  -- this on the same account-created cohort while first_character_at selects the
  -- existing realm/day index before applying that residual cohort check.
  SELECT days.period,
         count(facts.account_id)::int AS funnel_first_character
    FROM days
    LEFT JOIN player_account_facts facts
      ON facts.realm = $1
     AND facts.first_character_at >= days.day
     AND facts.first_character_at < days.day + 1
     AND facts.account_created_at >= days.day
     AND facts.account_created_at < days.day + 1
   GROUP BY days.period
), play_stages AS (
  -- First-play and activity stages are one set join over the small completed
  -- cohort. A factless signup never causes a facts or activity primary-key probe.
  SELECT days.period,
         count(facts.account_id)::int AS funnel_entered_world,
         count(activity.account_id) FILTER (
           WHERE activity.playtime_seconds >= 600
         )::int AS funnel_played_10m,
         count(activity.account_id) FILTER (
           WHERE activity.max_level >= 2
         )::int AS funnel_reached_level_2,
         count(activity.account_id) FILTER (
           WHERE activity.max_level >= 5
         )::int AS funnel_reached_level_5
    FROM days
    LEFT JOIN player_account_facts facts
      ON facts.realm = $1
     AND facts.first_play_at >= days.day
     AND facts.first_play_at < days.day + 1
     AND facts.first_character_at >= days.day
     AND facts.first_character_at < days.day + 1
     AND facts.account_created_at >= days.day
     AND facts.account_created_at < days.day + 1
    LEFT JOIN player_activity_daily activity
      ON activity.realm = $1
     AND activity.day = days.day
     AND activity.account_id = facts.account_id
   GROUP BY days.period
)
SELECT created.period,
       created.funnel_created AS accounts_created,
       play_stages.funnel_entered_world::double precision
         / NULLIF(created.funnel_created, 0) AS first_world_entry_rate,
       first_character.funnel_first_character,
       play_stages.funnel_entered_world,
       play_stages.funnel_played_10m,
       play_stages.funnel_reached_level_2,
       play_stages.funnel_reached_level_5
  FROM created
  JOIN first_character USING (period)
  JOIN play_stages USING (period)
 ORDER BY CASE created.period WHEN 'today' THEN 0 ELSE 1 END
`;

function mapBusinessDay(row: Record<string, unknown>): PlayerBusinessDay {
  return {
    period: row.period === 'yesterday' ? 'yesterday' : 'today',
    charactersCreated: Number(row.characters_created ?? 0),
    firstCharacterAccounts: Number(row.first_character_accounts ?? 0),
    activeNew: Number(row.active_new ?? 0),
    activeReturning: Number(row.active_returning ?? 0),
    avgPlaytimeSecondsAll: numberOrNull(row.avg_playtime_all),
    avgPlaytimeSecondsNew: numberOrNull(row.avg_playtime_new),
    avgPlaytimeSecondsLevel20: numberOrNull(row.avg_playtime_level_20),
    firstSessionMedianSeconds: numberOrNull(row.median_seconds),
    firstSessionLevel2Rate: numberOrNull(row.level_2_rate),
    firstSessionLevel5Rate: numberOrNull(row.level_5_rate),
    firstDayPlaytimeP50Seconds: numberOrNull(row.playtime_p50_new),
    firstDayPlaytimeP90Seconds: numberOrNull(row.playtime_p90_new),
    firstDaySessionsMedian: numberOrNull(row.sessions_p50_new),
    firstDayPlaytimeAccounts: {
      lt_10m: Number(row.new_playtime_lt_10m ?? 0),
      '10m_30m': Number(row.new_playtime_10m_30m ?? 0),
      '30m_1h': Number(row.new_playtime_30m_1h ?? 0),
      '1h_3h': Number(row.new_playtime_1h_3h ?? 0),
      gte_3h: Number(row.new_playtime_gte_3h ?? 0),
    },
  };
}

function mapFunnelDay(row: Record<string, unknown>): PlayerFunnelDay {
  return {
    period: row.period === 'yesterday' ? 'yesterday' : 'today',
    accountsCreated: Number(row.accounts_created ?? 0),
    firstWorldEntryRate: numberOrNull(row.first_world_entry_rate),
    dayOneFunnelAccounts: {
      created: Number(row.accounts_created ?? 0),
      first_character: Number(row.funnel_first_character ?? 0),
      entered_world: Number(row.funnel_entered_world ?? 0),
      played_10m: Number(row.funnel_played_10m ?? 0),
      reached_level_2: Number(row.funnel_reached_level_2 ?? 0),
      reached_level_5: Number(row.funnel_reached_level_5 ?? 0),
    },
  };
}

function mapRetention(
  period: PlayerRetentionMetric['period'],
  value: unknown,
): PlayerRetentionMetric[] {
  const rows = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return ([1, 7, 30] as const).map((day) => ({
    period,
    day,
    rate: numberOrNull(rows[String(day)]),
  }));
}

/** Run one bounded metrics snapshot under the shared fail-fast database limits. */
async function playerMetricsSnapshotRows(
  pool: Pool,
  realm: string,
  sql: string,
  snapshotName: string,
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(snapshotTimeoutError(snapshotName)),
    Math.max(1, timeoutMs),
  );
  timer.unref();

  let client: PoolClient | null = null;
  let released = false;
  const releaseClient = (destroy = false) => {
    if (!client || released) return;
    released = true;
    client.release(destroy);
  };
  const abortActiveClient = () => releaseClient(true);

  try {
    client = await acquireSnapshotClient(pool, deadline.signal);
    deadline.signal.addEventListener('abort', abortActiveClient, { once: true });
    if (deadline.signal.aborted) abortActiveClient();

    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL lock_timeout = '250ms'");
    await client.query("SET LOCAL statement_timeout = '2000ms'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const res = await client.query(sql, [realm]);
    await client.query('COMMIT');
    return res.rows as Record<string, unknown>[];
  } catch (err) {
    if (client && !released) await client.query('ROLLBACK').catch(() => {});
    if (deadline.signal.aborted && deadline.signal.reason instanceof Error) {
      throw deadline.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    deadline.signal.removeEventListener('abort', abortActiveClient);
    releaseClient();
  }
}

export async function playerBusinessSnapshot(
  pool: Pool,
  realm: string,
  timeoutMs: number = PLAYER_BUSINESS_SNAPSHOT_TIMEOUT_MS,
): Promise<PlayerBusinessSnapshot> {
  const rows = await playerMetricsSnapshotRows(
    pool,
    realm,
    PLAYER_BUSINESS_SNAPSHOT_SQL,
    'player business snapshot',
    timeoutMs,
  );
  return {
    days: rows.map(mapBusinessDay),
    retention: rows.flatMap((row) =>
      mapRetention(row.period === 'yesterday' ? 'yesterday' : 'today', row.retention),
    ),
  };
}

export async function playerFunnelSnapshot(
  pool: Pool,
  realm: string,
  timeoutMs: number = PLAYER_BUSINESS_SNAPSHOT_TIMEOUT_MS,
): Promise<PlayerFunnelSnapshot> {
  const rows = await playerMetricsSnapshotRows(
    pool,
    realm,
    PLAYER_FUNNEL_SNAPSHOT_SQL,
    'player funnel snapshot',
    timeoutMs,
  );
  return { days: rows.map(mapFunnelDay) };
}
