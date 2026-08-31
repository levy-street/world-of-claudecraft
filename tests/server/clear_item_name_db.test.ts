// The clear-item-name SQL boundary (server/clear_item_name_db.ts): the
// existence probe the fenced-save refusal arm asks instead of re-loading the
// whole blob (the Phase 18 clear-item-name-select1 item). Exercised through
// the REAL module over a mocked pg pool (the save_offline_character_state
// idiom) so the statement text, its parameters, and the rowCount mapping are
// the production path's own; the real-Postgres arm (a row with state, a
// null-state row, a missing row, another realm's row) rides
// tests/character_save_statement_pg_integration.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import { characterStateExists } from '../../server/clear_item_name_db';
import { REALM } from '../../server/realm';

afterEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
});

describe('characterStateExists (the SELECT 1 probe behind the refusal arm)', () => {
  it('asks SELECT 1 over id, realm, and state IS NOT NULL, never the blob columns', async () => {
    dbMock.query.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 } as never);

    expect(await characterStateExists(41)).toBe(true);

    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [text, values] = dbMock.query.mock.calls[0] as [string, unknown[]];
    // The exact predicate the first load (db.ts getCharacterById) answers
    // not-found on, id-realm-state, so the two arms can never disagree about
    // what a vanished character is; and a projection of 1, so the refusal
    // path never pays the JSONB blob a second time.
    expect(text.replace(/\s+/g, ' ').trim()).toBe(
      'SELECT 1 FROM characters WHERE id = $1 AND realm = $2 AND state IS NOT NULL',
    );
    expect(values).toEqual([41, REALM]);
  });

  it('answers false on a 0-row result (no row, a null state, or another realm)', async () => {
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    expect(await characterStateExists(42)).toBe(false);
    // A driver that reports no rowCount at all reads as absent, never as present.
    dbMock.query.mockResolvedValue({ rows: [] } as never);
    expect(await characterStateExists(43)).toBe(false);
  });
});
