// Opt-in REAL-Postgres proof for the account-wealth escrow aggregation.
//
// WHY THIS FILE EXISTS. tests/account_wealth_db.test.ts pins the SQL's SHAPE
// against a mocked pool, and tests/account_wealth.test.ts keeps the Node
// oracle (escrowTotalsFromStateRows) executable in CI. Neither can prove the
// jsonb expansion itself: the typeof guards against malformed blobs, the
// safe-integer id line, the realm-scoped legacy-name merge, or the resolve
// and upsert against real characters and accounts. This suite drives the REAL
// exported functions against a REAL PostgreSQL 16 server with the REAL boot
// schema, and pins the SQL aggregate byte-identical to the Node oracle on a
// shared fixture (the acceptance criterion of the sweep rework).
//
// DISPOSABLE DATABASE, NEVER A SHARED ONE. Same discipline as
// tests/guild_bank_pg_integration.test.ts: DROP and CREATE a private database
// on the server TEST_DATABASE_URL points at, refuse to run against the URL's
// own database, boot the real ensureSchema() into it.
//
// Gated on TEST_DATABASE_URL like every other *_integration.test.ts: without
// it the file skips green and CI's DB-free floor is unchanged.

import type { Pool as PgPool } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mailRecipientKey } from '../server/mail_partition_backfill';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_account_wealth_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load and builds its pool from it.
// Nothing above is a static import of a server module, so this assignment
// runs first and points the modules under test at the disposable database.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

describeDb('account wealth escrow aggregation (REAL Postgres)', () => {
  let admin: PgPool;
  let pool: PgPool;
  let db: typeof import('../server/db');
  let wealthDb: typeof import('../server/account_wealth_db');
  let wealth: typeof import('../server/account_wealth');
  let realm: string;

  let nextSeq = 0;
  const seq = () => ++nextSeq;

  async function makeAccount(): Promise<number> {
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`awverify_${seq()}`],
    );
    return Number(res.rows[0].id);
  }

  async function makeCharacter(
    accountId: number,
    name: string,
    charRealm: string,
  ): Promise<number> {
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
      [accountId, name, charRealm],
    );
    return Number(res.rows[0].id);
  }

  async function putWorldState(key: string, data: unknown): Promise<void> {
    await pool.query(
      `INSERT INTO world_state (key, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [key, JSON.stringify(data)],
    );
  }

  async function putMailPartition(
    charRealm: string,
    recipientKey: string,
    mail: unknown[],
  ): Promise<void> {
    await putWorldState(mailRecipientKey(charRealm, recipientKey), { mail });
  }

  async function wealthRow(
    accountId: number,
  ): Promise<{ mail: number; market: number; total: number } | null> {
    const res = await pool.query(
      `SELECT mail_copper, market_copper, total_copper FROM account_wealth WHERE account_id = $1`,
      [accountId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      mail: Number(row.mail_copper),
      market: Number(row.market_copper),
      total: Number(row.total_copper),
    };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    // Never drop the database the caller pointed us at.
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    wealthDb = await import('../server/account_wealth_db');
    wealth = await import('../server/account_wealth');
    realm = (await import('../server/realm')).REALM;

    await db.ensureSchema();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 8 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  // The full escrow lifecycle on one fixture: the SQL aggregate is pinned
  // byte-identical to the Node oracle, then resolves and upserts through the
  // real applyEscrowTotals, then zeroes when the books empty.
  it('aggregates the fixture identically to the Node oracle and settles it end to end', async () => {
    const accountA = await makeAccount();
    const accountB = await makeAccount();
    const accountC = await makeAccount();
    const idKeyed = await makeCharacter(accountA, 'AwvIdKeyed', realm);
    // Legacy name-keyed characters: names are only unique per realm, so the
    // same name on two realms must resolve to two different accounts.
    await makeCharacter(accountB, 'AwvOldname', realm);
    await makeCharacter(accountC, 'AwvOldname', 'awv-frostmark');

    await putMailPartition(realm, String(idKeyed), [
      // Ordinary id-keyed letters: sum, with a leading-zero and a padded
      // variant merging into the same character id.
      { recipientKey: String(idKeyed), copper: 500 },
      { recipientKey: `0${idKeyed}`, copper: 250 },
      { recipientKey: ` ${idKeyed} `, copper: 40 },
      // Control-character padding trims like String.trim on both sides,
      // and a whitespace-only key collapses to the skipped '' key.
      { recipientKey: `\t${idKeyed}\n`, copper: 8 },
      { recipientKey: '\t', copper: 11 },
      // Floors: 2.9 counts 2; 0.9 floors to zero and is skipped.
      { recipientKey: String(idKeyed), copper: 2.9 },
      { recipientKey: String(idKeyed), copper: 0.9 },
      // Skipped entirely: house key, zero, negative, non-number copper,
      // non-string key, missing fields, null entry.
      { recipientKey: '', copper: 100 },
      { recipientKey: String(idKeyed), copper: 0 },
      { recipientKey: String(idKeyed), copper: -50 },
      { recipientKey: String(idKeyed), copper: '50' },
      // Non-castable coppers: '50' above would survive a ::numeric cast,
      // so these three pin that the typeof CASE armor (not qual luck)
      // keeps a string, object, or boolean copper from aborting the
      // statement.
      { recipientKey: String(idKeyed), copper: 'abc' },
      { recipientKey: String(idKeyed), copper: { nested: true } },
      { recipientKey: String(idKeyed), copper: true },
      { recipientKey: 42, copper: 10 },
      { recipientKey: String(idKeyed) },
      null,
    ]);
    await putMailPartition(realm, 'AwvOldname', [
      // Legacy name-keyed letter, realm-scoped.
      { recipientKey: 'AwvOldname', copper: 300 },
    ]);
    await putMailPartition(realm, '9007199254740993', [
      // All-digit keys past Number.MAX_SAFE_INTEGER stay name-resolved
      // (and match no character, so they never reach account_wealth).
      { recipientKey: '9007199254740993', copper: 5 },
    ]);
    await putMailPartition(realm, '123456789012345678901', [
      // Long all-digit keys past the SQL's 16-significant-digit regex line
      // stay name-resolved too.
      { recipientKey: '123456789012345678901', copper: 3 },
    ]);
    await putWorldState('mail:awv-frostmark', {
      mail: [
        // Id keys merge across realms; the twin name stays realm-scoped.
        { recipientKey: String(idKeyed), copper: 5 },
        { recipientKey: 'AwvOldname', copper: 20 },
      ],
    });
    await putWorldState(`market:${realm}`, {
      collections: [
        { key: String(idKeyed), copper: 60 },
        { key: 'AwvOldname', copper: 30 },
        { key: '', copper: 999 },
      ],
    });
    // Malformed blobs must contribute nothing and fail nothing.
    await putWorldState('mail:awv-badshape', { mail: { not: 'an array' } });
    await putWorldState('mail:awv-scalar', 'just a string');
    // The retained bare legacy market rollback row is excluded by key shape.
    await putWorldState('market', { collections: [{ key: String(idKeyed), copper: 77_777 }] });

    // --- The parity pin: SQL aggregate == Node oracle on the same rows. ---
    const raw = await pool.query(
      `SELECT key, data FROM world_state WHERE key LIKE 'mail:%' OR key LIKE 'market:%'`,
    );
    const oracle = wealth.escrowTotalsFromStateRows(
      raw.rows.map((row) => ({ key: row.key, data: row.data })),
    );
    const aggregated = await wealthDb.aggregateEscrowTotals();
    const canon = (rows: (typeof oracle)[number][]) =>
      [...rows].sort((a, b) =>
        JSON.stringify([a.characterId, a.characterName, a.realm]).localeCompare(
          JSON.stringify([b.characterId, b.characterName, b.realm]),
        ),
      );
    expect(canon(aggregated)).toEqual(canon(oracle));

    // Spot-check the aggregate against hand-computed sums so the parity pin
    // can never pass by both sides being wrong the same way.
    expect(canon(aggregated)).toEqual(
      canon([
        // 500 + 250 + 40 + 8 + floor(2.9) across realms (+5 frostmark) = 805.
        {
          characterId: idKeyed,
          characterName: null,
          realm: null,
          mailCopper: 805,
          marketCopper: 60,
        },
        {
          characterId: null,
          characterName: 'AwvOldname',
          realm,
          mailCopper: 300,
          marketCopper: 30,
        },
        {
          characterId: null,
          characterName: 'AwvOldname',
          realm: 'awv-frostmark',
          mailCopper: 20,
          marketCopper: 0,
        },
        {
          characterId: null,
          characterName: '9007199254740993',
          realm,
          mailCopper: 5,
          marketCopper: 0,
        },
        {
          characterId: null,
          characterName: '123456789012345678901',
          realm,
          mailCopper: 3,
          marketCopper: 0,
        },
      ]),
    );

    // --- End to end: resolve + upsert through the real applyEscrowTotals. ---
    await wealthDb.applyEscrowTotals(aggregated);
    expect(await wealthRow(accountA)).toEqual({ mail: 805, market: 60, total: 865 });
    expect(await wealthRow(accountB)).toEqual({ mail: 300, market: 30, total: 330 });
    expect(await wealthRow(accountC)).toEqual({ mail: 20, market: 0, total: 20 });

    // --- Collected books zero the escrow on the next pass. ---
    await putMailPartition(realm, String(idKeyed), []);
    await putMailPartition(realm, 'AwvOldname', []);
    await putMailPartition(realm, '9007199254740993', []);
    await putMailPartition(realm, '123456789012345678901', []);
    await putWorldState('mail:awv-frostmark', { mail: [] });
    await putWorldState(`market:${realm}`, { collections: [] });
    await wealthDb.applyEscrowTotals(await wealthDb.aggregateEscrowTotals());
    expect(await wealthRow(accountA)).toEqual({ mail: 0, market: 0, total: 0 });
    expect(await wealthRow(accountB)).toEqual({ mail: 0, market: 0, total: 0 });
    expect(await wealthRow(accountC)).toEqual({ mail: 0, market: 0, total: 0 });
  });

  it('skips an absurd copper value instead of aborting the sweep (deliberate oracle divergence)', async () => {
    const account = await makeAccount();
    const charId = await makeCharacter(account, 'AwvAbsurd', realm);
    await putWorldState('mail:awv-absurd', {
      mail: [
        // At MAX_SAFE_INTEGER + 1 the bigint pipeline would abort in
        // applyEscrowTotals even under the retired Node fold; the SQL skips
        // the entry so the pass stays alive, and sums the sane sibling.
        { recipientKey: String(charId), copper: 9007199254740992 },
        { recipientKey: String(charId), copper: 25 },
      ],
    });
    const aggregated = await wealthDb.aggregateEscrowTotals();
    expect(aggregated.find((t) => t.characterId === charId)?.mailCopper).toBe(25);
  });

  it('holds the parity and the sums on a large book (the flat-cost claim, sampled)', async () => {
    const account = await makeAccount();
    const charId = await makeCharacter(account, 'AwvBulk', realm);
    const letters: { recipientKey: string; copper: number }[] = [];
    let expected = 0;
    for (let i = 0; i < 20_000; i++) {
      // Every third letter carries copper; the rest are the item-only bulk
      // that dominates a real book.
      const copper = i % 3 === 0 ? (i % 97) + 1 : 0;
      expected += copper;
      letters.push({ recipientKey: String(charId), copper });
    }
    await putWorldState('mail:awv-bulk', { mail: letters });
    const aggregated = await wealthDb.aggregateEscrowTotals();
    const bulk = aggregated.find((t) => t.characterId === charId);
    expect(bulk?.mailCopper).toBe(expected);
    const oracle = wealth
      .escrowTotalsFromStateRows([{ key: 'mail:awv-bulk', data: { mail: letters } }])
      .find((t) => t.characterId === charId);
    expect(bulk?.mailCopper).toBe(oracle?.mailCopper);
  });
});
