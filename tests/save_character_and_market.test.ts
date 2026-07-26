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
  closeMarketWriteGateForTests,
  openMarketWriteGate,
  PROCESS_LEASE_HOLDER,
  saveCharacterAndMarketState,
} from '../server/db';
import { REALM } from '../server/realm';
import type { CharacterState, MailSave, MarketSave } from '../src/sim/sim';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
  // The escrow flush writes the realm-market row, so it is gated on the boot
  // backfill. Open the gate by default so the escrow-transaction pins run; the
  // closed-gate case below re-closes it explicitly.
  openMarketWriteGate();
});

function clientStub() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as any);
  const release = vi.fn();
  return { query, release };
}

function heldLeaseRows(values: unknown[] | undefined, nonces: ReadonlyMap<number, string>) {
  const ids = (values?.[0] ?? []) as number[];
  const rows = ids.flatMap((characterId) => {
    const nonce = nonces.get(characterId);
    return nonce === undefined
      ? []
      : [{ character_id: characterId, holder: PROCESS_LEASE_HOLDER, nonce }];
  });
  return { rows, rowCount: rows.length } as any;
}

const STATE = {
  level: 7,
  questLog: [],
  questsDone: [],
  inventory: [],
} as unknown as CharacterState;
const MARKET = { listings: [], collections: {} } as unknown as MarketSave;
const MAIL = { mail: [], nextMailId: 1 } as unknown as MailSave;

describe('saveCharacterAndMarketState', () => {
  it('lease-fences both trade participants before either realm blob commits', async () => {
    const client = clientStub();
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (/FROM character_leases[\s\S]*FOR UPDATE/i.test(sql)) {
        return heldLeaseRows(
          values,
          new Map([
            [42, 'nonce-a'],
            [84, 'nonce-b'],
          ]),
        );
      }
      return /UPDATE characters/i.test(sql)
        ? ({ rows: [], rowCount: 1 } as any)
        : ({ rows: [], rowCount: 0 } as any);
    });
    dbMock.connect.mockResolvedValueOnce(client as any);

    const ok = await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL, 'nonce-a', {
      characterId: 84,
      level: 9,
      state: { ...STATE, level: 9 },
      leaseNonce: 'nonce-b',
    });

    expect(ok).toBe(true);
    const calls = client.query.mock.calls;
    const lockCall = calls.find((call) => /FOR UPDATE/i.test(String(call[0])));
    expect(lockCall?.[1]).toEqual([[42, 84]]);
    const characterCalls = calls.filter((call) => /UPDATE characters/i.test(String(call[0])));
    expect(calls.indexOf(lockCall!)).toBeLessThan(calls.indexOf(characterCalls[0]!));
    expect(characterCalls).toHaveLength(2);
    expect(characterCalls[0]?.[1]).toEqual([
      42,
      7,
      expect.any(String),
      expect.any(String),
      'nonce-a',
    ]);
    expect(characterCalls[1]?.[1]).toEqual([
      84,
      9,
      expect.any(String),
      expect.any(String),
      'nonce-b',
    ]);
    const secondCharacter = calls.indexOf(characterCalls[1]);
    const firstRealm = calls.findIndex((call) => /world_state/i.test(String(call[0])));
    expect(firstRealm).toBeGreaterThan(secondCharacter);
    expect(String(calls.at(-1)?.[0])).toMatch(/^COMMIT/);
  });

  it('persists a multi-recipient reward batch before either realm blob commits', async () => {
    const client = clientStub();
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (/FROM character_leases[\s\S]*FOR UPDATE/i.test(sql)) {
        return heldLeaseRows(
          values,
          new Map([
            [42, 'nonce-a'],
            [84, 'nonce-b'],
            [126, 'nonce-c'],
          ]),
        );
      }
      return /UPDATE characters/i.test(sql)
        ? ({ rows: [], rowCount: 1 } as any)
        : ({ rows: [], rowCount: 0 } as any);
    });
    dbMock.connect.mockResolvedValueOnce(client as any);

    const ok = await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL, 'nonce-a', [
      {
        characterId: 84,
        level: 8,
        state: { ...STATE, level: 8 },
        leaseNonce: 'nonce-b',
      },
      {
        characterId: 126,
        level: 9,
        state: { ...STATE, level: 9 },
        leaseNonce: 'nonce-c',
      },
    ]);

    expect(ok).toBe(true);
    const calls = client.query.mock.calls;
    const characterCalls = calls.filter((call) => /UPDATE characters/i.test(String(call[0])));
    expect(characterCalls.map((call) => call[1][0])).toEqual([42, 84, 126]);
    const lastCharacter = calls.indexOf(characterCalls.at(-1)!);
    const firstRealm = calls.findIndex((call) => /world_state/i.test(String(call[0])));
    expect(firstRealm).toBeGreaterThan(lastCharacter);
    expect(String(calls.at(-1)?.[0])).toMatch(/^COMMIT/);
  });

  it('rolls back both character writes when the peer lease fence rejects', async () => {
    const client = clientStub();
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (/FROM character_leases[\s\S]*FOR UPDATE/i.test(sql)) {
        return heldLeaseRows(
          values,
          new Map([
            [42, 'nonce-a'],
            [84, 'replacement-b'],
          ]),
        );
      }
      return /UPDATE characters/i.test(sql)
        ? ({ rows: [], rowCount: 1 } as any)
        : ({ rows: [], rowCount: 0 } as any);
    });
    dbMock.connect.mockResolvedValueOnce(client as any);

    const ok = await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL, 'nonce-a', {
      characterId: 84,
      level: 9,
      state: { ...STATE, level: 9 },
      leaseNonce: 'stale-b',
    });

    expect(ok).toBe(false);
    const sqls = client.query.mock.calls.map((call) => String(call[0]));
    expect(sqls.filter((sql) => /UPDATE characters/i.test(sql))).toHaveLength(0);
    expect(sqls.some((sql) => /world_state/i.test(sql))).toBe(false);
    expect(sqls.at(-1)).toMatch(/^ROLLBACK/);
    expect(sqls.some((sql) => /^COMMIT/.test(sql))).toBe(false);
  });

  it('writes the character row and the market row in ONE transaction (atomic escrow)', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as any);

    await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    // Single transaction: BEGIN first, COMMIT last, no ROLLBACK.
    expect(sqls[0]).toMatch(/^BEGIN/);
    expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(false);
    // Both rows are written on the same client (so they commit or fail together).
    expect(sqls.some((s) => /UPDATE characters/i.test(s))).toBe(true);
    expect(sqls.some((s) => /world_state/i.test(s))).toBe(true);
    // Nothing leaks onto the bare pool: atomicity would be lost otherwise.
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('targets the realm-scoped market world_state key and the right character id', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as any);

    await saveCharacterAndMarketState(99, 12, STATE, MARKET, MAIL);

    const charCall = client.query.mock.calls.find((c) => /UPDATE characters/i.test(String(c[0])));
    expect(charCall?.[1]).toEqual(expect.arrayContaining([99, 12]));
    const worldCalls = client.query.mock.calls.filter((c) => /world_state/i.test(String(c[0])));
    // The leave-flush market/mail writes must use the SAME realm-scoped keys
    // that load/saveMarketState + load/saveMailState use, never the bare shared
    // 'market' row, or the escrow lands in a key nothing reads back on next boot.
    expect(worldCalls.map((c) => c[1][0])).toEqual([`market:${REALM}`, `mail:${REALM}`]);
    for (const call of worldCalls) expect(call[1]).not.toContain('market');
  });

  it('writes only the requested realm domain and does not require the Market gate for mail', async () => {
    closeMarketWriteGateForTests();
    const mailClient = clientStub();
    dbMock.connect.mockResolvedValueOnce(mailClient as any);

    expect(await saveCharacterAndMarketState(42, 7, STATE, null, MAIL)).toBe(true);
    const mailWorldCalls = mailClient.query.mock.calls.filter((call) =>
      /world_state/i.test(String(call[0])),
    );
    expect(mailWorldCalls.map((call) => call[1][0])).toEqual([`mail:${REALM}`]);

    const characterOnlyClient = clientStub();
    dbMock.connect.mockResolvedValueOnce(characterOnlyClient as any);
    expect(await saveCharacterAndMarketState(42, 7, STATE, null, null)).toBe(true);
    expect(
      characterOnlyClient.query.mock.calls.some((call) => /world_state/i.test(String(call[0]))),
    ).toBe(false);
  });

  it('rolls back and rethrows if the character write fails, leaving no half-commit', async () => {
    const client = clientStub();
    client.query.mockImplementation((sql: string) => {
      if (/UPDATE characters/i.test(sql)) throw new Error('boom');
      return Promise.resolve({ rows: [], rowCount: 0 } as any);
    });
    dbMock.connect.mockResolvedValueOnce(client as any);

    await expect(saveCharacterAndMarketState(1, 1, STATE, MARKET, MAIL)).rejects.toThrow('boom');

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back and rethrows if the market write fails, undoing the character write', async () => {
    const client = clientStub();
    client.query.mockImplementation((sql: string) => {
      if (/world_state/i.test(sql)) throw new Error('market boom');
      return Promise.resolve({ rows: [], rowCount: 0 } as any);
    });
    dbMock.connect.mockResolvedValueOnce(client as any);

    await expect(saveCharacterAndMarketState(1, 1, STATE, MARKET, MAIL)).rejects.toThrow(
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
    await expect(saveCharacterAndMarketState(5, 3, STATE, MARKET, MAIL)).rejects.toThrow(
      /market write blocked/,
    );
    expect(dbMock.connect).not.toHaveBeenCalled();
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});
