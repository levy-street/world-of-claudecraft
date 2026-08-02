// Guild Bank Phase 3, the DB half: the guild_banks DDL (additive, idempotent,
// in the schema family that owns guilds), the fenced escrow transaction that
// persists the acting character AND the touched books together, and the
// bounded boot read. The pg pool is mocked (the save_character_and_market
// idiom) so these pin the ACTUAL SQL and transaction shape, not a mock of it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  GUILD_BANK_ROW_MAX_BYTES,
  loadGuildBankRows,
  openMarketWriteGate,
  saveCharacterAndGuildBankState,
  saveCharacterAndMarketState,
} from '../server/db';
import { REALM } from '../server/realm';
import { SOCIAL_SCHEMA } from '../server/social_db';
import type { CharacterState, MailSave, MarketSave } from '../src/sim/sim';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
  dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
  openMarketWriteGate();
});

function clientStub(rowCounts?: (sql: string) => number) {
  const query = vi.fn().mockImplementation((sql: string) => {
    return Promise.resolve({ rows: [], rowCount: rowCounts ? rowCounts(String(sql)) : 0 });
  });
  const release = vi.fn();
  return { query, release };
}

const STATE = {
  level: 5,
  questLog: [],
  questsDone: [],
  inventory: [],
} as unknown as CharacterState;
const MARKET = { listings: [] } as unknown as MarketSave;
const MAIL = { mail: [] } as unknown as MailSave;
const BOOK = { treasury: 1500, inventory: [{ itemId: 'wolf_fang', count: 2 }], purchasedSlots: 6 };

describe('the guild_banks DDL (SOCIAL_SCHEMA, the family that owns guilds)', () => {
  it('is additive and idempotent with the state.md column set and the disband cascade', () => {
    expect(SOCIAL_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS guild_banks');
    const ddl = SOCIAL_SCHEMA.slice(
      SOCIAL_SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS guild_banks'),
    );
    const table = ddl.slice(0, ddl.indexOf(';'));
    expect(table).toContain('guild_id INT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE');
    expect(table).toContain('realm TEXT NOT NULL');
    expect(table).toContain('data JSONB NOT NULL');
    expect(table).toContain('updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    // The realm column must NOT ride the interpolated default (last-boot-wins
    // across realm processes): every insert passes realm explicitly.
    expect(table).not.toContain('realm TEXT NOT NULL DEFAULT');
  });
});

describe('saveCharacterAndGuildBankState (the game-loop escrow save)', () => {
  it('writes the character and every book in ONE transaction on ONE client', async () => {
    const client = clientStub(() => 1);
    dbMock.connect.mockResolvedValueOnce(client as never);

    const ok = await saveCharacterAndGuildBankState(
      42,
      5,
      STATE,
      [
        { guildId: 7, data: BOOK },
        { guildId: 9, data: { treasury: 0, inventory: [], purchasedSlots: 0 } },
      ],
      'nonce-1',
    );
    expect(ok).toBe(true);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toMatch(/^BEGIN/);
    expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(false);
    // The character half carries the in-statement lease fence.
    const charSql = sqls.find((s) => /UPDATE characters/i.test(s));
    expect(charSql).toContain('EXISTS');
    expect(charSql).toContain('character_leases');
    // Both books are parameterized upserts on the SAME client.
    const bankCalls = client.query.mock.calls.filter((c) =>
      /INSERT INTO guild_banks/i.test(String(c[0])),
    );
    expect(bankCalls.map((c) => (c[1] as unknown[])[0])).toEqual([7, 9]);
    expect(String(bankCalls[0][0])).toContain('ON CONFLICT (guild_id) DO UPDATE');
    expect(bankCalls[0][1]).toEqual([7, REALM, JSON.stringify(BOOK)]);
    // Crash-shape: NOTHING leaks onto the bare pool, so the two halves can
    // never persist independently (they commit or vanish together).
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('a fence miss rolls back everything and returns false (no book write at all)', async () => {
    // The lease nonce matches no row: the fenced UPDATE touches nothing.
    const client = clientStub((sql) => (/UPDATE characters/i.test(sql) ? 0 : 1));
    dbMock.connect.mockResolvedValueOnce(client as never);

    const ok = await saveCharacterAndGuildBankState(
      42,
      5,
      STATE,
      [{ guildId: 7, data: BOOK }],
      'stale',
    );
    expect(ok).toBe(false);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
    // The displaced session persisted NEITHER half: no guild_banks statement ran.
    expect(sqls.some((s) => /guild_banks/i.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('a failing book write rolls the character half back too and rethrows', async () => {
    const client = clientStub(() => 1);
    client.query.mockImplementation((sql: string) => {
      if (/INSERT INTO guild_banks/i.test(String(sql))) throw new Error('book boom');
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    dbMock.connect.mockResolvedValueOnce(client as never);

    await expect(
      saveCharacterAndGuildBankState(1, 1, STATE, [{ guildId: 7, data: BOOK }], 'n'),
    ).rejects.toThrow('book boom');
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /UPDATE characters/i.test(s))).toBe(true);
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
  });

  it('the no-nonce path (tests, resumes) still writes transactionally and reports true', async () => {
    const client = clientStub(() => 1);
    dbMock.connect.mockResolvedValueOnce(client as never);
    const ok = await saveCharacterAndGuildBankState(3, 2, STATE, [{ guildId: 7, data: BOOK }]);
    expect(ok).toBe(true);
    const charCall = client.query.mock.calls.find((c) => /UPDATE characters/i.test(String(c[0])));
    expect(String(charCall?.[0])).not.toContain('character_leases');
  });
});

describe('saveCharacterAndMarketState carrying guild books (the leave flush)', () => {
  it('the books land inside the SAME transaction as character + market + mail', async () => {
    const client = clientStub(() => 1);
    dbMock.connect.mockResolvedValueOnce(client as never);

    await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL, undefined, [
      { guildId: 7, data: BOOK },
    ]);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toMatch(/^BEGIN/);
    expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
    expect(sqls.some((s) => /INSERT INTO guild_banks/i.test(s))).toBe(true);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('omitting the parameter keeps the pre-guild-bank write set (back-compat)', async () => {
    const client = clientStub(() => 1);
    dbMock.connect.mockResolvedValueOnce(client as never);
    await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /guild_banks/i.test(s))).toBe(false);
  });

  it('a fence miss on the leave flush writes no book row either', async () => {
    const client = clientStub((sql) => (/UPDATE characters/i.test(sql) ? 0 : 1));
    dbMock.connect.mockResolvedValueOnce(client as never);
    const ok = await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL, 'stale', [
      { guildId: 7, data: BOOK },
    ]);
    expect(ok).toBe(false);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /guild_banks/i.test(s))).toBe(false);
    expect(sqls.some((s) => /world_state/i.test(s))).toBe(false);
  });
});

describe('loadGuildBankRows (the bounded boot read)', () => {
  it('reads every realm guild via LEFT JOIN with the size bound applied IN SQL', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        { guild_id: 7, has_row: true, data_bytes: 120, data: BOOK },
        { guild_id: 8, has_row: false, data_bytes: 0, data: null }, // pre-feature guild
        {
          guild_id: 9,
          has_row: true,
          data_bytes: GUILD_BANK_ROW_MAX_BYTES + 1,
          data: null, // the CASE bound already withheld the blob server-side
        },
      ],
      rowCount: 3,
    } as never);

    const rows = await loadGuildBankRows();

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(String(sql)).toContain('LEFT JOIN guild_banks');
    expect(String(sql)).toContain('pg_column_size');
    expect(String(sql)).toContain('g.realm = $1');
    expect(params).toEqual([REALM, GUILD_BANK_ROW_MAX_BYTES]);

    // The row with a book hands the PARSED object through untouched; the
    // no-row guild reports data null (empty book downstream); the oversized
    // row is flagged so the boot load SKIPS it (never loads an empty book
    // over a real row).
    expect(rows).toEqual([
      { guildId: 7, data: BOOK, oversized: false },
      { guildId: 8, data: null, oversized: false },
      { guildId: 9, data: null, oversized: true },
    ]);
  });

  it('pins the row bound itself (a silent widening would unbound the load)', () => {
    expect(GUILD_BANK_ROW_MAX_BYTES).toBe(262144);
  });
});
