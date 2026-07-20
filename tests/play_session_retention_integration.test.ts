// Opt-in real-Postgres coverage for the play-session retention fold: reader
// invariance across the fold, the first-session referent guard, fold
// idempotency, the ban-evasion lookback across the fold horizon, and
// association aging. The default suite stays DB-free; set TEST_DATABASE_URL
// to exercise the production SQL.

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PLAY_SESSION_RETENTION_SCHEMA,
  pruneAccountIpAssociationsBatch,
  prunePlaySessionsBatch,
} from '../server/play_session_retention_db';
import {
  closePlayerSession,
  openPlayerSession,
  PLAYER_METRICS_CONCURRENT_INDEX_SQL,
  PLAYER_METRICS_SCHEMA,
} from '../server/player_metrics_db';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'play_session_retention_integration_test';
const describeDb = DB_URL ? describe : describe.skip;

// server/db.ts requires DATABASE_URL at module load. None of the static
// imports above pulls it in; the beforeAll below imports it dynamically, so
// this assignment runs first and points its pool at the test database instead
// of the vitest dummy. That pool stays inert: pg pools connect only on first
// query, and this suite only reads exported DDL text from the module, so no
// partial mock of ../server/db is needed here.
if (DB_URL) process.env.DATABASE_URL = DB_URL;

describeDb('play session retention fold (real Postgres)', () => {
  let pool: Pool;
  // banForAccount's per-account eligibility SQL, exported as a constant from
  // ../server/daily_rewards_db in the same change that adds the exclusion
  // view's account_ip_associations arm. Read via dynamic import so a missing
  // export fails only its own case instead of the whole file.
  let banForAccountSql: string | undefined;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);

    // The REAL exclusion-view DDL, exported from server/db.ts as its own
    // constant (its association arm reads a table the core SCHEMA precedes,
    // so ensureSchema applies it after the retention schema; this suite does
    // the same below). Never sliced from the raw db.ts source, which carries
    // template tokens; a regressed export fails the pin here decisively.
    const core = (await import('../server/db')) as {
      DAILY_REWARD_EXCLUDED_ACCOUNTS_VIEW_SQL?: string;
    };
    const exclusionViewDdl = core.DAILY_REWARD_EXCLUDED_ACCOUNTS_VIEW_SQL;
    expect(typeof exclusionViewDdl).toBe('string');
    const rewards = await import('../server/daily_rewards_db');
    banForAccountSql = (rewards as { DAILY_REWARD_BAN_FOR_ACCOUNT_SQL?: string })
      .DAILY_REWARD_BAN_FOR_ACCOUNT_SQL;

    const db = await scopedClient();
    try {
      // Minimal shadows of the core tables the retention SQL and the sliced
      // view touch, mirroring the player-metrics integration suite's shapes.
      await db.query(`
        CREATE TABLE accounts (
          id SERIAL PRIMARY KEY,
          username TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login_ip TEXT
        );
        CREATE TABLE characters (
          id SERIAL PRIMARY KEY,
          account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name TEXT,
          realm TEXT NOT NULL,
          level INT NOT NULL DEFAULT 1,
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
        CREATE TABLE daily_reward_bans (
          account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ
        );
        CREATE TABLE daily_reward_ip_bans (
          ip_address TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await db.query(PLAYER_METRICS_SCHEMA);
      await db.query(PLAYER_METRICS_CONCURRENT_INDEX_SQL);
      await db.query(PLAY_SESSION_RETENTION_SCHEMA);
      await db.query(String(exclusionViewDdl));
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
        `TRUNCATE play_session_totals, account_ip_associations,
                  player_activity_daily, player_business_daily, player_account_facts,
                  daily_reward_bans, daily_reward_ip_bans,
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

  async function foldToExhaustion(retentionDays: number, batchSize: number): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await prunePlaySessionsBatch(scopedPool(), retentionDays, batchSize);
      total += deleted;
      if (deleted < batchSize) return total;
    }
  }

  // The production lifetime-playtime readers add the play_session_totals
  // rollup term to their live play_sessions sum; the three helpers below
  // mirror their shapes. COALESCE(ended_at, $1) pins open sessions to one
  // fixed as-of instant instead of now(), so the still-running clock cannot
  // drift the before/after comparison; the fold never touches open sessions,
  // so both measurements price them identically and the invariance check
  // stays a strict toEqual.
  async function characterPlaytimes(asOf: Date) {
    const db = await scopedClient();
    try {
      const res = await db.query(
        `SELECT c.id,
                (COALESCE(live.seconds, 0) + COALESCE(t.playtime_seconds, 0))::bigint
                  AS playtime_seconds,
                GREATEST(live.last_played, t.last_played) AS last_played
           FROM characters c
           LEFT JOIN (
             SELECT character_id,
                    SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, $1) - started_at)))::bigint
                      AS seconds,
                    MAX(started_at) AS last_played
               FROM play_sessions
              GROUP BY character_id
           ) live ON live.character_id = c.id
           LEFT JOIN play_session_totals t
             ON t.account_id = c.account_id AND t.character_id = c.id
          ORDER BY c.id`,
        [asOf],
      );
      return res.rows.map((row) => ({
        id: Number(row.id),
        playtimeSeconds: Number(row.playtime_seconds),
        lastPlayed: row.last_played ? new Date(row.last_played).toISOString() : null,
      }));
    } finally {
      db.release();
    }
  }

  async function accountPlaytimes(asOf: Date) {
    const db = await scopedClient();
    try {
      const res = await db.query(
        `SELECT a.id,
                (COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, $1) - started_at)))
                             FROM play_sessions WHERE account_id = a.id), 0)
                 + COALESCE((SELECT SUM(playtime_seconds) FROM play_session_totals
                              WHERE account_id = a.id), 0))::bigint AS playtime_seconds
           FROM accounts a
          ORDER BY a.id`,
        [asOf],
      );
      return res.rows.map((row) => ({
        id: Number(row.id),
        playtimeSeconds: Number(row.playtime_seconds),
      }));
    } finally {
      db.release();
    }
  }

  async function overviewPlaytime(asOf: Date): Promise<number> {
    const db = await scopedClient();
    try {
      const res = await db.query(
        `SELECT (COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, $1) - started_at)))
                             FROM play_sessions), 0)
                 + COALESCE((SELECT SUM(playtime_seconds) FROM play_session_totals), 0))::bigint
                  AS total`,
        [asOf],
      );
      return Number(res.rows[0].total);
    } finally {
      db.release();
    }
  }

  async function readFacts(accountId: number) {
    const db = await scopedClient();
    try {
      const res = await db.query(
        `SELECT first_session_id, first_session_seconds, first_session_max_level
           FROM player_account_facts
          WHERE realm = 'eastbrook' AND account_id = $1`,
        [accountId],
      );
      const row = res.rows[0];
      return {
        firstSessionId: Number(row.first_session_id),
        firstSessionSeconds: Number(row.first_session_seconds),
        firstSessionMaxLevel: Number(row.first_session_max_level),
      };
    } finally {
      db.release();
    }
  }

  it('folds doomed sessions without changing any lifetime playtime reader', {
    timeout: 20_000,
  }, async () => {
    const db = await scopedClient();
    let a1: number;
    let a2: number;
    let a3: number;
    let c1: number;
    let c2: number;
    let c3: number;
    let c4: number;
    try {
      const insertAccount = async (username: string) =>
        Number(
          (await db.query('INSERT INTO accounts (username) VALUES ($1) RETURNING id', [username]))
            .rows[0].id,
        );
      const insertCharacter = async (accountId: number, name: string, realm: string) =>
        Number(
          (
            await db.query(
              'INSERT INTO characters (account_id, name, realm) VALUES ($1, $2, $3) RETURNING id',
              [accountId, name, realm],
            )
          ).rows[0].id,
        );
      a1 = await insertAccount('alice');
      a2 = await insertAccount('bob');
      a3 = await insertAccount('carol');
      c1 = await insertCharacter(a1, 'Aleast', 'eastbrook');
      c2 = await insertCharacter(a1, 'Afront', 'frontier');
      c3 = await insertCharacter(a2, 'Beast', 'eastbrook');
      c4 = await insertCharacter(a3, 'Ceast', 'eastbrook');
      // Whole-second durations only: the fold's ::bigint cast then
      // introduces no rounding drift and every sum below compares with
      // strict equality. Rows 1-4 are doomed (ended, older than 180 days,
      // across BOTH realms); row 3 has a NULL ip; row 5 is an OPEN old
      // session; rows 6-7 are young.
      await db.query(
        `INSERT INTO play_sessions (account_id, character_id, started_at, ended_at, ip_address)
           VALUES
             ($1, $4, now() - interval '200 days',
              now() - interval '200 days' + interval '3600 seconds', '10.0.0.1'),
             ($1, $5, now() - interval '210 days',
              now() - interval '210 days' + interval '7200 seconds', '10.0.0.1'),
             ($1, $4, now() - interval '205 days',
              now() - interval '205 days' + interval '1800 seconds', NULL),
             ($2, $6, now() - interval '190 days',
              now() - interval '190 days' + interval '5400 seconds', '10.0.0.2'),
             ($3, $7, now() - interval '200 days', NULL, '10.0.0.3'),
             ($1, $4, now() - interval '10 days',
              now() - interval '10 days' + interval '600 seconds', '10.0.0.1'),
             ($2, $6, now() - interval '5 days',
              now() - interval '5 days' + interval '300 seconds', '10.0.0.2')`,
        [a1, a2, a3, c1, c2, c3, c4],
      );
      // The deleted-character shape: a doomed row whose character_id was
      // nulled by a character delete must fold into the account's 0 bucket.
      await db.query(
        `UPDATE play_sessions SET character_id = NULL
            WHERE account_id = $1 AND character_id = $2
              AND started_at < now() - interval '100 days'`,
        [a2, c3],
      );
    } finally {
      db.release();
    }

    const asOf = new Date(
      (await scopedPool().query('SELECT now() AS now')).rows[0].now as string | Date,
    );
    const before = {
      characters: await characterPlaytimes(asOf),
      accounts: await accountPlaytimes(asOf),
      overview: await overviewPlaytime(asOf),
    };
    // Literal pre-fold pins so the invariance check cannot pass vacuously.
    expect(before.characters.find((row) => row.id === c1)?.playtimeSeconds).toBe(6000);
    expect(before.characters.find((row) => row.id === c2)?.playtimeSeconds).toBe(7200);
    expect(before.characters.find((row) => row.id === c3)?.playtimeSeconds).toBe(300);
    expect(before.accounts.find((row) => row.id === a1)?.playtimeSeconds).toBe(13200);
    expect(before.accounts.find((row) => row.id === a2)?.playtimeSeconds).toBe(5700);
    // The global sum includes the open session's live term, so it has no
    // stable literal; bound it below by the closed-session literals so the
    // overview invariance arm cannot pass on an all-zeros bug.
    expect(before.overview).toBeGreaterThan(18900);

    // Batch size 2 forces the four doomed rows across two batches, so the
    // ON CONFLICT accumulation arms (summed playtime/sessions, GREATEST
    // last_seen_at) fire on real Postgres under the invariance check: an
    // overwrite mutation would drop batch one's fold and redden the sums.
    const deleted = await foldToExhaustion(180, 2);
    expect(deleted).toBe(4);

    // Every reader-shaped sum (per character, per account, global) is
    // identical to its pre-fold value: the fold moved playtime from the
    // live term to the rollup term without changing any total.
    const after = {
      characters: await characterPlaytimes(asOf),
      accounts: await accountPlaytimes(asOf),
      overview: await overviewPlaytime(asOf),
    };
    expect(after).toEqual(before);

    const verify = await scopedClient();
    try {
      const totals = await verify.query(
        `SELECT account_id, character_id, playtime_seconds, sessions
             FROM play_session_totals ORDER BY account_id, character_id`,
      );
      expect(
        totals.rows.map((row) => ({
          accountId: Number(row.account_id),
          characterId: Number(row.character_id),
          playtimeSeconds: Number(row.playtime_seconds),
          sessions: Number(row.sessions),
        })),
      ).toEqual([
        // The NULL-ip doomed row folded here alongside the same character's
        // other doomed session.
        { accountId: a1, characterId: c1, playtimeSeconds: 5400, sessions: 2 },
        { accountId: a1, characterId: c2, playtimeSeconds: 7200, sessions: 1 },
        // The NULL-character doomed row landed in the deleted-character 0
        // bucket, never a characters-FK violation.
        { accountId: a2, characterId: 0, playtimeSeconds: 5400, sessions: 1 },
      ]);

      // Exactly the two folded (account, ip) pairs: the NULL-ip doomed row
      // was deleted and folded but wrote no association row.
      const associations = await verify.query(
        `SELECT account_id, ip_address FROM account_ip_associations
            ORDER BY account_id, ip_address`,
      );
      expect(
        associations.rows.map((row) => ({
          accountId: Number(row.account_id),
          ip: row.ip_address,
        })),
      ).toEqual([
        { accountId: a1, ip: '10.0.0.1' },
        { accountId: a2, ip: '10.0.0.2' },
      ]);

      // last_seen_at folds MAX(ended_at), the newest session END on that IP:
      // a1's 10.0.0.1 sessions ended 200d-minus-1h and 210d-minus-2h ago, so
      // the whole-day age is 199, and a MAX(started_at) mutation (age 200)
      // reddens this; a2's single 10.0.0.2 session ended at age 189 vs a
      // started_at age of 190.
      const ages = await verify.query(
        `SELECT account_id, ip_address,
                floor(EXTRACT(EPOCH FROM (now() - last_seen_at)) / 86400)::int AS age_days
             FROM account_ip_associations ORDER BY account_id, ip_address`,
      );
      expect(ages.rows.map((row) => Number(row.age_days))).toEqual([199, 189]);

      // The open old session and both young sessions survive; every doomed
      // old ended row across both realms is gone.
      const survivors = await verify.query(
        'SELECT account_id, ended_at IS NULL AS open FROM play_sessions ORDER BY id',
      );
      expect(
        survivors.rows.map((row) => ({ accountId: Number(row.account_id), open: row.open })),
      ).toEqual([
        { accountId: a3, open: true },
        { accountId: a1, open: false },
        { accountId: a2, open: false },
      ]);
      const oldEnded = await verify.query(
        `SELECT count(*)::int AS count FROM play_sessions
            WHERE started_at < now() - interval '180 days' AND ended_at IS NOT NULL`,
      );
      expect(oldEnded.rows[0].count).toBe(0);
    } finally {
      verify.release();
    }
  });

  it('protects the first-session referent and the facts it anchors', {
    timeout: 20_000,
  }, async () => {
    const db = await scopedClient();
    let accountId: number;
    let characterId: number;
    try {
      accountId = Number(
        (await db.query("INSERT INTO accounts (username) VALUES ('vera') RETURNING id")).rows[0].id,
      );
      characterId = Number(
        (
          await db.query(
            `INSERT INTO characters (account_id, name, realm)
               VALUES ($1, 'Vera', 'eastbrook') RETURNING id`,
            [accountId],
          )
        ).rows[0].id,
      );
    } finally {
      db.release();
    }

    const sessionInput = {
      accountId,
      characterId,
      characterName: 'Vera',
      realm: 'eastbrook',
      initialLevel: 1,
      ipAddress: null,
      userAgent: null,
    };
    const first = await openPlayerSession(scopedPool(), sessionInput);
    // Backdate before closing so the close stamps a nonzero first-session
    // duration into the facts row (the player-metrics suite's idiom).
    const adjust = await scopedClient();
    try {
      await adjust.query(
        "UPDATE play_sessions SET started_at = now() - interval '1 hour' WHERE id = $1",
        [first],
      );
    } finally {
      adjust.release();
    }
    await closePlayerSession(scopedPool(), first, 'eastbrook', 5);

    const second = await openPlayerSession(scopedPool(), { ...sessionInput, initialLevel: 6 });
    await closePlayerSession(scopedPool(), second, 'eastbrook', 7);

    // Age both sessions past the cutoff with whole-second durations. The
    // account's EARLIEST session (the facts referent) is now the oldest row
    // the age predicate matches.
    const age = await scopedClient();
    try {
      await age.query(
        `UPDATE play_sessions
              SET started_at = now() - interval '400 days',
                  ended_at = now() - interval '400 days' + interval '3600 seconds'
            WHERE id = $1`,
        [first],
      );
      await age.query(
        `UPDATE play_sessions
              SET started_at = now() - interval '300 days',
                  ended_at = now() - interval '300 days' + interval '900 seconds'
            WHERE id = $1`,
        [second],
      );
    } finally {
      age.release();
    }

    const factsBefore = await readFacts(accountId);
    expect(factsBefore).toEqual({
      firstSessionId: first,
      firstSessionSeconds: 3600,
      firstSessionMaxLevel: 5,
    });

    // Batch size 1 forces the sweep through multiple batches: every
    // batch's doomed pick must skip the referent even though it is the
    // oldest ended row in the age window.
    const deleted = await foldToExhaustion(180, 1);
    expect(deleted).toBe(1);

    const verify = await scopedClient();
    try {
      const sessions = await verify.query('SELECT id FROM play_sessions ORDER BY id');
      expect(sessions.rows.map((row) => Number(row.id))).toEqual([first]);
      const totals = await verify.query(
        `SELECT playtime_seconds, sessions FROM play_session_totals
            WHERE account_id = $1 AND character_id = $2`,
        [accountId, characterId],
      );
      expect(
        totals.rows.map((row) => ({
          playtimeSeconds: Number(row.playtime_seconds),
          sessions: Number(row.sessions),
        })),
      ).toEqual([{ playtimeSeconds: 900, sessions: 1 }]);
    } finally {
      verify.release();
    }
    expect(await readFacts(accountId)).toEqual(factsBefore);

    // A later login must find the referent intact. Were it deleted, the ON
    // DELETE SET NULL cascade plus this open would re-anchor the facts to a
    // new first session and clobber all three fields.
    await openPlayerSession(scopedPool(), { ...sessionInput, initialLevel: 8 });
    expect(await readFacts(accountId)).toEqual(factsBefore);
  });

  it('re-running the fold with nothing newly doomed changes nothing', {
    timeout: 20_000,
  }, async () => {
    const db = await scopedClient();
    let accountId: number;
    let characterId: number;
    try {
      accountId = Number(
        (await db.query("INSERT INTO accounts (username) VALUES ('ivan') RETURNING id")).rows[0].id,
      );
      characterId = Number(
        (
          await db.query(
            `INSERT INTO characters (account_id, name, realm)
             VALUES ($1, 'Ivan', 'eastbrook') RETURNING id`,
            [accountId],
          )
        ).rows[0].id,
      );
      await db.query(
        `INSERT INTO play_sessions (account_id, character_id, started_at, ended_at, ip_address)
         VALUES
           ($1, $2, now() - interval '220 days',
            now() - interval '220 days' + interval '1000 seconds', '10.1.1.1'),
           ($1, $2, now() - interval '200 days',
            now() - interval '200 days' + interval '2000 seconds', '10.1.1.1'),
           ($1, $2, now() - interval '3 days',
            now() - interval '3 days' + interval '500 seconds', '10.1.1.1')`,
        [accountId, characterId],
      );
    } finally {
      db.release();
    }

    expect(await foldToExhaustion(180, 1000)).toBe(2);

    const verify = await scopedClient();
    let snapshot: Record<string, unknown>[];
    try {
      snapshot = (
        await verify.query('SELECT * FROM play_session_totals ORDER BY account_id, character_id')
      ).rows;
    } finally {
      verify.release();
    }
    expect(snapshot).toHaveLength(1);
    expect(Number(snapshot[0].playtime_seconds)).toBe(3000);
    expect(Number(snapshot[0].sessions)).toBe(2);

    // Nothing newly doomed: the second sweep must delete nothing and, above
    // all, never double-count the already-folded totals.
    await expect(prunePlaySessionsBatch(scopedPool(), 180, 1000)).resolves.toBe(0);

    const reverify = await scopedClient();
    try {
      const rows = (
        await reverify.query('SELECT * FROM play_session_totals ORDER BY account_id, character_id')
      ).rows;
      expect(rows).toEqual(snapshot);
    } finally {
      reverify.release();
    }
  });

  it('keeps the ban-evasion lookback alive across the fold horizon', {
    timeout: 20_000,
  }, async () => {
    const db = await scopedClient();
    let accountId: number;
    try {
      accountId = Number(
        (
          await db.query(
            `INSERT INTO accounts (username, last_login_ip)
               VALUES ('mallory', '203.0.113.9') RETURNING id`,
          )
        ).rows[0].id,
      );
      // The account's ONLY session from the banned IP: older than the
      // retention window, younger than the association aging bound.
      await db.query(
        `INSERT INTO play_sessions (account_id, character_id, started_at, ended_at, ip_address)
           VALUES ($1, NULL, now() - interval '200 days',
                   now() - interval '200 days' + interval '1200 seconds', '198.51.100.7')`,
        [accountId],
      );
      await db.query(
        `INSERT INTO daily_reward_ip_bans (ip_address, reason)
           VALUES ('198.51.100.7', 'evasion ring')`,
      );
    } finally {
      db.release();
    }

    expect(await foldToExhaustion(180, 1000)).toBe(1);

    const verify = await scopedClient();
    try {
      // The view's first three arms cannot match this account: no account
      // ban row, a DIFFERENT last_login_ip, and no surviving play_sessions
      // row from the banned IP. Only an account_ip_associations arm can
      // still name it, so the exclusion below proves that fourth arm works.
      const armProbes = await verify.query(
        `SELECT
             (SELECT count(*)::int FROM daily_reward_bans WHERE account_id = $1)
               AS account_bans,
             (SELECT last_login_ip FROM accounts WHERE id = $1) AS last_login_ip,
             (SELECT count(*)::int FROM play_sessions
               WHERE account_id = $1 AND ip_address = '198.51.100.7') AS banned_ip_sessions,
             (SELECT count(*)::int FROM account_ip_associations
               WHERE account_id = $1 AND ip_address = '198.51.100.7') AS associations`,
        [accountId],
      );
      expect(armProbes.rows[0]).toEqual({
        account_bans: 0,
        last_login_ip: '203.0.113.9',
        banned_ip_sessions: 0,
        associations: 1,
      });

      const excluded = await verify.query(
        'SELECT account_id, reason FROM daily_reward_excluded_accounts WHERE account_id = $1',
        [accountId],
      );
      expect(
        excluded.rows.map((row) => ({
          accountId: Number(row.account_id),
          reason: row.reason,
        })),
      ).toEqual([{ accountId, reason: 'evasion ring' }]);

      // The per-account eligibility probe must not free an evader whose
      // sessions aged out: it needs the same association lookback the view
      // gained. A missing export fails here decisively, never silently.
      expect(typeof banForAccountSql).toBe('string');
      const ban = await verify.query(String(banForAccountSql), [accountId]);
      expect(ban.rows.map((row) => ({ reason: row.reason }))).toEqual([{ reason: 'evasion ring' }]);
    } finally {
      verify.release();
    }
  });

  it('ages out only associations past the aging bound', async () => {
    const db = await scopedClient();
    try {
      const accountId = Number(
        (await db.query("INSERT INTO accounts (username) VALUES ('dana') RETURNING id")).rows[0].id,
      );
      await db.query(
        `INSERT INTO account_ip_associations (account_id, ip_address, last_seen_at)
         VALUES
           ($1, '10.9.9.9', now() - interval '800 days'),
           ($1, '10.8.8.8', now() - interval '100 days')`,
        [accountId],
      );
    } finally {
      db.release();
    }

    await expect(pruneAccountIpAssociationsBatch(scopedPool(), 730, 1000)).resolves.toBe(1);

    const verify = await scopedClient();
    try {
      const rows = await verify.query(
        'SELECT ip_address FROM account_ip_associations ORDER BY ip_address',
      );
      expect(rows.rows.map((row) => row.ip_address)).toEqual(['10.8.8.8']);
    } finally {
      verify.release();
    }
  });

  it('keeps every association when aging is disabled', async () => {
    const db = await scopedClient();
    try {
      const accountId = Number(
        (await db.query("INSERT INTO accounts (username) VALUES ('egon') RETURNING id")).rows[0].id,
      );
      await db.query(
        `INSERT INTO account_ip_associations (account_id, ip_address, last_seen_at)
         VALUES ($1, '10.7.7.7', now() - interval '900 days')`,
        [accountId],
      );
    } finally {
      db.release();
    }

    await expect(pruneAccountIpAssociationsBatch(scopedPool(), 0, 1000)).resolves.toBe(0);

    const verify = await scopedClient();
    try {
      const count = await verify.query(
        'SELECT count(*)::int AS count FROM account_ip_associations',
      );
      expect(count.rows[0].count).toBe(1);
    } finally {
      verify.release();
    }
  });
});
