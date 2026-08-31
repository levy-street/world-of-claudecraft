import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the module loads and every query goes through a spy we can assert against.
const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import {
  closeMailPartitionWriteGateForTests,
  closeMarketWriteGateForTests,
  openMailPartitionWriteGate,
  openMarketWriteGate,
  saveCharacterAndMarketState,
} from '../server/db';
import { REALM } from '../server/realm';
import type { CharacterState, MailSave, MarketSave } from '../src/sim/sim';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
  // The escrow flush writes the realm-market row and, when it carries any
  // dirty mail partition, the realm-scoped mail rows too; both are gated on
  // their own boot backfill. Open both by default so the escrow-transaction
  // pins run; the closed-gate cases below re-close one explicitly.
  openMarketWriteGate();
  openMailPartitionWriteGate();
});

function clientStub() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as any);
  const release = vi.fn();
  return { query, release, on: vi.fn(), removeListener: vi.fn() };
}

const STATE = {
  level: 7,
  questLog: [],
  questsDone: [],
  inventory: [],
} as unknown as CharacterState;
const MARKET = { listings: [], collections: {} } as unknown as MarketSave;
// A single dirtied recipient with one letter: enough to exercise the real
// mail-write branch (an empty partitions array is covered by its own test
// below, since that is now a materially different code path, not a smaller
// version of this one).
const MAIL_LETTER: MailSave['mail'][number] = {
  id: 1,
  recipientKey: 'char-99',
  recipientName: 'Testchar',
  senderName: 'System',
  kind: 'system',
  subject: 'Welcome',
  body: '',
  copper: 0,
  items: [],
  deliverIn: 0,
  secondsLeft: -1,
  read: false,
};
const MAIL_PARTITIONS: { recipientKey: string; letters: MailSave['mail'] }[] = [
  { recipientKey: 'char-99', letters: [MAIL_LETTER] },
];

describe('saveCharacterAndMarketState', () => {
  it('writes the character row, the market row, and the dirty mail row in ONE transaction (atomic escrow)', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as any);

    await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL_PARTITIONS);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    // Single transaction: BEGIN first, COMMIT last, no ROLLBACK.
    expect(sqls[0]).toMatch(/^BEGIN/);
    expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
    expect(sqls.filter((s) => /^BEGIN$/.test(s))).toHaveLength(1);
    expect(sqls.filter((s) => /^COMMIT$/.test(s))).toHaveLength(1);
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(false);
    // All three rows are written on the same client (so they commit or fail together).
    expect(sqls.some((s) => /UPDATE characters/i.test(s))).toBe(true);
    expect(sqls.filter((s) => /world_state/i.test(s))).toHaveLength(2); // market + mail partitions
    // Nothing leaks onto the bare pool: atomicity would be lost otherwise.
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('an empty mail partitions array issues no mail SQL at all (a session that never touched mail)', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as any);

    await saveCharacterAndMarketState(42, 7, STATE, MARKET, []);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    const worldCalls = sqls.filter((s) => /world_state/i.test(s));
    // Only the market row: no mail write when nothing was dirtied.
    expect(worldCalls).toHaveLength(1);
    expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
  });

  it('targets the realm-scoped market key and the partitioned per-recipient mail keys', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as any);

    await saveCharacterAndMarketState(99, 12, STATE, MARKET, MAIL_PARTITIONS);

    const charCall = client.query.mock.calls.find((c) => /UPDATE characters/i.test(String(c[0])));
    expect(charCall?.[1]).toEqual(expect.arrayContaining([99, 12]));
    const worldCalls = client.query.mock.calls.filter((c) => /world_state/i.test(String(c[0])));
    const marketCall = worldCalls.find((c) => !/UNNEST/i.test(String(c[0])));
    const mailCall = worldCalls.find((c) => /UNNEST/i.test(String(c[0])));
    // The leave-flush market write must use the SAME realm-scoped key
    // load/saveMarketState uses, never the bare shared 'market' row, or the
    // escrow lands in a key nothing reads back on next boot.
    expect(marketCall?.[1][0]).toBe(`market:${REALM}`);
    // The mail write is the batched multi-row UPSERT (server/db.ts
    // saveMailPartitions' own shape): one partitioned key per dirty recipient,
    // never the retained legacy mail:<realm> blob key.
    expect(mailCall?.[1][0]).toEqual([`mail:${REALM}:r:char-99`]);
  });

  it('rolls back and rethrows if the character write fails, leaving no half-commit', async () => {
    const client = clientStub();
    client.query.mockImplementation((sql: string) => {
      if (/UPDATE characters/i.test(sql)) {
        throw Object.assign(new Error('boom'), { code: 'XX000' });
      }
      return Promise.resolve({ rows: [], rowCount: 0 } as any);
    });
    dbMock.connect.mockResolvedValueOnce(client as any);

    await expect(saveCharacterAndMarketState(1, 1, STATE, MARKET, MAIL_PARTITIONS)).rejects.toThrow(
      'boom',
    );

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back and rethrows if the market write fails, undoing the character write', async () => {
    const client = clientStub();
    client.query.mockImplementation((sql: string) => {
      if (/world_state/i.test(sql)) {
        throw Object.assign(new Error('market boom'), { code: 'XX000' });
      }
      return Promise.resolve({ rows: [], rowCount: 0 } as any);
    });
    dbMock.connect.mockResolvedValueOnce(client as any);

    await expect(saveCharacterAndMarketState(1, 1, STATE, MARKET, MAIL_PARTITIONS)).rejects.toThrow(
      'market boom',
    );

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    // The character UPDATE already ran on this client; ROLLBACK must undo it.
    expect(sqls.some((s) => /UPDATE characters/i.test(s))).toBe(true);
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('blocks the escrow flush when the market write gate is closed, before any SQL', async () => {
    closeMarketWriteGateForTests();

    // The gate assertion runs before pool.connect, so no client is checked out
    // and no BEGIN is issued: the flush cannot race ahead of the boot backfill.
    await expect(saveCharacterAndMarketState(5, 3, STATE, MARKET, MAIL_PARTITIONS)).rejects.toThrow(
      /market write blocked/,
    );
    expect(dbMock.connect).not.toHaveBeenCalled();
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('rolls back when the mail partition write gate is closed but the market gate is open', async () => {
    closeMailPartitionWriteGateForTests();
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as any);

    // The mail gate is checked INSIDE the transaction (only once there is a
    // partition to write), so this rolls back rather than failing before
    // pool.connect: the market row's own write already landed on this client
    // and must be undone with it, never left half-committed.
    await expect(saveCharacterAndMarketState(5, 3, STATE, MARKET, MAIL_PARTITIONS)).rejects.toThrow(
      /mail partition write blocked/,
    );
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
  });
});
