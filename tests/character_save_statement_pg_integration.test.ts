// Opt-in REAL-Postgres proof for the lease-fenced character save statements
// (server/character_save_statement.ts via server/db.ts).
//
// WHY THIS FILE EXISTS. tests/server/character_save_statement.test.ts pins the
// SQL text of all three fences and tests/server/save_offline_character_state.test.ts
// pins the rowCount mapping over a MOCKED pool, so the `unleased` fence's real
// predicate, NOT EXISTS over character_leases with an expires_at qual, had
// never been evaluated by a database (the phase 13 QA final gate's one missing
// suite). This is the fence that decides whether an operator's legendary-name
// strip lands or is refused (D13-5's login-race closure), so its live
// semantics get the same REAL-schema proof the guild bank's dupe-critical SQL
// has: a live lease refuses, an expired one admits, a released one admits, and
// the nonce fence admits only the holder's own nonce.
//
// DISPOSABLE DATABASE, NEVER A SHARED ONE (the guild_bank_pg_integration
// recipe verbatim): the suite DROPs and CREATEs its own database on the server
// TEST_DATABASE_URL points at and boots the real ensureSchema() into it.
// Without TEST_DATABASE_URL the file skips green and the DB-free floor is
// unchanged.

import type { Pool as PgPool } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CharacterState } from '../src/sim/sim';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_character_save_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load; nothing above statically
// imports a server module, so this assignment points the module under test at
// the disposable database (the guild bank suite's ordering trick).
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

const STATE = (marker: string) =>
  ({ level: 5, marker, questLog: [], questsDone: [], inventory: [] }) as unknown as CharacterState;

describeDb('lease-fenced character saves (REAL Postgres)', () => {
  let admin: PgPool;
  let pool: PgPool;
  let db: typeof import('../server/db');
  let realm: string;

  let nextSeq = 0;
  const seq = () => ++nextSeq;

  async function makeCharacter(): Promise<number> {
    const acc = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`csverify_${seq()}`],
    );
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
      [Number(acc.rows[0].id), `CSVerify${seq()}`, realm],
    );
    return Number(res.rows[0].id);
  }

  async function grantLease(characterId: number, nonce: string, secondsFromNow: number) {
    await pool.query(
      `INSERT INTO character_leases (character_id, realm, holder, nonce, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
       ON CONFLICT (character_id)
       DO UPDATE SET holder = EXCLUDED.holder, nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
      [characterId, realm, db.PROCESS_LEASE_HOLDER, nonce, secondsFromNow],
    );
  }

  async function markerOf(characterId: number): Promise<string | undefined> {
    const res = await pool.query(
      `SELECT state->>'marker' AS marker FROM characters WHERE id = $1`,
      [characterId],
    );
    return res.rows[0]?.marker ?? undefined;
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    realm = (await import('../server/realm')).REALM;
    await db.ensureSchema();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 8 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  describe('the unleased fence (saveOfflineCharacterState, the D13-5 strip write)', () => {
    it('lands on a character with NO lease row at all', async () => {
      const id = await makeCharacter();
      expect(await db.saveOfflineCharacterState(id, 7, STATE('no-lease'))).toBe(true);
      expect(await markerOf(id)).toBe('no-lease');
    });

    it('REFUSES while a live lease stands, touching nothing', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'live-nonce', 3600);
      expect(await db.saveOfflineCharacterState(id, 7, STATE('must-not-land'))).toBe(false);
      expect(await markerOf(id)).toBeUndefined();
    });

    it('lands once the lease is EXPIRED (the crashed-process arm), and after a release', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'stale-nonce', -60);
      expect(await db.saveOfflineCharacterState(id, 7, STATE('expired-ok'))).toBe(true);
      expect(await markerOf(id)).toBe('expired-ok');

      const released = await makeCharacter();
      await grantLease(released, 'gone-nonce', 3600);
      await pool.query(`DELETE FROM character_leases WHERE character_id = $1`, [released]);
      expect(await db.saveOfflineCharacterState(released, 7, STATE('released-ok'))).toBe(true);
      expect(await markerOf(released)).toBe('released-ok');
    });

    it('is fenced per CHARACTER: a neighbour holding a live lease blocks only itself', async () => {
      const leased = await makeCharacter();
      const free = await makeCharacter();
      await grantLease(leased, 'live-nonce', 3600);
      expect(await db.saveOfflineCharacterState(free, 7, STATE('free-ok'))).toBe(true);
      expect(await db.saveOfflineCharacterState(leased, 7, STATE('still-blocked'))).toBe(false);
      expect(await markerOf(free)).toBe('free-ok');
      expect(await markerOf(leased)).toBeUndefined();
    });

    it('answers false, never a throw, for a character row that does not exist', async () => {
      expect(await db.saveOfflineCharacterState(999_999, 7, STATE('ghost'))).toBe(false);
    });

    it('REFUSES a cross-realm character id, touching nothing (the realm qualifier)', async () => {
      // The Phase 17 security review's defense-in-depth arm: the offline
      // writer takes a bare id from an admin route, so the statement itself
      // pins the row's realm instead of trusting every caller's pre-checks.
      const acc = await pool.query(
        `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
        [`csvrealm_${seq()}`],
      );
      const other = await pool.query(
        `INSERT INTO characters (account_id, name, class, realm, level, state)
           VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
        [Number(acc.rows[0].id), `CSVerifyX${seq()}`, `${realm}-other`],
      );
      const id = Number(other.rows[0].id);
      expect(await db.saveOfflineCharacterState(id, 7, STATE('cross-realm'))).toBe(false);
      expect(await markerOf(id)).toBeUndefined();
    });
  });

  describe('the nonce fence (saveCharacterState, the live-session save)', () => {
    it('lands with the holder-and-nonce the lease carries, refuses a displaced nonce', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'session-a', 3600);
      expect(await db.saveCharacterState(id, 7, STATE('own-nonce'), 'session-a')).toBe(true);
      expect(await markerOf(id)).toBe('own-nonce');
      // A takeover replaced the nonce: the displaced session's fenced write
      // touches nothing (the zombie-overwrite closure).
      await grantLease(id, 'session-b', 3600);
      expect(await db.saveCharacterState(id, 8, STATE('zombie'), 'session-a')).toBe(false);
      expect(await markerOf(id)).toBe('own-nonce');
    });

    it('the unfenced arm (no nonce) still lands regardless of leases (the legacy shape)', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'whoever', 3600);
      expect(await db.saveCharacterState(id, 7, STATE('unfenced'))).toBe(true);
      expect(await markerOf(id)).toBe('unfenced');
    });
  });
});
