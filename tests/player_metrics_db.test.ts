import { describe, expect, it, vi } from 'vitest';
import {
  closeOrphanPlayerSessions,
  closePlayerSession,
  DAY_ONE_FUNNEL_STAGES,
  openPlayerSession,
  PLAYER_BUSINESS_SNAPSHOT_SQL,
  PLAYER_FUNNEL_SNAPSHOT_SQL,
  PLAYER_METRICS_CONCURRENT_INDEX_SQL,
  PLAYER_METRICS_SCHEMA,
  playerBusinessSnapshot,
  playerFunnelSnapshot,
  prunePlayerActivityDailyBatch,
  recordCharacterCreation,
} from '../server/player_metrics_db';

function queryable(rows: Record<string, unknown>[] = []) {
  return { query: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows })) };
}

describe('player metric lifecycle facts', () => {
  it('uses additive indexed schema with no boot backfill', () => {
    expect(PLAYER_METRICS_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS player_account_facts');
    expect(PLAYER_METRICS_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS player_activity_daily');
    expect(PLAYER_METRICS_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS player_business_daily');
    expect(PLAYER_METRICS_SCHEMA).toContain('PRIMARY KEY (realm, day, account_id)');
    expect(PLAYER_METRICS_SCHEMA).toContain('ON player_account_facts(first_session_id, realm)');
    expect(PLAYER_METRICS_SCHEMA).not.toContain('ON play_sessions(account_id, started_at, id)');
    expect(PLAYER_METRICS_CONCURRENT_INDEX_SQL).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_account_started_id',
    );
    expect(PLAYER_METRICS_CONCURRENT_INDEX_SQL).toContain(
      'ON play_sessions(account_id, started_at, id)',
    );
    expect(PLAYER_METRICS_SCHEMA).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/);
  });

  it('records character creation and first-character facts in one statement', async () => {
    const db = queryable();
    await recordCharacterCreation(db, 7, 'eastbrook');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO player_account_facts');
    expect(sql).toContain('min(c.created_at)');
    expect(sql).toContain('INSERT INTO player_business_daily');
    expect(sql).toContain('ON CONFLICT (realm, day) DO UPDATE');
    expect(params).toEqual([7, 'eastbrook']);
  });

  it('opens a session and seeds first-play plus daily activity atomically', async () => {
    const db = queryable([{ id: 99 }]);
    await expect(
      openPlayerSession(db, {
        accountId: 7,
        characterId: 42,
        characterName: 'Alice',
        realm: 'eastbrook',
        initialLevel: 3,
        ipAddress: '203.0.113.6',
        userAgent: 'Mozilla/5.0',
      }),
    ).resolves.toBe(99);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO play_sessions');
    expect(sql).toContain('INSERT INTO player_account_facts');
    expect(sql).toContain('INSERT INTO player_activity_daily');
    expect(sql).toContain('COALESCE(player_account_facts.first_play_at');
    expect(sql).toContain('SELECT count(*) FROM account_fact');
    expect(params).toEqual([7, 42, 'Alice', 'eastbrook', 3, '203.0.113.6', 'Mozilla/5.0']);
  });

  it('closes once, splits cross-midnight playtime, and finalizes the first session', async () => {
    const db = queryable();
    await closePlayerSession(db, 99, 'eastbrook', 5);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND ended_at IS NULL');
    expect(sql).toContain('generate_series');
    expect(sql).toContain("date_trunc('day', closed.started_at, 'UTC')");
    expect(sql).toContain('first_session_seconds');
    expect(sql).toContain('first_session_max_level');
    expect(sql.indexOf('UPDATE player_account_facts')).toBeLessThan(
      sql.indexOf('INSERT INTO player_activity_daily'),
    );
    expect(sql).toContain('SELECT count(*) FROM account_fact');
    expect(params).toEqual([99, 'eastbrook', 5]);
  });

  it('closes only realm-scoped crash orphans at zero duration', async () => {
    const db = queryable([{ closed_count: 4 }]);
    await expect(closeOrphanPlayerSessions(db, 'eastbrook')).resolves.toBe(4);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('c.realm = $1');
    expect(sql).toContain('SET ended_at = ps.started_at');
    expect(sql).toContain('first_session_seconds = 0');
    expect(params).toEqual(['eastbrook']);
  });
});

describe('player activity retention prune', () => {
  const prunedb = (rowCount: number | null = 0) => ({
    query: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount })),
  });

  it('deletes one bounded unordered batch by composite key and reports the row count', async () => {
    const db = prunedb(3);
    await expect(prunePlayerActivityDailyBatch(db, 400, 500)).resolves.toBe(3);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM player_activity_daily');
    // The table has no id column: the batch subquery selects the composite
    // primary key, and the bounded LIMIT keeps each call a short statement on
    // the default allowance (the sweep drives iteration).
    expect(sql).toContain('(realm, day, account_id) IN');
    // Deliberately UNORDERED, unlike the sibling prunes (their age column is
    // indexed): no index leads on day, so an ORDER BY here would force a full
    // scan plus a top-N sort of every expired row per batch, while an
    // unordered LIMIT early-stops once the batch fills. Deletion order among
    // expired rows is immaterial; pin the absence so oldest-first is never
    // "restored" by symmetry with the siblings.
    expect(sql).not.toContain('ORDER BY');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([400, 500]);
  });

  it('keeps a row exactly retentionDays old: strict less-than against the UTC-day cutoff', async () => {
    const db = prunedb();
    await prunePlayerActivityDailyBatch(db, 400, 500);
    const [sql] = db.query.mock.calls[0];
    // The writers stamp day as the UTC calendar day, so the cutoff must ride
    // the same clock, NEVER the reward-clock day (which rolls at a configured
    // offset). Pinned as a literal so a clock swap reds here.
    expect(sql).toContain("day < (now() AT TIME ZONE 'UTC')::date - $1::int");
    // Strictly less-than: a row whose day is exactly retentionDays old STAYS
    // (the kept window is [today - days, today], 400 kept days by default). A
    // <= flip widens the delete by one day; it breaks the literal above and
    // trips this spelling negative.
    expect(sql).not.toContain('day <=');
  });

  it('keep-forever and garbage retention values delete nothing without touching the db', async () => {
    for (const days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const db = prunedb(99);
      await expect(prunePlayerActivityDailyBatch(db, days, 500)).resolves.toBe(0);
      expect(db.query).not.toHaveBeenCalled();
    }
  });

  it('clamps fractional retention days up to one day and floors the batch size to one', async () => {
    const db = prunedb();
    await prunePlayerActivityDailyBatch(db, 0.5, 0);
    // 0.5 must clamp to one day, never floor to day zero (a zero-day cutoff is
    // TODAY: it would delete every historical row while keeping the config
    // nominally on); a 0 batch binds LIMIT 1, never LIMIT 0.
    expect(db.query.mock.calls[0][1]).toEqual([1, 1]);
    // A fractional value above one floors DOWN (400.7 binds 400 days), the
    // same Math.floor the sibling prunes apply; only the sub-one case clamps UP.
    const db2 = prunedb();
    await prunePlayerActivityDailyBatch(db2, 400.7, 500);
    expect(db2.query.mock.calls[0][1]).toEqual([400, 500]);
  });
});

describe('player business snapshot safety', () => {
  it('bounds reads to two days and fixed D1, D7, and D30 cohorts', () => {
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain("('today'::text, current_date)");
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain("('yesterday'::text, current_date - 1)");
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('VALUES (1), (7), (30)');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('activity.day = days.day');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('retention.period = daily.period');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).not.toContain('play_sessions');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).not.toMatch(/FROM characters\b/);
  });

  it('keeps first-play engagement separate from the account-created funnel', () => {
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('AS playtime_p50_new');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('AS playtime_p90_new');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('AS sessions_p50_new');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('AS new_playtime_lt_10m');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('AS new_playtime_10m_30m');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('AS new_playtime_30m_1h');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('AS new_playtime_1h_3h');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toContain('AS new_playtime_gte_3h');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).toMatch(
      /WHERE facts\.realm = \$1\s+AND facts\.first_play_at >= days\.day/,
    );
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).not.toContain('AS funnel_created');
    expect(PLAYER_BUSINESS_SNAPSHOT_SQL).not.toContain('FROM accounts');

    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('AS funnel_created');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('AS funnel_first_character');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('AS funnel_entered_world');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('AS funnel_played_10m');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('AS funnel_reached_level_2');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('AS funnel_reached_level_5');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('accounts.created_at >= days.day');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('facts.first_character_at >= days.day');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('facts.first_play_at >= days.day');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('facts.account_created_at >= days.day');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).toContain('activity.account_id = facts.account_id');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).not.toContain('facts.account_id = accounts.id');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).not.toContain('activity.account_id = accounts.id');
    expect(PLAYER_FUNNEL_SNAPSHOT_SQL).not.toContain('LEFT JOIN LATERAL');
    expect(DAY_ONE_FUNNEL_STAGES).toEqual([
      'created',
      'first_character',
      'entered_world',
      'played_10m',
      'reached_level_2',
      'reached_level_5',
    ]);
  });

  it('uses read-only server-side timeouts and maps nullable rates', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === PLAYER_BUSINESS_SNAPSHOT_SQL) {
        return {
          rows: [
            {
              period: 'today',
              characters_created: 3,
              first_character_accounts: 2,
              active_new: 1,
              active_returning: 4,
              avg_playtime_all: 100,
              avg_playtime_new: null,
              avg_playtime_level_20: 200,
              median_seconds: 60,
              level_2_rate: 0.75,
              level_5_rate: null,
              playtime_p50_new: 90,
              playtime_p90_new: null,
              sessions_p50_new: 1,
              new_playtime_lt_10m: 1,
              new_playtime_10m_30m: 0,
              new_playtime_30m_1h: 0,
              new_playtime_1h_3h: 0,
              new_playtime_gte_3h: 0,
              retention: { 1: 0.4, 7: null, 30: null },
            },
            {
              period: 'yesterday',
              characters_created: 1,
              first_character_accounts: 1,
              active_new: 1,
              active_returning: 0,
              avg_playtime_all: 80,
              avg_playtime_new: 80,
              avg_playtime_level_20: null,
              median_seconds: 40,
              level_2_rate: 0.5,
              level_5_rate: 0,
              playtime_p50_new: 80,
              playtime_p90_new: 80,
              sessions_p50_new: 2,
              new_playtime_lt_10m: 0,
              new_playtime_10m_30m: 0,
              new_playtime_30m_1h: 0,
              new_playtime_1h_3h: 1,
              new_playtime_gte_3h: 0,
              retention: { 1: 0.6, 7: 0.3, 30: null },
            },
          ],
        };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })) };

    const result = await playerBusinessSnapshot(pool as never, 'eastbrook');

    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN READ ONLY',
      "SET LOCAL lock_timeout = '250ms'",
      "SET LOCAL statement_timeout = '2000ms'",
      "SET LOCAL TIME ZONE 'UTC'",
      PLAYER_BUSINESS_SNAPSHOT_SQL,
      'COMMIT',
    ]);
    expect(query.mock.calls[4][1]).toEqual(['eastbrook']);
    expect(result.days[0]).toMatchObject({
      period: 'today',
      charactersCreated: 3,
      firstCharacterAccounts: 2,
      activeNew: 1,
      activeReturning: 4,
      avgPlaytimeSecondsAll: 100,
      avgPlaytimeSecondsNew: null,
      avgPlaytimeSecondsLevel20: 200,
      firstSessionMedianSeconds: 60,
      firstSessionLevel2Rate: 0.75,
      firstSessionLevel5Rate: null,
      firstDayPlaytimeP50Seconds: 90,
      firstDayPlaytimeP90Seconds: null,
      firstDaySessionsMedian: 1,
      firstDayPlaytimeAccounts: {
        lt_10m: 1,
        '10m_30m': 0,
        '30m_1h': 0,
        '1h_3h': 0,
        gte_3h: 0,
      },
    });
    expect(result.days[1]).toMatchObject({
      period: 'yesterday',
      firstDayPlaytimeP50Seconds: 80,
      firstDayPlaytimeP90Seconds: 80,
      firstDaySessionsMedian: 2,
      firstDayPlaytimeAccounts: {
        lt_10m: 0,
        '10m_30m': 0,
        '30m_1h': 0,
        '1h_3h': 1,
        gte_3h: 0,
      },
    });
    expect(result.retention).toEqual([
      { period: 'today', day: 1, rate: 0.4 },
      { period: 'today', day: 7, rate: null },
      { period: 'today', day: 30, rate: null },
      { period: 'yesterday', day: 1, rate: 0.6 },
      { period: 'yesterday', day: 7, rate: 0.3 },
      { period: 'yesterday', day: 30, rate: null },
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('runs and maps the isolated funnel under the same read-only safety limits', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === PLAYER_FUNNEL_SNAPSHOT_SQL) {
        return {
          rows: [
            {
              period: 'today',
              accounts_created: 2,
              first_world_entry_rate: 0.5,
              funnel_first_character: 1,
              funnel_entered_world: 1,
              funnel_played_10m: 0,
              funnel_reached_level_2: 1,
              funnel_reached_level_5: 0,
            },
            {
              period: 'yesterday',
              accounts_created: 1,
              first_world_entry_rate: 1,
              funnel_first_character: 1,
              funnel_entered_world: 1,
              funnel_played_10m: 1,
              funnel_reached_level_2: 1,
              funnel_reached_level_5: 1,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })) };

    const result = await playerFunnelSnapshot(pool as never, 'eastbrook');

    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN READ ONLY',
      "SET LOCAL lock_timeout = '250ms'",
      "SET LOCAL statement_timeout = '2000ms'",
      "SET LOCAL TIME ZONE 'UTC'",
      PLAYER_FUNNEL_SNAPSHOT_SQL,
      'COMMIT',
    ]);
    expect(query.mock.calls[4][1]).toEqual(['eastbrook']);
    expect(result.days).toEqual([
      {
        period: 'today',
        accountsCreated: 2,
        firstWorldEntryRate: 0.5,
        dayOneFunnelAccounts: {
          created: 2,
          first_character: 1,
          entered_world: 1,
          played_10m: 0,
          reached_level_2: 1,
          reached_level_5: 0,
        },
      },
      {
        period: 'yesterday',
        accountsCreated: 1,
        firstWorldEntryRate: 1,
        dayOneFunnelAccounts: {
          created: 1,
          first_character: 1,
          entered_world: 1,
          played_10m: 1,
          reached_level_2: 1,
          reached_level_5: 1,
        },
      },
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the client when the bounded query fails', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === PLAYER_BUSINESS_SNAPSHOT_SQL) throw new Error('statement timeout');
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })) };

    await expect(playerBusinessSnapshot(pool as never, 'eastbrook')).rejects.toThrow(
      'statement timeout',
    );
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('times out pool acquisition and destroys a client handed out after the deadline', async () => {
    let resolveConnect!: (client: { release: ReturnType<typeof vi.fn> }) => void;
    const release = vi.fn();
    const pool = {
      connect: vi.fn(
        () =>
          new Promise<{ release: ReturnType<typeof vi.fn> }>((resolve) => {
            resolveConnect = resolve;
          }),
      ),
    };

    await expect(playerBusinessSnapshot(pool as never, 'eastbrook', 10)).rejects.toThrow(
      'player business snapshot timed out',
    );

    resolveConnect({ release });
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith(true));
    expect(release).toHaveBeenCalledOnce();
  });

  it('destroys an active snapshot client when the whole-refresh deadline expires', async () => {
    let rejectQuery!: (err: Error) => void;
    const query = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectQuery = reject;
        }),
    );
    const release = vi.fn((destroy?: boolean) => {
      if (destroy) rejectQuery(new Error('connection destroyed'));
    });
    const pool = { connect: vi.fn(async () => ({ query, release })) };

    await expect(playerBusinessSnapshot(pool as never, 'eastbrook', 10)).rejects.toThrow(
      'player business snapshot timed out',
    );
    expect(release).toHaveBeenCalledWith(true);
  });
});
