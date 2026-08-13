// The class power tuner's SQL boundary: one document per realm plus its
// append-only audit trail, saved atomically, with an unchanged save recording
// nothing. Paired module: server/class_tuning_db.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: {
    connect: mocks.connect,
    query: mocks.poolQuery,
  },
}));

vi.mock('../server/realm', () => ({
  REALM: 'test-realm',
  REALM_DIRECTORY: [{ name: 'test-realm', url: '', type: 'Normal' }],
}));

import {
  CLASS_TUNING_SCHEMA,
  listClassTuningHistory,
  loadClassTuning,
  saveClassTuningChange,
} from '../server/class_tuning_db';

function fakeClient(
  handler: (sql: string, params: unknown[] | undefined) => Promise<{ rows: unknown[] }>,
) {
  const query = vi.fn(handler);
  const release = vi.fn();
  mocks.connect.mockResolvedValue({ query, release });
  return { query, release };
}

const DOC = { version: 1, abilities: { thorns: { damage_reflect: 1.5 } } };

beforeEach(() => {
  mocks.connect.mockReset();
  mocks.poolQuery.mockReset();
});

describe('CLASS_TUNING_SCHEMA', () => {
  it('is additive and idempotent, so re-applying it at every boot is safe', () => {
    expect(CLASS_TUNING_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS class_tuning_config');
    expect(CLASS_TUNING_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS class_tuning_changes');
    expect(CLASS_TUNING_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS class_tuning_changes_realm');
    expect(CLASS_TUNING_SCHEMA).not.toMatch(/\bDROP\b|\bALTER TABLE [a-z_]+ DROP\b/);
  });

  it('never orphans a change row when the operator account goes away', () => {
    expect(CLASS_TUNING_SCHEMA).toContain(
      'admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL',
    );
  });
});

describe('loadClassTuning', () => {
  it('returns an empty document for a realm that has never been tuned', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    await expect(loadClassTuning()).resolves.toEqual({
      data: {},
      updatedAt: null,
      updatedBy: null,
    });
    expect(mocks.poolQuery.mock.calls[0][1]).toEqual(['test-realm']);
  });

  it('returns the stored document and its stamp', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [{ data: DOC, updated_at: '2026-08-01T00:00:00.000Z', updated_by: 7 }],
    });
    await expect(loadClassTuning()).resolves.toEqual({
      data: DOC,
      updatedAt: '2026-08-01T00:00:00.000Z',
      updatedBy: 7,
    });
  });
});

describe('saveClassTuningChange', () => {
  it('replaces the document and appends its audit row in one transaction', async () => {
    const { query, release } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return {
          rows: [{ data: { version: 1, abilities: {} }, updated_at: null, unchanged: false }],
        };
      }
      if (sql.includes('RETURNING updated_at')) {
        return { rows: [{ updated_at: '2026-08-01T00:00:01.000Z' }] };
      }
      return { rows: [] };
    });

    await expect(saveClassTuningChange(DOC, 7, 'nerf druid reflect')).resolves.toEqual({
      changed: true,
      updatedAt: '2026-08-01T00:00:01.000Z',
    });

    // the second SELECT is the advisory realm lock (its own case below)
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'INSERT',
      'INSERT',
      'COMMIT',
    ]);
    const audit = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO class_tuning_changes'),
    );
    expect(audit?.[1]).toEqual([
      'test-realm',
      7,
      JSON.stringify({ version: 1, abilities: {} }),
      JSON.stringify(DOC),
      'nerf druid reflect',
    ]);
    expect(release).toHaveBeenCalled();
  });

  it('takes the row lock before reading, so two operators cannot interleave a save', async () => {
    const { query } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        expect(sql).toContain('FOR UPDATE');
        return { rows: [{ data: {}, updated_at: null, unchanged: false }] };
      }
      if (sql.includes('RETURNING updated_at')) {
        return { rows: [{ updated_at: '2026-08-01T00:00:01.000Z' }] };
      }
      return { rows: [] };
    });
    await saveClassTuningChange(DOC, 7, '');
    expect(query).toHaveBeenCalled();
  });

  it('serializes even the FIRST save behind a realm advisory lock', async () => {
    // FOR UPDATE matches zero rows before the realm's row exists, so without
    // this lock two concurrent first saves would both read "no row" and append
    // two `{} -> X` audit rows.
    const { query } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) return { rows: [] };
      if (sql.includes('RETURNING updated_at')) {
        return { rows: [{ updated_at: '2026-08-01T00:00:01.000Z' }] };
      }
      return { rows: [] };
    });
    await saveClassTuningChange(DOC, 7, '');
    const calls = query.mock.calls.map(([sql]) => String(sql));
    const lockIndex = calls.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
    const readIndex = calls.findIndex((sql) => sql.includes('SELECT data'));
    expect(lockIndex).toBeGreaterThan(calls.indexOf('BEGIN'));
    expect(lockIndex).toBeLessThan(readIndex);
    // keyed on the table plus the realm, so realms never serialize each other
    expect(query.mock.calls[lockIndex][1]).toEqual(['class_tuning_config', 'test-realm']);
  });

  it('records nothing when the document is unchanged', async () => {
    const { query } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return {
          rows: [{ data: DOC, updated_at: '2026-08-01T00:00:00.000Z', unchanged: true }],
        };
      }
      return { rows: [] };
    });

    await expect(saveClassTuningChange(DOC, 7, 'no-op')).resolves.toEqual({
      changed: false,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'COMMIT',
    ]);
  });

  it('does not create a first row for an empty document', async () => {
    // Writing one would claim the realm had been tuned when nothing was moved.
    const { query } = fakeClient(async () => ({ rows: [] }));
    await expect(saveClassTuningChange({ version: 1, abilities: {} }, 7, '')).resolves.toEqual({
      changed: false,
      updatedAt: null,
    });
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'COMMIT',
    ]);
  });

  it('treats a document with both scopes empty as empty, however it is spelled', async () => {
    const { query } = fakeClient(async () => ({ rows: [] }));
    await expect(
      saveClassTuningChange({ version: 1, abilities: {}, weapons: {} }, 7, ''),
    ).resolves.toEqual({ changed: false, updatedAt: null });
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'COMMIT',
    ]);
  });

  // The emptiness question is asked of the WHOLE document. An abilities-only
  // check would drop this save on a realm that has never been tuned (the state
  // the Weapons window ships into) while the dashboard still reported it saved.
  it('writes a first row for a WEAPONS-only document', async () => {
    const weaponsOnly = {
      version: 1,
      abilities: {},
      weapons: { worn_sword: { swing_damage: 0.8 } },
    };
    const { query } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) return { rows: [] };
      if (sql.includes('RETURNING updated_at')) {
        return { rows: [{ updated_at: '2026-08-01T00:00:01.000Z' }] };
      }
      return { rows: [] };
    });

    await expect(saveClassTuningChange(weaponsOnly, 7, 'slow the starter sword')).resolves.toEqual({
      changed: true,
      updatedAt: '2026-08-01T00:00:01.000Z',
    });
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'INSERT',
      'INSERT',
      'COMMIT',
    ]);
    const audit = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO class_tuning_changes'),
    );
    expect(audit?.[1]).toEqual([
      'test-realm',
      7,
      JSON.stringify({}),
      JSON.stringify(weaponsOnly),
      'slow the starter sword',
    ]);
  });

  it('rolls back and rethrows when the audit insert fails', async () => {
    const { query, release } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return { rows: [{ data: {}, updated_at: null, unchanged: false }] };
      }
      if (sql.includes('RETURNING updated_at')) {
        return { rows: [{ updated_at: '2026-08-01T00:00:01.000Z' }] };
      }
      if (sql.includes('INSERT INTO class_tuning_changes')) throw new Error('audit down');
      return { rows: [] };
    });
    await expect(saveClassTuningChange(DOC, 7, '')).rejects.toThrow('audit down');
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toContain(
      'ROLLBACK',
    );
    expect(release).toHaveBeenCalled();
  });
});

describe('listClassTuningHistory', () => {
  it('reads the realm rows newest first and bounds the limit', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    await listClassTuningHistory(5000);
    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(String(sql)).toContain('ORDER BY h.created_at DESC, h.id DESC');
    expect(params).toEqual(['test-realm', 100]);

    mocks.poolQuery.mockClear();
    await listClassTuningHistory(Number.NaN);
    expect(mocks.poolQuery.mock.calls[0][1]).toEqual(['test-realm', 50]);
  });

  it('pages past the newest rows on a keyset, never an OFFSET walk', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    await listClassTuningHistory(50, 1234);
    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(String(sql)).toContain('AND h.id < $3');
    expect(String(sql)).not.toContain('OFFSET');
    expect(params).toEqual(['test-realm', 50, 1234]);
  });

  it('ignores a junk beforeId rather than emptying the page', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    for (const junk of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      mocks.poolQuery.mockClear();
      await listClassTuningHistory(50, junk);
      const [sql, params] = mocks.poolQuery.mock.calls[0];
      expect(String(sql), String(junk)).not.toContain('h.id <');
      expect(params, String(junk)).toEqual(['test-realm', 50]);
    }
  });

  it('normalizes every row, including a deleted operator', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        {
          id: '3',
          before_data: null,
          after_data: DOC,
          note: null,
          created_at: '2026-08-01T00:00:00.000Z',
          admin_account_id: null,
          admin_username: null,
        },
      ],
    });
    await expect(listClassTuningHistory()).resolves.toEqual([
      {
        id: 3,
        beforeData: {},
        afterData: DOC,
        note: '',
        createdAt: '2026-08-01T00:00:00.000Z',
        adminAccountId: null,
        adminUsername: null,
      },
    ]);
  });
});
