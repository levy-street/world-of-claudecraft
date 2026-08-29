// Executed PostgreSQL proof for the character-delete commit-ambiguity verify
// read (server/character_delete_db.ts CHARACTER_DELETE_VERIFY_SQL). The whole
// point of that statement is a LOCK WAIT: a plain SELECT's READ COMMITTED
// snapshot sees a deleted-but-uncommitted row as PRESENT and answers "not
// landed" for a delete whose hung COMMIT then applies, so the resolver runs
// the exported statement FOR KEY SHARE inside its own bounded transaction and
// waits the in-flight transaction out (KEY SHARE queues behind the DELETE's
// row lock exactly like FOR UPDATE but never blocks a concurrent non-key
// character save in the not-landed case). Only real PostgreSQL can prove the
// wait and both of its outcomes (EvalPlanQual recheck on commit, surviving
// row on abort), so this suite drives the exact exported statement with the
// resolver's own SET LOCAL bounds. The PG16 CI shard supplies
// TEST_DATABASE_URL; local runs without it skip. Everything lives in a
// private search_path because the statement is unqualified `characters` on
// purpose and teardown must never touch a developer's game schema.

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS,
  CHARACTER_DELETE_VERIFY_SQL,
  DELETE_RESTORE_STATEMENT_TIMEOUT_MS,
} from '../../server/character_delete_db';

const url = process.env.TEST_DATABASE_URL ?? '';
const d = url === '' ? describe.skip : describe;
const SCHEMA = 'character_delete_verify_pg_test';
const REALM = 'pgtest';

d('the commit-ambiguity verify read against real PostgreSQL', () => {
  let pool: Pool;

  beforeAll(async () => {
    const pg = await import('pg');
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    pool = new pg.Pool({
      connectionString: url,
      max: 4,
      options: `-c search_path=${SCHEMA}`,
      application_name: SCHEMA,
    });
    const currentSchema = await pool.query('SELECT current_schema() AS name');
    if (currentSchema.rows[0]?.name !== SCHEMA) {
      throw new Error('character-delete verify PG test did not enter its private schema');
    }
    // Minimal stand-in: the verify statement touches only these three columns.
    await pool.query(
      'CREATE TABLE characters (id INT PRIMARY KEY, account_id INT NOT NULL, realm TEXT NOT NULL)',
    );
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  /** The resolver's verify transaction, statement for statement: BEGIN, the
   *  SET LOCAL bounds, the exported locked read, ROLLBACK. */
  async function runVerify(
    client: PoolClient,
    lockTimeoutMs: number = CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS,
  ): Promise<boolean> {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${DELETE_RESTORE_STATEMENT_TIMEOUT_MS};
      SET LOCAL lock_timeout = ${lockTimeoutMs};
      SET LOCAL idle_in_transaction_session_timeout = '2s'`);
    try {
      const row = await client.query(CHARACTER_DELETE_VERIFY_SQL, [42, 7, REALM]);
      return (row.rowCount ?? 0) === 0;
    } finally {
      await client.query('ROLLBACK');
    }
  }

  /** Autocommit poll (pg_stat_activity inside a transaction is a frozen
   *  snapshot, so the poll must run statement-per-statement on the pool)
   *  until the verify backend really queues on the row lock. Wall-bounded
   *  around 3s, well under the 10s lock_timeout, so a never-queued verify
   *  fails HERE with its own message rather than confusingly at the
   *  verify's later 55P03. */
  async function waitForLockWaiter(): Promise<void> {
    for (let i = 0; i < 120; i++) {
      const waiting = await pool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE application_name = $1 AND wait_event_type = 'Lock'`,
        [SCHEMA],
      );
      if ((waiting.rowCount ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the verify read never queued on the row lock');
  }

  /** A failed assertion must not leak an open transaction back into the
   *  pool (node-postgres does not reset on release; the leaked row lock
   *  would wedge the next test's verify and block afterAll's DROP SCHEMA):
   *  roll the deleter back before release (a warning no-op after an
   *  explicit COMMIT/ROLLBACK), settle the verify promise so the verifier
   *  is never released with a query in flight, then release both. */
  async function settleAndRelease(
    deleter: PoolClient,
    verifier: PoolClient,
    wait: Promise<unknown> | null,
  ): Promise<void> {
    await deleter.query('ROLLBACK').catch(() => {});
    deleter.release();
    if (wait) await wait.catch(() => {});
    verifier.release();
  }

  it('waits the uncommitted delete out and answers landed once its COMMIT applies', async () => {
    await pool.query('INSERT INTO characters (id, account_id, realm) VALUES (42, 7, $1)', [REALM]);
    const deleter = await pool.connect();
    const verifier = await pool.connect();
    let wait: Promise<boolean> | null = null;
    try {
      await deleter.query('BEGIN');
      await deleter.query('DELETE FROM characters WHERE id = 42');
      // The exact wrong answer the locked read exists to avoid: a plain
      // SELECT's snapshot reads the deleted-but-uncommitted row as present,
      // so the racing resolver shape reported "not landed" for a delete
      // about to commit.
      const racing = await verifier.query(
        'SELECT 1 FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3',
        [42, 7, REALM],
      );
      expect(racing.rowCount).toBe(1);
      let settled = false;
      wait = runVerify(verifier).then((landed) => {
        settled = true;
        return landed;
      });
      // Handled at creation: if an assertion below throws first, the pending
      // rejection must not surface as an unhandled error while the finally
      // cleans up.
      wait.catch(() => {});
      // The verify is really WAITING behind the row lock, not answering from
      // its snapshot.
      await waitForLockWaiter();
      expect(settled).toBe(false);
      await deleter.query('COMMIT');
      // EvalPlanQual recheck against the committed delete: zero rows, landed.
      await expect(wait).resolves.toBe(true);
    } finally {
      await settleAndRelease(deleter, verifier, wait);
    }
  }, 20_000);

  it('answers not-landed with the surviving row when the in-flight delete aborts', async () => {
    await pool.query(
      'INSERT INTO characters (id, account_id, realm) VALUES (42, 7, $1) ON CONFLICT (id) DO NOTHING',
      [REALM],
    );
    const deleter = await pool.connect();
    const verifier = await pool.connect();
    let wait: Promise<boolean> | null = null;
    try {
      await deleter.query('BEGIN');
      await deleter.query('DELETE FROM characters WHERE id = 42');
      wait = runVerify(verifier);
      wait.catch(() => {});
      await waitForLockWaiter();
      await deleter.query('ROLLBACK');
      // The abort leaves the row: the verify shares it, reads it, and the
      // original ambiguity stands (retryable), never a phantom success.
      await expect(wait).resolves.toBe(false);
    } finally {
      await settleAndRelease(deleter, verifier, wait);
    }
  }, 20_000);

  it('a lock wait past the idle bound is never reaped: waiting is active, not idle', async () => {
    // The interaction pin between the verify's two tightest bounds: the 2s
    // idle_in_transaction_session_timeout must not truncate the 10s lock
    // wait (a waiting backend is ACTIVE, not idle; measured, a 5s hold
    // survived the 2s bound and still answered). The regression mode is
    // silent and is the exact bug the resolver fixes: a reaped verify
    // answers "unresolved" forever while the world purge stops running,
    // with every shorter-wait test still green.
    await pool.query(
      'INSERT INTO characters (id, account_id, realm) VALUES (42, 7, $1) ON CONFLICT (id) DO NOTHING',
      [REALM],
    );
    const deleter = await pool.connect();
    const verifier = await pool.connect();
    let wait: Promise<boolean> | null = null;
    try {
      await deleter.query('BEGIN');
      await deleter.query('DELETE FROM characters WHERE id = 42');
      wait = runVerify(verifier); // the REAL 10s lock bound
      wait.catch(() => {});
      await waitForLockWaiter();
      // Hold the lock well past the 2s idle bound before resolving it.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await deleter.query('COMMIT');
      await expect(wait).resolves.toBe(true);
    } finally {
      await settleAndRelease(deleter, verifier, wait);
    }
  }, 20_000);

  it('a lock_timeout expiry rejects with its own 55P03 instead of guessing', async () => {
    await pool.query(
      'INSERT INTO characters (id, account_id, realm) VALUES (42, 7, $1) ON CONFLICT (id) DO NOTHING',
      [REALM],
    );
    const deleter = await pool.connect();
    const verifier = await pool.connect();
    try {
      await deleter.query('BEGIN');
      await deleter.query('DELETE FROM characters WHERE id = 42');
      // A wait the holder outlasts: the bounded verify must surface the
      // coded lock_not_available (the resolver's catch propagates the
      // original ambiguity on it), never a fabricated answer.
      await expect(runVerify(verifier, 200)).rejects.toMatchObject({ code: '55P03' });
      await deleter.query('ROLLBACK');
    } finally {
      await settleAndRelease(deleter, verifier, null);
    }
  }, 20_000);
});
