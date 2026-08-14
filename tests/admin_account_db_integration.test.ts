// Opt-in real-Postgres coverage for the account detail read's Cheater mark
// mapping. The default suite stays DB-free; set TEST_DATABASE_URL to run it
// (it skips green without one). Mirrors the "production statements, executed"
// block of admin_guilds_db_integration.test.ts: an isolated schema carrying the
// REAL boot DDL, in the REAL order ensureSchema applies it, so the statement
// under test runs against production's columns, types, and defaults.
//
// Why this suite exists: every other admin_db suite feeds accountDetail a mocked
// pg result, so the three cheater_mark_* SELECT columns and the nullable
// cheaterMark object they fold into are asserted against a fixture the test
// itself wrote. Nothing proved the column names, the COALESCE, or the
// seconds-is-the-authority gate against a real accounts row until here.

import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_GUILDS_SCHEMA } from '../server/admin_guilds_schema';
import { GENERAL_CHAT_QUOTA_SCHEMA } from '../server/general_chat_quota_schema';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'admin_account_detail_integration_test';
const REALM = 'AccountDetailRealm';
const describeDb = DB_URL ? describe : describe.skip;

// A fixed instant, so the set_at assertion pins the value that came back rather
// than re-deriving whatever now() happened to be.
const MARK_SET_AT = '2026-08-10T13:00:00.000Z';
const MARK_SECONDS = 36_000;
const MARK_REASON = 'win-trading the 1v1 arena';

type AdminDb = typeof import('../server/admin_db');

describeDb('admin account detail cheater mark mapping (real Postgres)', () => {
  let bootstrap: Pool;
  let adminDb: AdminDb;
  let dbPool: Pool;
  const accountIds = new Map<string, number>();

  async function seedAccount(
    client: PoolClient,
    username: string,
    mark: { seconds: number; reason: string | null; setAt: string | null },
  ): Promise<void> {
    const inserted = await client.query(
      `INSERT INTO accounts (username, password_hash, cheater_mark_seconds,
                             cheater_mark_reason, cheater_mark_set_at)
       VALUES ($1, 'hash', $2, $3, $4) RETURNING id`,
      [username, mark.seconds, mark.reason, mark.setAt],
    );
    accountIds.set(username, Number(inserted.rows[0].id));
  }

  function accountId(username: string): number {
    const id = accountIds.get(username);
    if (id === undefined) throw new Error(`account "${username}" was not seeded`);
    return id;
  }

  beforeAll(async () => {
    bootstrap = new Pool({
      connectionString: DB_URL,
      max: 2,
      options: `-c search_path=${SCHEMA}`,
    });
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await bootstrap.query(`CREATE SCHEMA ${SCHEMA}`);

    // server/db.ts reads DATABASE_URL (and server/realm.ts REALM_NAME) at IMPORT
    // time, so both are pinned before the first dynamic import. process.loadEnvFile
    // never overwrites an already-set key, so a developer's .env cannot redirect
    // this suite at the real database.
    process.env.DATABASE_URL = `${DB_URL}?options=-c%20search_path%3D${SCHEMA}`;
    process.env.REALM_NAME = REALM;

    const db = await import('../server/db');
    const social = await import('../server/social_db');
    const playerMetrics = await import('../server/player_metrics_db');
    const retention = await import('../server/play_session_retention_db');
    dbPool = db.pool as unknown as Pool;

    const client = await bootstrap.connect();
    try {
      // The same modules, in the same order, as ensureSchema's boot sequence.
      await client.query(db.SCHEMA);
      await client.query(playerMetrics.PLAYER_METRICS_SCHEMA);
      await client.query(retention.PLAY_SESSION_RETENTION_SCHEMA);
      await client.query(db.DAILY_REWARD_EXCLUDED_ACCOUNTS_VIEW_SQL);
      await client.query(social.SOCIAL_SCHEMA);
      await client.query(ADMIN_GUILDS_SCHEMA);
      // accountDetail LEFT JOINs the general chat quota table, so the read needs
      // it even though this suite never sets a quota.
      await client.query(GENERAL_CHAT_QUOTA_SCHEMA);

      await seedAccount(client, 'marked', {
        seconds: MARK_SECONDS,
        reason: MARK_REASON,
        setAt: MARK_SET_AT,
      });
      // The shape liftAccountCheaterMark leaves behind: budget zeroed, reason and
      // set_at nulled.
      await seedAccount(client, 'lifted', { seconds: 0, reason: null, setAt: null });
      // Defence in depth: seconds is the authority for "is marked", so stale
      // reason text on a zero budget must still read as unmarked.
      await seedAccount(client, 'stale_reason', {
        seconds: 0,
        reason: 'lifted on appeal, text left behind',
        setAt: MARK_SET_AT,
      });
      // A live mark whose reason/set_at are NULL (a row written before either
      // column existed): the COALESCE and the ?? null arm keep it readable.
      await seedAccount(client, 'bare_mark', { seconds: 60, reason: null, setAt: null });
    } finally {
      client.release();
    }

    adminDb = await import('../server/admin_db');
  }, 120_000);

  afterAll(async () => {
    if (dbPool) await dbPool.end();
    if (!bootstrap) return;
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await bootstrap.end();
  });

  it('reads a marked account back as a populated cheaterMark object', async () => {
    const detail = await adminDb.accountDetail(accountId('marked'));

    expect(detail?.username).toBe('marked');
    const mark = detail?.cheaterMark;
    if (!mark) throw new Error('the marked account read back unmarked');
    expect(mark.secondsRemaining).toBe(MARK_SECONDS);
    expect(mark.reason).toBe(MARK_REASON);
    // pg hands timestamptz back as a Date; the dashboard receives it as the JSON
    // ISO string fmtDate parses, so pin the instant through that serialization
    // rather than the driver's in-process representation.
    expect(JSON.parse(JSON.stringify(mark)).setAt).toBe(MARK_SET_AT);
  });

  it('reads a lifted account back as a null cheaterMark', async () => {
    const lifted = await adminDb.accountDetail(accountId('lifted'));
    expect(lifted?.username).toBe('lifted');
    expect(lifted?.cheaterMark).toBeNull();

    // A zero budget is unmarked no matter what the other two columns hold.
    const stale = await adminDb.accountDetail(accountId('stale_reason'));
    expect(stale?.cheaterMark).toBeNull();
  });

  it('keeps a live mark readable when its reason and set_at are NULL', async () => {
    const detail = await adminDb.accountDetail(accountId('bare_mark'));

    expect(detail?.cheaterMark).toEqual({ secondsRemaining: 60, reason: '', setAt: null });
  });
});
