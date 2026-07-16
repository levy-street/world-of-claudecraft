import { beforeEach, describe, expect, it, vi } from 'vitest';

// trade_db.ts imports `pool` (+ two constants) from db.ts, which builds a pg Pool
// and requires DATABASE_URL at import time. Stub both exactly like
// save_character_and_market.test.ts so the module loads and every query goes
// through a spy we can assert against (mirrors that sibling's harness).
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
  claimTradeSettlementForRecovery,
  type InsertTradeSettlementInput,
  insertSettlementAndSaveBoth,
  insertTradeLedger,
  loadOpenTradeSettlements,
  markTradeSettlement,
  saveTradePairAndLedger,
  TRADE_SCHEMA,
  type TradeLedgerRow,
  type TradePairSaveSide,
} from '../server/trade_db';
import type { CharacterState } from '../src/sim/sim';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
});

const STATE = {
  level: 7,
  questLog: [],
  questsDone: [],
  inventory: [],
} as unknown as CharacterState;

function side(characterId: number, leaseNonce?: string): TradePairSaveSide {
  return { characterId, level: 7, state: STATE, leaseNonce };
}

const LEDGER: TradeLedgerRow = {
  realm: 'r1',
  settlementId: null,
  charAId: 1,
  charBId: 2,
  accountAId: 10,
  accountBId: 20,
  charAName: 'A',
  charBName: 'B',
  itemsA: [{ itemId: 'wolf_fang', count: 1 }],
  copperA: 5,
  itemsB: [],
  copperB: 0,
  claudiumA: 0,
  claudiumB: 0,
  wocA: '0',
  wocB: '0',
};

const INSERT_INPUT: InsertTradeSettlementInput = {
  realm: 'r1',
  status: 'escrowed',
  charAId: 1,
  charBId: 2,
  accountAId: 10,
  accountBId: 20,
  charAName: 'A',
  charBName: 'B',
  escrowA: { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 30 },
  escrowB: { items: [], copper: 0 },
  claudiumA: 0,
  claudiumB: 0,
  wocA: '1.5',
  wocB: '0',
  wocARef: 'refA',
  wocBRef: null,
  wocAPayer: 'pk-a',
  wocARecipient: 'pk-b',
  wocBPayer: null,
  wocBRecipient: null,
};

// A checked-out transaction client. UPDATE characters returns a configurable
// rowCount (the lease fence: >0 hit, 0 miss); INSERT ... RETURNING returns an id.
function clientStub(opts: { missCharId?: number; insertId?: number } = {}) {
  const query = vi.fn((sql: string, params?: unknown[]) => {
    if (/UPDATE characters/i.test(sql)) {
      const charId = params?.[0];
      const rowCount = opts.missCharId !== undefined && charId === opts.missCharId ? 0 : 1;
      return Promise.resolve({ rows: [], rowCount });
    }
    if (/RETURNING id/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: opts.insertId ?? 123 }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  const release = vi.fn();
  return { query, release };
}

describe('saveTradePairAndLedger', () => {
  it('writes both character rows AND the ledger in ONE committed transaction', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as never);

    const ok = await saveTradePairAndLedger(side(1, 'na'), side(2, 'nb'), LEDGER);

    expect(ok).toBe(true);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toMatch(/^BEGIN/);
    expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(false);
    expect(sqls.filter((s) => /UPDATE characters/i.test(s))).toHaveLength(2);
    expect(sqls.some((s) => /INSERT INTO trade_ledger/i.test(s))).toBe(true);
    // atomicity: nothing leaks onto the bare pool
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back and returns false when the lease fence misses on side A', async () => {
    const client = clientStub({ missCharId: 1 });
    dbMock.connect.mockResolvedValueOnce(client as never);

    const ok = await saveTradePairAndLedger(side(1, 'na'), side(2, 'nb'), LEDGER);

    expect(ok).toBe(false);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
    // the ledger is never written when the swap did not durably land
    expect(sqls.some((s) => /INSERT INTO trade_ledger/i.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back and returns false when the lease fence misses on side B', async () => {
    const client = clientStub({ missCharId: 2 });
    dbMock.connect.mockResolvedValueOnce(client as never);

    const ok = await saveTradePairAndLedger(side(1, 'na'), side(2, 'nb'), LEDGER);

    expect(ok).toBe(false);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO trade_ledger/i.test(s))).toBe(false);
  });
});

describe('insertTradeLedger: duplicate-context dedup (r2)', () => {
  const MARKET_ROW: TradeLedgerRow = { ...LEDGER, context: 'market-r1-42-1' };

  function ledgerInserts(): Array<[string, unknown[]]> {
    return dbMock.query.mock.calls
      .filter((c) => /INSERT INTO trade_ledger/i.test(String(c[0])))
      .map((c) => [String(c[0]), c[1] as unknown[]]);
  }

  it('pins the partial UNIQUE index on non-null context in the schema DDL', () => {
    expect(TRADE_SCHEMA).toContain('CREATE UNIQUE INDEX IF NOT EXISTS trade_ledger_context_uniq');
    expect(TRADE_SCHEMA).toContain('ON trade_ledger (context) WHERE context IS NOT NULL');
  });

  it('a repeated non-null context is a Postgres no-op (ON CONFLICT DO NOTHING, context rides $17)', async () => {
    // The pool is a query spy, so the dedup itself is the partial unique index + the
    // ON CONFLICT clause the INSERT carries; a duplicate context never writes a second
    // row in real Postgres. Assert the clause and that the same context is the last param.
    await insertTradeLedger(MARKET_ROW);
    await insertTradeLedger(MARKET_ROW);
    const inserts = ledgerInserts();
    expect(inserts).toHaveLength(2);
    for (const [sql, params] of inserts) {
      expect(sql).toContain('ON CONFLICT (context) WHERE context IS NOT NULL DO NOTHING');
      expect(params[params.length - 1]).toBe('market-r1-42-1');
    }
  });

  it('classic-lane null-context rows are unconstrained: two both insert', async () => {
    await insertTradeLedger(LEDGER); // no context field -> null
    await insertTradeLedger(LEDGER);
    const inserts = ledgerInserts();
    expect(inserts).toHaveLength(2);
    for (const [sql, params] of inserts) {
      // the partial index skips NULLs, so ON CONFLICT never fires and both rows land
      expect(sql).toContain('ON CONFLICT (context) WHERE context IS NOT NULL DO NOTHING');
      expect(params[params.length - 1]).toBeNull();
    }
  });
});

describe('insertSettlementAndSaveBoth', () => {
  it('inserts the settlement row AND both character rows in ONE committed transaction, returning the id', async () => {
    const client = clientStub({ insertId: 777 });
    dbMock.connect.mockResolvedValueOnce(client as never);

    const id = await insertSettlementAndSaveBoth(INSERT_INPUT, side(1, 'na'), side(2, 'nb'));

    expect(id).toBe(777);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toMatch(/^BEGIN/);
    expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
    expect(sqls.filter((s) => /UPDATE characters/i.test(s))).toHaveLength(2);
    expect(sqls.some((s) => /INSERT INTO trade_settlements/i.test(s))).toBe(true);
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back and returns null on a lease-fence miss (nothing persisted)', async () => {
    const client = clientStub({ missCharId: 2 });
    dbMock.connect.mockResolvedValueOnce(client as never);

    const id = await insertSettlementAndSaveBoth(INSERT_INPUT, side(1, 'na'), side(2, 'nb'));

    expect(id).toBe(null);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
    // the anchor row is never inserted when the escrow could not be fenced durably
    expect(sqls.some((s) => /INSERT INTO trade_settlements/i.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('markTradeSettlement', () => {
  it('COALESCEs each patch field and stamps resolved_at only on a terminal status', async () => {
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 1 } as never);

    await markTradeSettlement(5, 'claudium_done', { wocASig: 'sig', claudiumExecA: true });

    const [sql, params] = dbMock.query.mock.calls[0];
    // every optional column is a COALESCE(patch, existing) so an absent field never clobbers
    expect(String(sql)).toMatch(/woc_a_signature = COALESCE/);
    expect(String(sql)).toMatch(/claudium_a_exec = COALESCE/);
    expect(String(sql)).toMatch(/resolved_at = CASE WHEN/);
    // params: id, status, wocARef, wocBRef, wocASig, wocBSig, execA, execB, failReason, resolved
    expect(params).toEqual([5, 'claudium_done', null, null, 'sig', null, true, null, null, false]);
  });

  it('marks resolved on a completed status', async () => {
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 1 } as never);

    await markTradeSettlement(9, 'completed');

    const params = dbMock.query.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toBe(true);
  });
});

describe('loadOpenTradeSettlements (parseEscrow / parseWhole round-trip)', () => {
  it('parses escrow JSONB and whole-unit BIGINT columns, and marks an out-of-range amount corrupt (NaN)', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: '10',
          realm: 'r1',
          status: 'escrowed',
          char_a_id: '1',
          char_b_id: '2',
          account_a_id: '10',
          account_b_id: '20',
          char_a_name: 'A',
          char_b_name: 'B',
          escrow_a: { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 30 },
          escrow_b: { items: [], copper: 0 },
          claudium_a: '100',
          // above Number.MAX_SAFE_INTEGER: must not silently mis-round
          claudium_b: '99999999999999999999',
          claudium_a_exec: true,
          claudium_b_exec: false,
          woc_a: '1.5',
          woc_b: '0',
          woc_a_reference: 'refA',
          woc_b_reference: null,
          woc_a_signature: null,
          woc_b_signature: null,
          woc_a_payer: 'pk-a',
          woc_a_recipient: 'pk-b',
          woc_b_payer: null,
          woc_b_recipient: null,
          fail_reason: null,
        },
      ],
      rowCount: 1,
    } as never);

    const [row] = await loadOpenTradeSettlements('r1');

    expect(row.escrowA).toEqual({ items: [{ itemId: 'wolf_fang', count: 2 }], copper: 30 });
    expect(row.claudiumA).toBe(100);
    expect(Number.isNaN(row.claudiumB)).toBe(true); // corrupt: recovery will skip it
    expect(row.claudiumExecA).toBe(true);
    expect(row.claudiumExecB).toBe(false);
    expect(row.wocAPayer).toBe('pk-a');
    expect(row.wocARecipient).toBe('pk-b');
    // the query is the partial-index-matching open scan
    expect(String(dbMock.query.mock.calls[0][0])).toMatch(/resolved_at IS NULL/);
  });
});

describe('claimTradeSettlementForRecovery', () => {
  it('claims an open row via an atomic UPDATE ... RETURNING and maps it back', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: '10',
          realm: 'r1',
          status: 'recovering',
          char_a_id: '1',
          char_b_id: '2',
          account_a_id: '10',
          account_b_id: '20',
          char_a_name: 'A',
          char_b_name: 'B',
          escrow_a: { items: [], copper: 0 },
          escrow_b: { items: [], copper: 0 },
          claudium_a: '0',
          claudium_b: '0',
          claudium_a_exec: false,
          claudium_b_exec: false,
          woc_a: '0',
          woc_b: '0',
          woc_a_reference: null,
          woc_b_reference: null,
          woc_a_signature: null,
          woc_b_signature: null,
          woc_a_payer: null,
          woc_a_recipient: null,
          woc_b_payer: null,
          woc_b_recipient: null,
          fail_reason: null,
        },
      ],
      rowCount: 1,
    } as never);

    const claimed = await claimTradeSettlementForRecovery(10);

    expect(claimed?.id).toBe(10);
    expect(claimed?.status).toBe('recovering');
    const [sql, params] = dbMock.query.mock.calls[0];
    const text = String(sql);
    expect(text).toMatch(/UPDATE trade_settlements/);
    // the claim stamps recovering_since = now() as it moves the row into 'recovering'
    expect(text).toMatch(/SET status = 'recovering',\s*recovering_since = now\(\)/);
    expect(text).toMatch(/resolved_at IS NULL/);
    expect(text).toMatch(/status IN \('escrowed', 'claudium_done'\)/);
    // staleness gates on recovering_since (the recovery-attempt age), NOT created_at
    // (the trade's age) -- that swap is the whole R1 double-claim fix.
    expect(text).toMatch(
      /status = 'recovering'\s*AND \(recovering_since IS NULL OR recovering_since < now\(\) - interval '10 minutes'\)/,
    );
    expect(text).not.toMatch(/created_at < now\(\)/);
    // parameterized: id is the only bound param, no string building
    expect(params).toEqual([10]);
    // the RETURNING shape carries the new column so mapSettlementRow sees it
    const returning = text.slice(text.indexOf('RETURNING'));
    expect(returning).toMatch(/recovering_since/);
  });

  it('returns null when the reclaim WHERE excludes the row (a peer holds a fresh recovering_since)', async () => {
    // A live peer's claim set recovering_since = now(), so within the stale window the
    // reclaim WHERE matches no row and the atomic UPDATE ... RETURNING yields nothing:
    // the second claim cannot double-grab an in-flight recovery (R1).
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    expect(await claimTradeSettlementForRecovery(11)).toBe(null);
  });
});
