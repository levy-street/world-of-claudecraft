// SQL boundary pins for the account ledger (server/account_ledger_db.ts) plus
// the account_relic_finds DDL literal (ACCOUNT_LEDGER_SCHEMA, applied by ensureSchema). The deeds_db.test
// idiom: db.ts loads for real with pg stubbed, so the actual SQL text the
// boundary issues is what gets asserted, never a mock of it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({ query: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query };
  },
}));

import {
  ACCOUNT_LEDGER_SCHEMA,
  accountLedgerFromRows,
  insertAccountRelicFinds,
  loadAccountLedger,
  utcDayOf,
} from '../../server/account_ledger_db';
import { REALM } from '../../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('insertAccountRelicFinds', () => {
  it('inserts the whole key set in ONE conflict-swallowing statement with explicit realm', async () => {
    await insertAccountRelicFinds(
      { realm: REALM, characterId: 42, accountId: 7, name: 'Hilda', cls: 'warrior' },
      ['item:cryptbone_helm', 'mark:gather_event:pristine_vein'],
    );
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO account_relic_finds');
    expect(sql).toContain(
      '(realm, character_id, account_id, relic_key, character_name, character_class)',
    );
    expect(sql).toContain('unnest($4::text[]), $5, $6');
    // The idempotence backbone: a replayed (character, relic) pair is a no-op.
    expect(sql).toContain('ON CONFLICT (character_id, relic_key) DO NOTHING');
    expect(sql).not.toContain('$7');
    expect(params).toEqual([
      REALM,
      42,
      7,
      ['item:cryptbone_helm', 'mark:gather_event:pristine_vein'],
      'Hilda',
      'warrior',
    ]);
  });

  it('an empty key set never reaches SQL', async () => {
    await insertAccountRelicFinds(
      { realm: REALM, characterId: 42, accountId: 7, name: 'Hilda', cls: 'warrior' },
      [],
    );
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe('utcDayOf', () => {
  it('formats a Date as the UTC day, slices an ISO string, and reads anything else as no calendar', () => {
    expect(utcDayOf(new Date('2026-09-10T23:59:59Z'))).toBe('2026-09-10');
    expect(utcDayOf('2026-09-10T01:02:03.000Z')).toBe('2026-09-10');
    expect(utcDayOf(new Date('garbage'))).toBe('');
    expect(utcDayOf(null)).toBe('');
    expect(utcDayOf(12)).toBe('');
  });
});

describe('loadAccountLedger', () => {
  it('issues the two account-indexed joins and folds the rows oldest-first into one ledger', async () => {
    dbMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM character_deeds')) {
        return {
          rows: [
            {
              key: 'prog_first_steps',
              character_id: 42,
              name: 'Hilda',
              class: 'warrior',
              at: new Date('2026-09-01T10:00:00Z'),
            },
            {
              key: 'prog_first_steps',
              character_id: 43,
              name: 'Bram',
              class: 'mage',
              at: new Date('2026-09-05T10:00:00Z'),
            },
          ],
        };
      }
      if (sql.includes('FROM account_relic_finds')) {
        return {
          rows: [
            {
              key: 'item:cryptbone_helm',
              character_id: 43,
              name: 'Bram',
              class: 'mage',
              at: new Date('2026-09-06T10:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const ledger = await loadAccountLedger(7);
    expect(dbMock.query).toHaveBeenCalledTimes(2);
    // The relic read LEFT JOINs and falls back to the row's own name/class
    // snapshot, so a deleted character keeps its finds (the PR #3933 point).
    const relicSql = dbMock.query.mock.calls
      .map((c) => c[0] as string)
      .find((q) => q.includes('FROM account_relic_finds'));
    expect(relicSql).toContain('LEFT JOIN characters c ON c.id = f.character_id');
    expect(relicSql).toContain('COALESCE(c.name, f.character_name) AS name');
    expect(relicSql).toContain('COALESCE(c.class, f.character_class) AS class');
    for (const [sql, params] of dbMock.query.mock.calls) {
      expect(sql).toContain('JOIN characters c ON c.id =');
      expect(sql).toMatch(/WHERE \w\.account_id = \$1/);
      expect(sql).toContain('ORDER BY');
      expect(params).toEqual([7]);
    }
    expect(ledger.deeds.get('prog_first_steps')).toEqual([
      { characterId: 42, name: 'Hilda', cls: 'warrior', day: '2026-09-01' },
      { characterId: 43, name: 'Bram', cls: 'mage', day: '2026-09-05' },
    ]);
    expect(ledger.relics.get('item:cryptbone_helm')).toEqual([
      { characterId: 43, name: 'Bram', cls: 'mage', day: '2026-09-06' },
    ]);
  });

  it('accountLedgerFromRows dedupes a repeated character and drops ids the catalog no longer knows', () => {
    const row = {
      key: 'prog_first_steps',
      character_id: 1,
      name: 'A',
      class: 'warrior',
      at: '2026-09-01',
    };
    const ledger = accountLedgerFromRows(
      [row, { ...row, at: '2026-09-02' }, { ...row, key: 'retired_deed' }],
      [{ ...row, key: 'item:retired_relic' }],
    );
    expect(ledger.deeds.has('retired_deed')).toBe(false);
    expect(ledger.relics.size).toBe(0);
    expect(ledger.deeds.get('prog_first_steps')).toEqual([
      { characterId: 1, name: 'A', cls: 'warrior', day: '2026-09-01' },
    ]);
  });
});

describe('account_relic_finds DDL', () => {
  const start = ACCOUNT_LEDGER_SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS account_relic_finds');
  const end = ACCOUNT_LEDGER_SCHEMA.indexOf(
    'CREATE INDEX IF NOT EXISTS account_relic_finds_account',
  );
  const block = ACCOUNT_LEDGER_SCHEMA.slice(start, end);

  it('exists as the character_deeds sibling: explicit realm, account cascade only, the idempotence backbone, the account index', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(block).toMatch(/realm TEXT NOT NULL,/);
    expect(block).not.toMatch(/realm TEXT NOT NULL DEFAULT/);
    // No character FK on purpose (a find outlives its character), and the
    // finder snapshot columns that make that survivable.
    expect(block).toContain('character_id INT NOT NULL,');
    expect(block).not.toContain('REFERENCES characters(id)');
    expect(block).toContain('character_name TEXT NOT NULL');
    expect(block).toContain('character_class TEXT NOT NULL');
    expect(block).toContain('account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE');
    expect(block).toContain('relic_key TEXT NOT NULL');
    expect(block).toContain('found_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(block).toContain('UNIQUE (character_id, relic_key)');
    expect(ACCOUNT_LEDGER_SCHEMA).toContain(
      'CREATE INDEX IF NOT EXISTS account_relic_finds_account ON account_relic_finds(account_id);',
    );
  });
});
