// Opt-in real-Postgres coverage for the additive auth-token scope constraint.
// The default suite stays DB-free; set TEST_DATABASE_URL to execute the exact
// production DDL against an isolated schema.

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA_NAME = 'auth_token_scope_constraint_integration_test';
const describeDb = DB_URL ? describe : describe.skip;

if (DB_URL) process.env.DATABASE_URL = DB_URL;

describeDb('auth token scope constraint (real Postgres)', () => {
  let pool: Pool;
  let constraintSql: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA_NAME}`);
    const db = await pool.connect();
    try {
      await db.query(`SET search_path TO ${SCHEMA_NAME}`);
      await db.query(`
        CREATE TABLE accounts (id INT PRIMARY KEY);
        CREATE TABLE auth_tokens (
          token TEXT PRIMARY KEY,
          account_id INT NOT NULL REFERENCES accounts(id),
          expires_at TIMESTAMPTZ NOT NULL,
          scope TEXT NOT NULL DEFAULT 'full'
        );
        INSERT INTO accounts VALUES (1);
        INSERT INTO auth_tokens (token, account_id, expires_at, scope)
        VALUES ('historical-invalid', 1, now() + interval '1 day', 'legacy');
      `);
      const dbModule = await import('../server/db');
      constraintSql = dbModule.AUTH_TOKENS_SCOPE_CONSTRAINT_SQL;
      await db.query(constraintSql);
      await db.query(constraintSql);
    } finally {
      db.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE`);
    await pool.end();
  });

  async function scopedQuery(text: string, values: unknown[] = []) {
    const db = await pool.connect();
    try {
      await db.query(`SET search_path TO ${SCHEMA_NAME}`);
      return await db.query(text, values);
    } finally {
      db.release();
    }
  }

  it('is idempotent and leaves the constraint unvalidated for historical rows', async () => {
    const result = await scopedQuery(
      `SELECT convalidated
         FROM pg_constraint
        WHERE conname = 'auth_tokens_scope_check'
          AND conrelid = 'auth_tokens'::regclass`,
    );
    expect(result.rows).toEqual([{ convalidated: false }]);
    const historical = await scopedQuery(
      "SELECT scope FROM auth_tokens WHERE token = 'historical-invalid'",
    );
    expect(historical.rows).toEqual([{ scope: 'legacy' }]);
  });

  it.each(['full', 'read'])('accepts a new %s token', async (scope) => {
    await expect(
      scopedQuery(
        `INSERT INTO auth_tokens (token, account_id, expires_at, scope)
         VALUES ($1, 1, now() + interval '1 day', $2)`,
        [`valid-${scope}`, scope],
      ),
    ).resolves.toBeDefined();
  });

  it('rejects a new token outside the closed scope vocabulary', async () => {
    await expect(
      scopedQuery(
        `INSERT INTO auth_tokens (token, account_id, expires_at, scope)
         VALUES ('new-invalid', 1, now() + interval '1 day', 'write')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
