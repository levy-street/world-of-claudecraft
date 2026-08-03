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
  GUILD_BANK_BOOT_BATCH,
  GUILD_BANK_ROW_MAX_BYTES,
  type GuildBankWriteResult,
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
const BOOK = {
  treasury: 1500,
  inventory: [{ itemId: 'wolf_fang', count: 2 }],
  purchasedSlots: 30,
};

// A session's OWN unflushed deltas: the escrow save's payload since the escrow
// root fix. The row itself is rebuilt inside the transaction as "durable truth
// plus these", so the payload never carries another officer's work.
const DEPOSIT_GOLD = {
  op: 'deposit_gold' as const,
  itemId: null,
  count: null,
  instance: null,
  craftedRecipeId: null,
  copperDelta: 1_500,
  purchasedSlotsBefore: 0,
  purchasedSlotsAfter: 0,
};
const DEPOSIT_FANGS = {
  op: 'deposit' as const,
  itemId: 'wolf_fang',
  count: 2,
  instance: null,
  craftedRecipeId: null,
  copperDelta: 0,
  purchasedSlotsBefore: 0,
  purchasedSlotsAfter: 0,
};
const SAVE_7 = { guildId: 7, deltas: [DEPOSIT_GOLD, DEPOSIT_FANGS] };
const SAVE_9 = { guildId: 9, deltas: [DEPOSIT_GOLD] };

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

    const results: GuildBankWriteResult[] = [];
    const ok = await saveCharacterAndGuildBankState(
      42,
      5,
      STATE,
      [SAVE_7, SAVE_9],
      'nonce-1',
      results,
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
    // Each book is a READ-MODIFY-WRITE: the durable row is re-read FOR UPDATE
    // on this same client, INSIDE the transaction and AFTER the fenced
    // character UPDATE, then this session's own deltas are replayed onto it.
    // Reading outside the transaction would be a lost-update window (two saves
    // reading one base, the later write discarding the earlier's deltas), and
    // the row lock is what makes the merge safe across PROCESSES.
    const lockCalls = client.query.mock.calls.filter((c) =>
      /FROM guild_banks[\s\S]*FOR UPDATE/i.test(String(c[0])),
    );
    // Two locked reads per guild here, because this stub answers the first
    // with no row: FOR UPDATE locks ROWS, so a guild with no row yet locks
    // nothing and two processes could both merge onto the empty base. The
    // seed-then-relock only runs on a guild's first-ever write.
    expect(lockCalls.map((c) => (c[1] as unknown[])[0])).toEqual([7, 7, 9, 9]);
    expect((lockCalls[0][1] as unknown[])[1]).toBe(GUILD_BANK_ROW_MAX_BYTES);
    const seedCalls = client.query.mock.calls.filter((c) =>
      /ON CONFLICT \(guild_id\) DO NOTHING/i.test(String(c[0])),
    );
    expect(seedCalls.map((c) => (c[1] as unknown[])[0])).toEqual([7, 9]);
    const charIndex = sqls.findIndex((s2) => /UPDATE characters/i.test(s2));
    const lockIndex = sqls.findIndex((s2) => /FOR UPDATE/i.test(s2));
    expect(charIndex).toBeGreaterThan(0);
    expect(lockIndex).toBeGreaterThan(charIndex);
    // Both books are parameterized upserts on the SAME client, carrying the
    // MERGED book (this stub's SELECT returns no row, so the base is the empty
    // book and the merge is exactly this session's deltas).
    const bankCalls = client.query.mock.calls.filter((c) =>
      /INSERT INTO guild_banks[\s\S]*DO UPDATE/i.test(String(c[0])),
    );
    expect(bankCalls.map((c) => (c[1] as unknown[])[0])).toEqual([7, 9]);
    expect(String(bankCalls[0][0])).toContain('ON CONFLICT (guild_id) DO UPDATE');
    expect(bankCalls[0][1]).toEqual([
      7,
      REALM,
      JSON.stringify({
        treasury: 1_500,
        inventory: [{ itemId: 'wolf_fang', count: 2 }],
        purchasedSlots: 0,
      }),
    ]);
    expect(results).toEqual([
      { guildId: 7, written: true, deficit: null, rowUnusable: false },
      { guildId: 9, written: true, deficit: null, rowUnusable: false },
    ]);
    // Crash-shape: NOTHING leaks onto the bare pool, so the two halves can
    // never persist independently (they commit or vanish together).
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('a fence miss rolls back everything and returns false (no book write at all)', async () => {
    // The lease nonce matches no row: the fenced UPDATE touches nothing.
    const client = clientStub((sql) => (/UPDATE characters/i.test(sql) ? 0 : 1));
    dbMock.connect.mockResolvedValueOnce(client as never);

    const ok = await saveCharacterAndGuildBankState(42, 5, STATE, [SAVE_7], 'stale');
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

    await expect(saveCharacterAndGuildBankState(1, 1, STATE, [SAVE_7], 'n')).rejects.toThrow(
      'book boom',
    );
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /UPDATE characters/i.test(s))).toBe(true);
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
  });

  it('the no-nonce path (tests, resumes) still writes transactionally and reports true', async () => {
    const client = clientStub(() => 1);
    dbMock.connect.mockResolvedValueOnce(client as never);
    const ok = await saveCharacterAndGuildBankState(3, 2, STATE, [SAVE_7]);
    expect(ok).toBe(true);
    const charCall = client.query.mock.calls.find((c) => /UPDATE characters/i.test(String(c[0])));
    expect(String(charCall?.[0])).not.toContain('character_leases');
  });
});

describe('saveCharacterAndMarketState carrying guild books (the leave flush)', () => {
  it('the books land inside the SAME transaction as character + market + mail', async () => {
    const client = clientStub(() => 1);
    dbMock.connect.mockResolvedValueOnce(client as never);

    await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL, undefined, [SAVE_7]);

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
    const ok = await saveCharacterAndMarketState(42, 7, STATE, MARKET, MAIL, 'stale', [SAVE_7]);
    expect(ok).toBe(false);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /guild_banks/i.test(s))).toBe(false);
    expect(sqls.some((s) => /world_state/i.test(s))).toBe(false);
  });
});

describe('loadGuildBankRows (the bounded, batched boot read)', () => {
  // The boot read now rides runWithStatementTimeout (a client transaction
  // carrying SET LOCAL statement_timeout on the HEAVY allowance): a slow boot
  // must load the books, not fail into the all-banks-inert arm. The client
  // stub answers the SELECT with the given rows per call.
  function bootClient(pages: unknown[][]) {
    let page = 0;
    const query = vi.fn().mockImplementation((sql: string) => {
      if (/SELECT g\.id/i.test(String(sql))) {
        return Promise.resolve({ rows: pages[page++] ?? [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    return { query, release: vi.fn() };
  }

  it('reads every realm guild via LEFT JOIN with the size bound applied IN SQL', async () => {
    const client = bootClient([
      [
        { guild_id: 7, has_row: true, data_bytes: 120, data: BOOK },
        { guild_id: 8, has_row: false, data_bytes: 0, data: null }, // pre-feature guild
        {
          guild_id: 9,
          has_row: true,
          data_bytes: GUILD_BANK_ROW_MAX_BYTES + 1,
          data: null, // the CASE bound already withheld the blob server-side
        },
      ],
    ]);
    dbMock.connect.mockResolvedValue(client as never);

    const rows = await loadGuildBankRows();

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    // The heavy statement allowance rides the read's transaction.
    expect(sqls.some((s) => /SET LOCAL statement_timeout = 60000/.test(s))).toBe(true);
    const selectCall = client.query.mock.calls.find((c) => /SELECT g\.id/i.test(String(c[0])));
    const [sql, params] = selectCall as [string, unknown[]];
    expect(String(sql)).toContain('LEFT JOIN guild_banks');
    // octet_length of the TEXT form: the bound measures uncompressed bytes
    // (pg_column_size reports post-TOAST compressed size, which a highly
    // compressible multi-megabyte blob slips under), and the expensive
    // detoast-and-serialize is computed ONCE per row via the LATERAL, never
    // twice.
    expect(String(sql)).toContain('octet_length(gb.data::text)');
    expect((String(sql).match(/octet_length/g) ?? []).length).toBe(1);
    expect(String(sql)).toContain('LATERAL');
    expect(String(sql)).not.toContain('pg_column_size');
    expect(String(sql)).toContain('g.realm = $1');
    expect(params).toEqual([REALM, GUILD_BANK_ROW_MAX_BYTES, 0, GUILD_BANK_BOOT_BATCH]);

    // The row with a book hands the PARSED object through untouched; the
    // no-row guild reports data null (empty book downstream); the oversized
    // row is flagged so the boot load SKIPS it (never loads an empty book
    // over a real row).
    expect(rows).toEqual([
      { guildId: 7, data: BOOK, oversized: false, dataBytes: 120 },
      { guildId: 8, data: null, oversized: false, dataBytes: 0 },
      {
        guildId: 9,
        data: null,
        oversized: true,
        dataBytes: GUILD_BANK_ROW_MAX_BYTES + 1,
      },
    ]);
  });

  it('keyset-batches: a full page fetches the next page from the last guild id', async () => {
    const fullPage = Array.from({ length: GUILD_BANK_BOOT_BATCH }, (_, i) => ({
      guild_id: i + 1,
      has_row: false,
      data_bytes: 0,
      data: null,
    }));
    const client = bootClient([
      fullPage,
      [{ guild_id: GUILD_BANK_BOOT_BATCH + 5, has_row: false, data_bytes: 0, data: null }],
    ]);
    dbMock.connect.mockResolvedValue(client as never);

    const rows = await loadGuildBankRows();
    expect(rows).toHaveLength(GUILD_BANK_BOOT_BATCH + 1);
    const selects = client.query.mock.calls.filter((c) => /SELECT g\.id/i.test(String(c[0])));
    expect(selects).toHaveLength(2);
    // The second page resumes after the first page's last id.
    expect((selects[1][1] as unknown[])[2]).toBe(GUILD_BANK_BOOT_BATCH);
  });

  it('pins the row bound itself (a silent widening would unbound the load)', () => {
    expect(GUILD_BANK_ROW_MAX_BYTES).toBe(262144);
  });
});
