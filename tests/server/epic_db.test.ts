// The epic_links SQL boundary's one transaction: displaceEpicLink, the
// reclaim-by-proof write. The route suite mocks this module whole, so the
// load-bearing SQL lives untested without this file: the FOR UPDATE
// serialization, the `account_id <> $2` guard that can never delete the
// caller's own row, the displacedAccountId computation, and the 23505
// ROLLBACK re-classification (account_linked vs epic_taken). Twin of
// tests/server/steam_db.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// server/db.ts builds a pg Pool and requires DATABASE_URL at import time; stub
// both so the module loads and every query goes through a spy.
const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import { displaceEpicLink } from '../../server/epic/epic_db';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
});

function clientStub() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as never);
  const release = vi.fn();
  return { query, release };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

const EPIC_ID = 'epic-account-test-1';

describe('displaceEpicLink', () => {
  it('displaces another account: FOR UPDATE lock, guarded DELETE, INSERT, COMMIT, old owner reported', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockResolvedValueOnce({ rows: [{ account_id: 99 }], rowCount: 1 } as never); // SELECT

    await expect(displaceEpicLink(7, EPIC_ID)).resolves.toEqual({
      result: 'ok',
      displacedAccountId: 99,
    });

    const calls = client.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    // The lock must ride THIS table: FOR UPDATE alone would pass a rewrite
    // that locks the wrong one.
    expect(calls[1][0]).toMatch(/FROM epic_links[\s\S]*FOR UPDATE/);
    expect(calls[1][1]).toEqual([EPIC_ID]);
    // The guarded DELETE can only remove a DIFFERENT account's row.
    expect(calls[2][0]).toMatch(/DELETE FROM epic_links/);
    expect(calls[2][0]).toMatch(/account_id <> \$2/);
    expect(calls[2][1]).toEqual([EPIC_ID, 7]);
    expect(calls[3][0]).toMatch(/INSERT INTO epic_links/);
    expect(calls[3][1]).toEqual([7, EPIC_ID]);
    expect(calls[4][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('inserts without a DELETE when the epic id is unclaimed (nothing displaced)', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    // BEGIN and SELECT both resolve to the empty default.
    await expect(displaceEpicLink(7, EPIC_ID)).resolves.toEqual({
      result: 'ok',
      displacedAccountId: null,
    });
    const texts = client.query.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => /DELETE/.test(t))).toBe(false);
    expect(texts).toEqual([
      'BEGIN',
      expect.stringMatching(/FOR UPDATE/),
      expect.stringMatching(/INSERT INTO epic_links/),
      'COMMIT',
    ]);
  });

  it("never deletes the caller's own row: a self-owned id skips the DELETE and re-classifies the 23505 as account_linked", async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    dbMock.query.mockImplementation(() => {
      throw new Error('pool.query must not be called during displaceEpicLink');
    });
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockResolvedValueOnce({ rows: [{ account_id: 7 }], rowCount: 1 } as never) // SELECT FOR UPDATE: own row
      .mockRejectedValueOnce(uniqueViolation()) // INSERT trips the PK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // ROLLBACK
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 } as never); // classification SELECT 1

    await expect(displaceEpicLink(7, EPIC_ID)).resolves.toEqual({
      result: 'account_linked',
      displacedAccountId: null,
    });
    const texts = client.query.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => /DELETE/.test(t))).toBe(false);
    expect(dbMock.query).not.toHaveBeenCalled();
    const rollbackIdx = texts.indexOf('ROLLBACK');
    const classifyIdx = texts.findIndex((t) =>
      /SELECT 1 FROM epic_links WHERE account_id = \$1/.test(t),
    );
    expect(rollbackIdx).toBeGreaterThan(-1);
    expect(classifyIdx).toBeGreaterThan(rollbackIdx);
    expect(client.query.mock.calls[classifyIdx][1]).toEqual([7]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('re-classifies a lost concurrent race as epic_taken when the caller ends up unlinked', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    dbMock.query.mockImplementation(() => {
      throw new Error('pool.query must not be called during displaceEpicLink');
    });
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // SELECT FOR UPDATE: unclaimed
      .mockRejectedValueOnce(uniqueViolation()) // a racer's INSERT landed first
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // ROLLBACK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // classification SELECT 1: caller unlinked

    await expect(displaceEpicLink(7, EPIC_ID)).resolves.toEqual({
      result: 'epic_taken',
      displacedAccountId: null,
    });
    const texts = client.query.mock.calls.map((c) => String(c[0]));
    expect(dbMock.query).not.toHaveBeenCalled();
    const rollbackIdx = texts.indexOf('ROLLBACK');
    const classifyIdx = texts.findIndex((t) =>
      /SELECT 1 FROM epic_links WHERE account_id = \$1/.test(t),
    );
    expect(rollbackIdx).toBeGreaterThan(-1);
    expect(classifyIdx).toBeGreaterThan(rollbackIdx);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('classification never rides the pool: pool.query stays idle while a client checkout is outstanding', async () => {
    let outstanding = 0;
    const client = clientStub();
    client.release.mockImplementation(() => {
      outstanding--;
    });
    dbMock.connect.mockImplementation(async () => {
      outstanding++;
      return client as never;
    });
    dbMock.query.mockImplementation(() => {
      if (outstanding > 0) {
        throw new Error('pool.query rode the pool while a client was checked out');
      }
      return { rows: [], rowCount: 0 } as never;
    });
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockResolvedValueOnce({ rows: [{ account_id: 7 }], rowCount: 1 } as never) // SELECT FOR UPDATE: own row
      .mockRejectedValueOnce(uniqueViolation()) // INSERT trips the PK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // ROLLBACK
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 } as never); // classification SELECT 1

    await expect(displaceEpicLink(7, EPIC_ID)).resolves.toEqual({
      result: 'account_linked',
      displacedAccountId: null,
    });
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-unique failure after ROLLBACK and always releases the client', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockRejectedValueOnce(new Error('connection reset')); // SELECT dies

    await expect(displaceEpicLink(7, EPIC_ID)).rejects.toThrow('connection reset');
    const texts = client.query.mock.calls.map((c) => String(c[0]));
    expect(texts).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
