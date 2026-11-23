import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  DELETE_REALM_MOTD_SQL,
  LOAD_REALM_MOTD_SQL,
  REALM_MOTD_SCHEMA,
  realmMotdStore,
  UPSERT_REALM_MOTD_SQL,
} from '../server/realm_motd_db';

function fakePool(rows: unknown[] = []) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows }));
  return { pool: { query } as unknown as Pool, query };
}

const oneLine = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('realm_motd_db', () => {
  it('keeps the schema additive: the live row keyed by realm plus the change trail', () => {
    expect(REALM_MOTD_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS realm_motd (');
    expect(REALM_MOTD_SCHEMA).toContain('realm TEXT PRIMARY KEY');
    expect(REALM_MOTD_SCHEMA).toContain('set_by INT REFERENCES accounts(id) ON DELETE SET NULL');
    expect(REALM_MOTD_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS realm_motd_changes (');
    expect(REALM_MOTD_SCHEMA).toContain(
      'changed_by INT REFERENCES accounts(id) ON DELETE SET NULL',
    );
    expect(oneLine(REALM_MOTD_SCHEMA)).toContain(
      'CREATE INDEX IF NOT EXISTS realm_motd_changes_realm_time ON realm_motd_changes (realm, changed_at DESC)',
    );
    expect(REALM_MOTD_SCHEMA).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
    expect(REALM_MOTD_SCHEMA).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
    expect(REALM_MOTD_SCHEMA).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it('loads the realm row, or null when no message is set', async () => {
    const withRow = fakePool([{ message: 'Welcome' }]);
    await expect(realmMotdStore(() => withRow.pool, 'eu-1').load()).resolves.toBe('Welcome');
    expect(withRow.query).toHaveBeenCalledWith('SELECT message FROM realm_motd WHERE realm = $1', [
      'eu-1',
    ]);
    expect(LOAD_REALM_MOTD_SQL).toBe('SELECT message FROM realm_motd WHERE realm = $1');

    const empty = fakePool([]);
    await expect(realmMotdStore(() => empty.pool, 'eu-1').load()).resolves.toBeNull();
  });

  it('upserts a message and records the change in the same statement', async () => {
    const { pool, query } = fakePool();

    await realmMotdStore(() => pool, 'eu-1').save('Hello', 42);

    expect(query).toHaveBeenLastCalledWith(UPSERT_REALM_MOTD_SQL, ['eu-1', 'Hello', 42]);
    expect(oneLine(UPSERT_REALM_MOTD_SQL)).toBe(
      'WITH change AS ( INSERT INTO realm_motd_changes (realm, message, changed_by) ' +
        'VALUES ($1, $2, $3) ) ' +
        'INSERT INTO realm_motd (realm, message, set_by, updated_at) VALUES ($1, $2, $3, now()) ' +
        'ON CONFLICT (realm) DO UPDATE SET message = EXCLUDED.message, ' +
        'set_by = EXCLUDED.set_by, updated_at = now()',
    );
  });

  it('deletes the row on clear and records a NULL-message change, parameterized', async () => {
    const { pool, query } = fakePool();

    await realmMotdStore(() => pool, 'eu-1').save(null, 42);

    expect(query).toHaveBeenLastCalledWith(DELETE_REALM_MOTD_SQL, ['eu-1', 42]);
    expect(oneLine(DELETE_REALM_MOTD_SQL)).toBe(
      'WITH change AS ( INSERT INTO realm_motd_changes (realm, message, changed_by) ' +
        'VALUES ($1, NULL, $2) ) DELETE FROM realm_motd WHERE realm = $1',
    );
  });

  it('reads the pool only when a query runs, never at construction', () => {
    const getPool = vi.fn(() => fakePool().pool);
    realmMotdStore(getPool, 'eu-1');
    expect(getPool).not.toHaveBeenCalled();
  });
});
