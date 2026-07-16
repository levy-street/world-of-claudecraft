import { describe, expect, it, vi } from 'vitest';
import {
  closeOrphanPlayerSessions,
  closePlayerSession,
  openPlayerSession,
  PLAYER_BUSINESS_SNAPSHOT_SQL,
  PLAYER_METRICS_CONCURRENT_INDEX_SQL,
  PLAYER_METRICS_SCHEMA,
  playerBusinessSnapshot,
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

  it('uses read-only server-side timeouts and maps nullable rates', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === PLAYER_BUSINESS_SNAPSHOT_SQL) {
        return {
          rows: [
            {
              period: 'today',
              accounts_created: 2,
              characters_created: 3,
              first_character_accounts: 2,
              first_world_entry_rate: 0.5,
              active_new: 1,
              active_returning: 4,
              avg_playtime_all: 100,
              avg_playtime_new: null,
              avg_playtime_level_20: 200,
              median_seconds: 60,
              level_2_rate: 0.75,
              level_5_rate: null,
              retention: { 1: 0.4, 7: null, 30: null },
            },
            {
              period: 'yesterday',
              accounts_created: 1,
              characters_created: 1,
              first_character_accounts: 1,
              first_world_entry_rate: 1,
              active_new: 1,
              active_returning: 0,
              avg_playtime_all: 80,
              avg_playtime_new: 80,
              avg_playtime_level_20: null,
              median_seconds: 40,
              level_2_rate: 0.5,
              level_5_rate: 0,
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
      accountsCreated: 2,
      charactersCreated: 3,
      firstCharacterAccounts: 2,
      firstWorldEntryRate: 0.5,
      activeNew: 1,
      activeReturning: 4,
      avgPlaytimeSecondsAll: 100,
      avgPlaytimeSecondsNew: null,
      avgPlaytimeSecondsLevel20: 200,
      firstSessionMedianSeconds: 60,
      firstSessionLevel2Rate: 0.75,
      firstSessionLevel5Rate: null,
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
