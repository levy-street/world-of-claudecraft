// Opt-in real-Postgres coverage for the lifecycle CTEs and bounded aggregate.
// The default suite stays DB-free; set TEST_DATABASE_URL to exercise production SQL.

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closePlayerSession,
  openPlayerSession,
  PLAYER_METRICS_CONCURRENT_INDEX_SQL,
  PLAYER_METRICS_INVALID_INDEX_CHECK_SQL,
  PLAYER_METRICS_INVALID_INDEX_DROP_SQL,
  PLAYER_METRICS_SCHEMA,
  playerBusinessSnapshot,
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

    const snapshot = await playerBusinessSnapshot(scopedPool(), 'eastbrook');
    const today = snapshot.days.find((day) => day.period === 'today');
    expect(today).toMatchObject({
      accountsCreated: 1,
      charactersCreated: 1,
      firstCharacterAccounts: 1,
      firstWorldEntryRate: 1,
      activeNew: 1,
      activeReturning: 0,
      firstSessionLevel2Rate: 1,
      firstSessionLevel5Rate: 1,
    });
    expect(today?.avgPlaytimeSecondsAll).toBeGreaterThanOrEqual(3599);
    expect(today?.firstSessionMedianSeconds).toBeGreaterThanOrEqual(3599);
    expect(snapshot.retention).toEqual([
      { period: 'today', day: 1, rate: null },
      { period: 'today', day: 7, rate: null },
      { period: 'today', day: 30, rate: null },
      { period: 'yesterday', day: 1, rate: null },
      { period: 'yesterday', day: 7, rate: null },
      { period: 'yesterday', day: 30, rate: null },
    ]);
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
