// Opt-in real-Postgres coverage for the lifecycle CTEs and bounded aggregate.
// The default suite stays DB-free; set TEST_DATABASE_URL to exercise production SQL.

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closePlayerSession,
  openPlayerSession,
  PLAYER_FUNNEL_SNAPSHOT_SQL,
  PLAYER_METRICS_CONCURRENT_INDEX_SQL,
  PLAYER_METRICS_INVALID_INDEX_CHECK_SQL,
  PLAYER_METRICS_INVALID_INDEX_DROP_SQL,
  PLAYER_METRICS_SCHEMA,
  playerBusinessSnapshot,
  playerFunnelSnapshot,
  recordCharacterCreation,
} from '../server/player_metrics_db';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'player_metrics_integration_test';
const describeDb = DB_URL ? describe : describe.skip;

describeDb('player metrics lifecycle SQL (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    const db = await scopedClient();
    try {
      await db.query(`
        CREATE TABLE accounts (
          id SERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX accounts_created_at ON accounts(created_at DESC);
        CREATE TABLE characters (
          id SERIAL PRIMARY KEY,
          account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          realm TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE play_sessions (
          id SERIAL PRIMARY KEY,
          account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          character_id INT REFERENCES characters(id) ON DELETE SET NULL,
          character_name TEXT NOT NULL DEFAULT '',
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ended_at TIMESTAMPTZ,
          ip_address TEXT,
          user_agent TEXT
        );
      `);
      await db.query(PLAYER_METRICS_SCHEMA);
      await db.query(PLAYER_METRICS_CONCURRENT_INDEX_SQL);
    } finally {
      db.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  beforeEach(async () => {
    const db = await scopedClient();
    try {
      await db.query(
        `TRUNCATE player_activity_daily, player_business_daily, player_account_facts,
                  play_sessions, characters, accounts RESTART IDENTITY CASCADE`,
      );
    } finally {
      db.release();
    }
  });

  async function scopedClient() {
    const client = await pool.connect();
    await client.query(`SET search_path TO ${SCHEMA}`);
    await client.query("SET TIME ZONE 'UTC'");
    return client;
  }

  function scopedPool(): Pool {
    return {
      connect: scopedClient,
      query: async (text: string, values?: unknown[]) => {
        const client = await scopedClient();
        try {
          return await client.query(text, values);
        } finally {
          client.release();
        }
      },
    } as unknown as Pool;
  }

  it('collects acquisition, activity, first-session, and retention inputs without raw scans', async () => {
    const db = await scopedClient();
    let accountId: number;
    let characterId: number;
    try {
      accountId = Number(
        (await db.query('INSERT INTO accounts DEFAULT VALUES RETURNING id')).rows[0].id,
      );
      characterId = Number(
        (
          await db.query(
            `INSERT INTO characters (account_id, realm)
             VALUES ($1, 'eastbrook') RETURNING id`,
            [accountId],
          )
        ).rows[0].id,
      );
      await recordCharacterCreation(db, accountId, 'eastbrook');
    } finally {
      db.release();
    }

    const sessionId = await openPlayerSession(scopedPool(), {
      accountId,
      characterId,
      characterName: 'Alice',
      realm: 'eastbrook',
      initialLevel: 1,
      ipAddress: null,
      userAgent: null,
    });
    const adjust = await scopedClient();
    try {
      await adjust.query(
        "UPDATE play_sessions SET started_at = now() - interval '1 hour' WHERE id = $1",
        [sessionId],
      );
    } finally {
      adjust.release();
    }
    await closePlayerSession(scopedPool(), sessionId, 'eastbrook', 5);

    // Keep the snapshot fixture independent of the wall clock. During the
    // first hour after UTC midnight, the one-hour session above correctly
    // splits most playtime onto yesterday even though it opened today.
    const activity = await scopedClient();
    try {
      await activity.query(
        `UPDATE player_activity_daily
            SET playtime_seconds = 3600
          WHERE realm = 'eastbrook' AND day = current_date AND account_id = $1`,
        [accountId],
      );
    } finally {
      activity.release();
    }

    const snapshot = await playerBusinessSnapshot(scopedPool(), 'eastbrook');
    const funnelSnapshot = await playerFunnelSnapshot(scopedPool(), 'eastbrook');
    const today = snapshot.days.find((day) => day.period === 'today');
    expect(today).toMatchObject({
      charactersCreated: 1,
      firstCharacterAccounts: 1,
      activeNew: 1,
      activeReturning: 0,
      firstSessionLevel2Rate: 1,
      firstSessionLevel5Rate: 1,
    });
    expect(funnelSnapshot.days.find((day) => day.period === 'today')).toMatchObject({
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
    });
    expect(today?.avgPlaytimeSecondsAll).toBeGreaterThanOrEqual(3599);
    expect(today?.firstSessionMedianSeconds).toBeGreaterThanOrEqual(3599);
    expect(today?.firstDayPlaytimeP50Seconds).toBeGreaterThanOrEqual(3599);
    expect(today?.firstDayPlaytimeP90Seconds).toBeGreaterThanOrEqual(3599);
    expect(today?.firstDaySessionsMedian).toBe(1);
    const buckets = today?.firstDayPlaytimeAccounts;
    expect(buckets?.lt_10m).toBe(0);
    // The one-hour session floors to right at the 1h edge; accept either side
    // of it so a sub-second clock skew between statements cannot flake this.
    expect((buckets?.['30m_1h'] ?? 0) + (buckets?.['1h_3h'] ?? 0)).toBe(1);
    expect(buckets?.gte_3h).toBe(0);
    const bucketTotal = Object.values(buckets ?? {}).reduce((sum, count) => sum + count, 0);
    expect(bucketTotal).toBe(today?.activeNew);
    const yesterday = snapshot.days.find((day) => day.period === 'yesterday');
    expect(yesterday).toMatchObject({
      firstDayPlaytimeP50Seconds: null,
      firstDaySessionsMedian: null,
      firstDayPlaytimeAccounts: {
        lt_10m: 0,
        '10m_30m': 0,
        '30m_1h': 0,
        '1h_3h': 0,
        gte_3h: 0,
      },
    });
    expect(funnelSnapshot.days.find((day) => day.period === 'yesterday')).toMatchObject({
      accountsCreated: 0,
      firstWorldEntryRate: null,
      dayOneFunnelAccounts: {
        created: 0,
        first_character: 0,
        entered_world: 0,
        played_10m: 0,
        reached_level_2: 0,
        reached_level_5: 0,
      },
    });
    expect(snapshot.retention).toEqual([
      { period: 'today', day: 1, rate: null },
      { period: 'today', day: 7, rate: null },
      { period: 'today', day: 30, rate: null },
      { period: 'yesterday', day: 1, rate: null },
      { period: 'yesterday', day: 7, rate: null },
      { period: 'yesterday', day: 30, rate: null },
    ]);
  });

  it('keeps the signup funnel on one cohort while engagement follows first play', async () => {
    const db = await scopedClient();
    try {
      const accounts = await db.query(
        `INSERT INTO accounts (created_at)
         VALUES
           (current_date),
           (current_date + interval '2 hours'),
           (current_date + interval '3 hours'),
           (current_date + 1),
           (current_date + interval '4 hours'),
           (current_date - 1 + interval '12 hours'),
           (current_date + interval '5 hours')
         RETURNING id`,
      );
      const ids = accounts.rows.map((row) => Number(row.id));
      await db.query(
        `INSERT INTO player_account_facts (
           realm, account_id, account_created_at, first_character_at, first_play_at
         ) VALUES
           ('eastbrook', $1, current_date,
            current_date + interval '2 hours', current_date + interval '3 hours'),
           ('eastbrook', $2, current_date + interval '2 hours',
            current_date + interval '3 hours', current_date + interval '4 hours'),
           ('eastbrook', $3, current_date + interval '3 hours',
            current_date + interval '4 hours', NULL),
           ('eastbrook', $4, current_date - 1 + interval '12 hours',
            current_date + interval '1 hour', current_date + interval '2 hours'),
           ('other', $5, current_date + interval '5 hours',
            current_date + interval '6 hours', current_date + interval '7 hours')`,
        [ids[0], ids[1], ids[2], ids[5], ids[6]],
      );
      await db.query(
        `INSERT INTO player_activity_daily (
           realm, day, account_id, sessions, playtime_seconds, max_level
         ) VALUES
           ('eastbrook', current_date, $1, 1, 1200, 5),
           ('eastbrook', current_date, $2, 1, 300, 1),
           ('eastbrook', current_date, $3, 1, 3600, 10),
           ('other', current_date, $4, 1, 7200, 20)`,
        [ids[0], ids[1], ids[5], ids[6]],
      );
    } finally {
      db.release();
    }

    const snapshot = await playerBusinessSnapshot(scopedPool(), 'eastbrook');
    const funnelSnapshot = await playerFunnelSnapshot(scopedPool(), 'eastbrook');
    const today = snapshot.days.find((day) => day.period === 'today');
    expect(today).toMatchObject({
      firstCharacterAccounts: 4,
      activeNew: 3,
      firstDaySessionsMedian: 1,
      firstDayPlaytimeAccounts: {
        lt_10m: 1,
        '10m_30m': 1,
        '30m_1h': 0,
        '1h_3h': 1,
        gte_3h: 0,
      },
    });
    const funnelToday = funnelSnapshot.days.find((day) => day.period === 'today');
    expect(funnelToday).toMatchObject({
      accountsCreated: 5,
      firstWorldEntryRate: 0.4,
      dayOneFunnelAccounts: {
        created: 5,
        first_character: 3,
        entered_world: 2,
        played_10m: 1,
        reached_level_2: 1,
        reached_level_5: 1,
      },
    });
    const funnel = funnelToday?.dayOneFunnelAccounts;
    expect(funnel?.created).toBeGreaterThanOrEqual(funnel?.first_character ?? 0);
    expect(funnel?.first_character).toBeGreaterThanOrEqual(funnel?.entered_world ?? 0);
    expect(funnel?.entered_world).toBeGreaterThanOrEqual(funnel?.played_10m ?? 0);
    expect(funnel?.entered_world).toBeGreaterThanOrEqual(funnel?.reached_level_2 ?? 0);
    expect(funnel?.reached_level_2).toBeGreaterThanOrEqual(funnel?.reached_level_5 ?? 0);
    expect(today?.firstDayPlaytimeP90Seconds).toBeGreaterThan(1200);
  });

  it('keeps a launch-day factless signup spike set-based and inside the production timeout', async () => {
    const db = await scopedClient();
    try {
      await db.query(
        `INSERT INTO accounts (created_at)
         SELECT CASE
                  WHEN n <= 250000 THEN current_date + interval '1 hour'
                  ELSE current_date - 1 + interval '1 hour'
                END
           FROM generate_series(1, 500000) AS generated(n)`,
      );
      await db.query(
        `INSERT INTO player_account_facts (
           realm, account_id, account_created_at, first_character_at, first_play_at
         )
         SELECT 'eastbrook', id, created_at,
                created_at + interval '1 hour', created_at + interval '2 hours'
           FROM (
             (SELECT id, created_at
                FROM accounts
               WHERE created_at >= current_date
               ORDER BY id
               LIMIT 100)
             UNION ALL
             (SELECT id, created_at
                FROM accounts
               WHERE created_at >= current_date - 1
                 AND created_at < current_date
               ORDER BY id
               LIMIT 100)
           ) AS selected`,
      );
      await db.query(
        `INSERT INTO player_account_facts (
           realm, account_id, account_created_at, first_character_at, first_play_at
         )
         SELECT 'other', id, created_at,
                created_at + interval '1 hour', created_at + interval '2 hours'
           FROM accounts
          ORDER BY id
          LIMIT 10000`,
      );
      await db.query(
        `INSERT INTO player_activity_daily (
           realm, day, account_id, sessions, playtime_seconds, max_level
         )
         SELECT realm, account_created_at::date, account_id, 1, 1200, 5
           FROM player_account_facts`,
      );
      await db.query('ANALYZE accounts');
      await db.query('ANALYZE player_account_facts');
      await db.query('ANALYZE player_activity_daily');
    } finally {
      db.release();
    }

    const snapshot = await playerFunnelSnapshot(scopedPool(), 'eastbrook');
    expect(snapshot.days).toEqual([
      {
        period: 'today',
        accountsCreated: 250000,
        firstWorldEntryRate: 100 / 250000,
        dayOneFunnelAccounts: {
          created: 250000,
          first_character: 100,
          entered_world: 100,
          played_10m: 100,
          reached_level_2: 100,
          reached_level_5: 100,
        },
      },
      {
        period: 'yesterday',
        accountsCreated: 250000,
        firstWorldEntryRate: 100 / 250000,
        dayOneFunnelAccounts: {
          created: 250000,
          first_character: 100,
          entered_world: 100,
          played_10m: 100,
          reached_level_2: 100,
          reached_level_5: 100,
        },
      },
    ]);

    const planDb = await scopedClient();
    try {
      await planDb.query('BEGIN READ ONLY');
      await planDb.query("SET LOCAL statement_timeout = '2000ms'");
      await planDb.query("SET LOCAL work_mem = '4MB'");
      const explained = await planDb.query(
        `EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, FORMAT JSON)
         ${PLAYER_FUNNEL_SNAPSHOT_SQL}`,
        ['eastbrook'],
      );
      const root = explained.rows[0]['QUERY PLAN'][0] as Record<string, unknown>;
      const nodes: Record<string, unknown>[] = [];
      const visit = (node: Record<string, unknown>) => {
        nodes.push(node);
        for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? []) {
          visit(child);
        }
      };
      visit(root.Plan as Record<string, unknown>);

      const factOrActivityScans = nodes.filter((node) =>
        ['player_account_facts', 'player_activity_daily'].includes(String(node['Relation Name'])),
      );
      expect(factOrActivityScans.every((node) => Number(node['Actual Loops'] ?? 0) <= 200)).toBe(
        true,
      );
      expect(nodes.some((node) => node['Index Name'] === 'accounts_created_at')).toBe(true);
      expect(
        nodes.some((node) => node['Index Name'] === 'player_account_facts_first_character'),
      ).toBe(true);
      expect(nodes.some((node) => node['Index Name'] === 'player_account_facts_first_play')).toBe(
        true,
      );
      expect(nodes.some((node) => node['Index Name'] === 'player_activity_daily_pkey')).toBe(true);
      expect(Number(root['Execution Time'])).toBeLessThan(2_000);
      expect(nodes.reduce((total, node) => total + Number(node['Temp Read Blocks'] ?? 0), 0)).toBe(
        0,
      );
      expect(
        nodes.reduce((total, node) => total + Number(node['Temp Written Blocks'] ?? 0), 0),
      ).toBe(0);
    } finally {
      await planDb.query('ROLLBACK').catch(() => {});
      planDb.release();
    }
  }, 120_000);

  it('assigns exact first-day playtime boundaries to one bucket each', async () => {
    const db = await scopedClient();
    try {
      const accounts = await db.query(
        `INSERT INTO accounts (created_at)
         SELECT current_date FROM generate_series(1, 5)
         RETURNING id`,
      );
      const ids = accounts.rows.map((row) => Number(row.id));
      await db.query(
        `INSERT INTO player_account_facts (
           realm, account_id, account_created_at, first_play_at
         ) VALUES
           ('eastbrook', $1, current_date, current_date),
           ('eastbrook', $2, current_date, current_date),
           ('eastbrook', $3, current_date, current_date),
           ('eastbrook', $4, current_date, current_date),
           ('eastbrook', $5, current_date, current_date)`,
        ids,
      );
      await db.query(
        `INSERT INTO player_activity_daily (
           realm, day, account_id, sessions, playtime_seconds, max_level
         ) VALUES
           ('eastbrook', current_date, $1, 1, 599, 1),
           ('eastbrook', current_date, $2, 1, 600, 1),
           ('eastbrook', current_date, $3, 1, 1800, 1),
           ('eastbrook', current_date, $4, 1, 3600, 1),
           ('eastbrook', current_date, $5, 1, 10800, 1)`,
        ids,
      );
    } finally {
      db.release();
    }

    const snapshot = await playerBusinessSnapshot(scopedPool(), 'eastbrook');
    const today = snapshot.days.find((day) => day.period === 'today');
    expect(today).toMatchObject({
      activeNew: 5,
      firstDayPlaytimeAccounts: {
        lt_10m: 1,
        '10m_30m': 1,
        '30m_1h': 1,
        '1h_3h': 1,
        gte_3h: 1,
      },
    });
  });

  it('keeps live and completed retention cohorts separate', async () => {
    const db = await scopedClient();
    try {
      const accounts = await db.query(
        `INSERT INTO accounts (created_at)
         VALUES (now()), (now()), (now()), (now())
         RETURNING id`,
      );
      const ids = accounts.rows.map((row) => Number(row.id));
      await db.query(
        `INSERT INTO player_account_facts (
           realm, account_id, account_created_at, first_play_at
         ) VALUES
           ('eastbrook', $1, current_date - 1, current_date - 1),
           ('eastbrook', $2, current_date - 1, current_date - 1),
           ('eastbrook', $3, current_date - 2, current_date - 2),
           ('eastbrook', $4, current_date - 2, current_date - 2)`,
        ids,
      );
      await db.query(
        `INSERT INTO player_activity_daily (realm, day, account_id)
         VALUES
           ('eastbrook', current_date, $1),
           ('eastbrook', current_date - 1, $2),
           ('eastbrook', current_date - 1, $3)`,
        [ids[0], ids[2], ids[3]],
      );
    } finally {
      db.release();
    }

    const snapshot = await playerBusinessSnapshot(scopedPool(), 'eastbrook');
    expect(snapshot.retention.find((item) => item.period === 'today' && item.day === 1)?.rate).toBe(
      0.5,
    );
    expect(
      snapshot.retention.find((item) => item.period === 'yesterday' && item.day === 1)?.rate,
    ).toBe(1);
  });

  it('seeds a veteran from their indexed earliest session instead of classifying them as new', async () => {
    const db = await scopedClient();
    let accountId: number;
    let characterId: number;
    try {
      accountId = Number(
        (
          await db.query(
            "INSERT INTO accounts (created_at) VALUES (now() - interval '10 days') RETURNING id",
          )
        ).rows[0].id,
      );
      characterId = Number(
        (
          await db.query(
            `INSERT INTO characters (account_id, realm, created_at)
             VALUES ($1, 'eastbrook', now() - interval '10 days') RETURNING id`,
            [accountId],
          )
        ).rows[0].id,
      );
      await db.query(
        `INSERT INTO play_sessions (
           account_id, character_id, character_name, started_at, ended_at
         ) VALUES (
           $1, $2, 'Veteran', now() - interval '10 days',
           now() - interval '10 days' + interval '1 hour'
         )`,
        [accountId, characterId],
      );
    } finally {
      db.release();
    }

    await openPlayerSession(scopedPool(), {
      accountId,
      characterId,
      characterName: 'Veteran',
      realm: 'eastbrook',
      initialLevel: 20,
      ipAddress: null,
      userAgent: null,
    });

    const verify = await scopedClient();
    try {
      const facts = await verify.query(
        `SELECT first_play_at::date = (current_date - 10) AS first_play_is_historical,
                first_session_seconds, first_session_max_level
           FROM player_account_facts
          WHERE realm = 'eastbrook' AND account_id = $1`,
        [accountId],
      );
      expect(facts.rows[0]).toMatchObject({
        first_play_is_historical: true,
        first_session_seconds: 3600,
        first_session_max_level: 1,
      });
    } finally {
      verify.release();
    }

    const snapshot = await playerBusinessSnapshot(scopedPool(), 'eastbrook');
    const today = snapshot.days.find((day) => day.period === 'today');
    expect(today?.activeNew).toBe(0);
    expect(today?.activeReturning).toBe(1);
  });

  it('repairs an INVALID index carcass left by a killed concurrent build', async () => {
    const db = await scopedClient();
    try {
      // Reproduce the real failure shape: a CREATE INDEX CONCURRENTLY that dies
      // mid-build (here a unique build over duplicate rows; in production a
      // deploy-watchdog restart) leaves the index INVALID, and IF NOT EXISTS
      // would then treat it as existing on every later boot.
      await db.query('INSERT INTO accounts DEFAULT VALUES');
      await db.query('INSERT INTO play_sessions (account_id) VALUES (1), (1)');
      await db.query('DROP INDEX IF EXISTS play_sessions_account_started_id');
      await expect(
        db.query(
          `CREATE UNIQUE INDEX CONCURRENTLY play_sessions_account_started_id
             ON play_sessions(account_id)`,
        ),
      ).rejects.toThrow();
      const invalid = await db.query(
        `SELECT i.indisvalid FROM pg_index i
          WHERE i.indexrelid = to_regclass('play_sessions_account_started_id')`,
      );
      expect(invalid.rows[0]?.indisvalid).toBe(false);

      // The boot repair drops the carcass...
      const carcass = await db.query(PLAYER_METRICS_INVALID_INDEX_CHECK_SQL);
      expect(carcass.rowCount).toBe(1);
      await db.query(PLAYER_METRICS_INVALID_INDEX_DROP_SQL);
      const afterRepair = await db.query(
        "SELECT to_regclass('play_sessions_account_started_id') AS reg",
      );
      expect(afterRepair.rows[0]?.reg).toBeNull();

      // ...and the migration then rebuilds it valid.
      await db.query(PLAYER_METRICS_CONCURRENT_INDEX_SQL);
      const rebuilt = await db.query(
        `SELECT i.indisvalid FROM pg_index i
          WHERE i.indexrelid = to_regclass('play_sessions_account_started_id')`,
      );
      expect(rebuilt.rows[0]?.indisvalid).toBe(true);

      // A healthy index is not a carcass: the check must not match it.
      const healthy = await db.query(PLAYER_METRICS_INVALID_INDEX_CHECK_SQL);
      expect(healthy.rowCount).toBe(0);
    } finally {
      db.release();
    }
  });
});
