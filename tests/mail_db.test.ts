// The Ravenpost's partitioned persistence (server/db.ts, #3561): the
// per-recipient key builder, the incremental batched-upsert write
// (saveMailPartitions), and the union read that reconstructs a full book from
// those rows (loadMailState). Mirrors market_db.test.ts's mocked-pool idiom;
// server/mail_partition_backfill.test.ts owns the boot-time migration itself.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  const clientQuery = vi.fn();
  const release = vi.fn();
  return {
    query: vi.fn(),
    clientQuery,
    release,
    connect: vi.fn(async () => ({ query: clientQuery, release })),
  };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  }),
}));

import {
  closeMailPartitionWriteGateForTests,
  loadMailState,
  mailRecipientKey,
  mailStateKey,
  openMailPartitionWriteGate,
  saveMailPartitions,
} from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.clientQuery.mockReset();
  dbMock.release.mockClear();
  dbMock.connect.mockClear();
  // Every test starts from the boot default: the mail partition write gate is
  // CLOSED until ensureSchema's backfill opens it. Tests that need to write
  // open it explicitly.
  closeMailPartitionWriteGateForTests();
});

describe('mailRecipientKey', () => {
  it('keys on realm and recipient, URI-encoding the recipient so a colon cannot forge a different row', () => {
    expect(mailRecipientKey(REALM, 'char-1')).toBe(`mail:${REALM}:r:char-1`);
    expect(mailRecipientKey('Ironforge', 'char-1')).not.toBe(
      mailRecipientKey('Stormhaven', 'char-1'),
    );
    // A recipientKey containing this format's own delimiter must not let a
    // caller pass a colon-bearing key and land on another recipient's row.
    expect(mailRecipientKey(REALM, 'weird:name')).toBe(`mail:${REALM}:r:weird%3Aname`);
  });

  it('never shares a key with the legacy whole-book blob', () => {
    expect(mailRecipientKey(REALM, 'anything')).not.toBe(mailStateKey(REALM));
  });
});

describe('loadMailState (pure read: union of partition rows, backfill owns migration)', () => {
  it('returns the union of every partition row for this realm, with one ranged read', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        { data: { mail: [{ id: 1, recipientKey: 'a' }] } },
        {
          data: {
            mail: [
              { id: 2, recipientKey: 'b' },
              { id: 3, recipientKey: 'b' },
            ],
          },
        },
      ],
    });

    const loaded = await loadMailState();

    expect(loaded).toEqual({
      mail: [
        { id: 1, recipientKey: 'a' },
        { id: 2, recipientKey: 'b' },
        { id: 3, recipientKey: 'b' },
      ],
      nextMailId: 1,
    });
    // Exactly one ranged read, bounded to this realm's partitioned prefix: no
    // marker probe, no legacy read, no write-back.
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(dbMock.query.mock.calls[0][1]).toEqual([`mail:${REALM}:r:`, `mail:${REALM}:r;`]);
    // Pins the literal COLLATE "C" qualifier (the same pattern as
    // market_backfill.test.ts's WORLD_STATE_UPSERT_SQL pin): a linguistic
    // Postgres collation (glibc en_US.utf8, ICU, the non-Alpine/non-C-locale
    // default) sorts punctuation with no primary weight, so this range would
    // otherwise silently match nothing and the realm's ENTIRE mail book would
    // read back empty on boot. Both range bounds AND the ORDER BY must force
    // byte-order comparison, or a plan-dependent collation mismatch between
    // them can reopen the same bug on just one arm.
    const sql = dbMock.query.mock.calls[0][0] as string;
    expect(sql).toContain('(key COLLATE "C") >= $1');
    expect(sql).toContain('(key COLLATE "C") < $2');
    expect(sql).toContain('ORDER BY key COLLATE "C"');
  });

  it('returns null when the backfill marker exists and no partition row does (a genuinely empty realm)', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] }) // ranged partition read -> none
      .mockResolvedValueOnce({ rows: [{ data: { legacyRowFound: false } }] }); // marker present

    const loaded = await loadMailState();

    expect(loaded).toBeNull();
    expect(dbMock.query).toHaveBeenCalledTimes(2);
  });

  it('falls back to the retained legacy blob only when the marker is ALSO absent (pre-migration defensive net)', async () => {
    const legacy = { mail: [{ id: 9, recipientKey: 'z' }], nextMailId: 10 };
    dbMock.query
      .mockResolvedValueOnce({ rows: [] }) // ranged partition read -> none
      .mockResolvedValueOnce({ rows: [] }) // marker read -> absent (never backfilled)
      .mockResolvedValueOnce({ rows: [{ data: legacy }] }); // legacy mail:<realm> row

    const loaded = await loadMailState();

    expect(loaded).toEqual(legacy);
    expect(dbMock.query).toHaveBeenCalledTimes(3);
    expect(dbMock.query.mock.calls[2][1]).toEqual([mailStateKey(REALM)]);
  });

  it('ignores a row with a malformed (non-array) mail field rather than throwing', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ data: { mail: [{ id: 1, recipientKey: 'a' }] } }, { data: { notMail: true } }],
    });

    const loaded = await loadMailState();
    expect(loaded?.mail).toEqual([{ id: 1, recipientKey: 'a' }]);
  });
});

describe('saveMailPartitions (the incremental autosave write, #3561)', () => {
  it('an empty partitions array issues no SQL at all: a quiet interval writes nothing', async () => {
    openMailPartitionWriteGate();
    await saveMailPartitions([]);
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(dbMock.connect).not.toHaveBeenCalled();
  });

  it('writes every non-empty dirty recipient in ONE transaction with one batched multi-row UPSERT', async () => {
    openMailPartitionWriteGate();
    dbMock.clientQuery.mockResolvedValue({ rows: [] });

    await saveMailPartitions([
      { recipientKey: 'alice', letters: [{ id: 1, recipientKey: 'alice' }] as never },
      { recipientKey: 'carol', letters: [{ id: 2, recipientKey: 'carol' }] as never },
    ]);

    expect(dbMock.connect).toHaveBeenCalledTimes(1);
    expect(dbMock.query).not.toHaveBeenCalled();
    const sqls = dbMock.clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(sqls.filter((s) => /^BEGIN$|^COMMIT$|^ROLLBACK$/.test(s))).toEqual(['BEGIN', 'COMMIT']);
    const [sql, params] = dbMock.clientQuery.mock.calls[1];
    expect(String(sql)).toMatch(/UNNEST/i);
    expect(String(sql)).toMatch(/ON CONFLICT \(key\) DO UPDATE/i);
    const [keys, datas] = params as [string[], string[]];
    expect(keys).toEqual([`mail:${REALM}:r:alice`, `mail:${REALM}:r:carol`]);
    expect(JSON.parse(datas[0])).toEqual({ mail: [{ id: 1, recipientKey: 'alice' }] });
    expect(JSON.parse(datas[1])).toEqual({ mail: [{ id: 2, recipientKey: 'carol' }] });
    expect(dbMock.release).toHaveBeenCalledTimes(1);
  });

  it('an emptied-out mailbox is DELETEd, never upserted as {"mail":[]} (retention, #3561)', async () => {
    openMailPartitionWriteGate();
    dbMock.clientQuery.mockResolvedValue({ rows: [] });

    await saveMailPartitions([{ recipientKey: 'bob', letters: [] as never }]);

    expect(dbMock.query).not.toHaveBeenCalled();
    const sqls = dbMock.clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    const [sql, params] = dbMock.clientQuery.mock.calls[1];
    expect(String(sql)).toMatch(/DELETE FROM world_state WHERE key = ANY/i);
    expect(params).toEqual([[`mail:${REALM}:r:bob`]]);
  });

  it('splits a mixed batch into one UPSERT and one DELETE inside the same standalone transaction', async () => {
    openMailPartitionWriteGate();
    dbMock.clientQuery.mockResolvedValue({ rows: [] });

    await saveMailPartitions([
      { recipientKey: 'alice', letters: [{ id: 1, recipientKey: 'alice' }] as never },
      { recipientKey: 'bob', letters: [] as never },
    ]);

    const sqls = dbMock.clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(sqls.filter((s) => /^BEGIN$|^COMMIT$|^ROLLBACK$/.test(s))).toEqual(['BEGIN', 'COMMIT']);
    const upsertCall = dbMock.clientQuery.mock.calls.find((c) => /UNNEST/i.test(String(c[0])));
    const deleteCall = dbMock.clientQuery.mock.calls.find((c) =>
      /DELETE FROM world_state/i.test(String(c[0])),
    );
    if (!upsertCall || !deleteCall) throw new Error('missing expected query');
    const [upsertKeys] = upsertCall[1] as [string[], string[]];
    expect(upsertKeys).toEqual([`mail:${REALM}:r:alice`]);
    expect(deleteCall[1]).toEqual([[`mail:${REALM}:r:bob`]]);
  });

  it('de-dupes a repeated recipientKey by last-write-wins, so no key ever reaches the SQL twice', async () => {
    openMailPartitionWriteGate();
    dbMock.clientQuery.mockResolvedValue({ rows: [] });

    await saveMailPartitions([
      { recipientKey: 'alice', letters: [{ id: 1, recipientKey: 'alice' }] as never },
      {
        recipientKey: 'alice',
        letters: [
          { id: 1, recipientKey: 'alice' },
          { id: 2, recipientKey: 'alice' },
        ] as never,
      },
    ]);

    const upsertCall = dbMock.clientQuery.mock.calls.find((c) => /UNNEST/i.test(String(c[0])));
    if (!upsertCall) throw new Error('missing expected upsert');
    const [, params] = upsertCall;
    const [keys, datas] = params as [string[], string[]];
    expect(keys).toEqual([`mail:${REALM}:r:alice`]); // one key, not two
    expect(JSON.parse(datas[0]).mail).toHaveLength(2); // the LATER (fuller) entry won
  });

  it('rolls back the standalone transaction if the second partition statement fails', async () => {
    openMailPartitionWriteGate();
    dbMock.clientQuery.mockImplementation((sql: string) => {
      if (/DELETE FROM world_state/i.test(sql)) throw new Error('delete failed');
      return Promise.resolve({ rows: [] });
    });

    await expect(
      saveMailPartitions([
        { recipientKey: 'alice', letters: [{ id: 1, recipientKey: 'alice' }] as never },
        { recipientKey: 'bob', letters: [] as never },
      ]),
    ).rejects.toThrow('delete failed');

    const sqls = dbMock.clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(dbMock.release).toHaveBeenCalledTimes(1);
  });

  it('blocks the write when the mail partition gate is closed (ensureSchema has not confirmed the marker yet)', async () => {
    // Gate starts closed (beforeEach); do NOT open it.
    await expect(
      saveMailPartitions([{ recipientKey: 'alice', letters: [] as never }]),
    ).rejects.toThrow(/mail partition write blocked/);
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(dbMock.connect).not.toHaveBeenCalled();
  });
});
