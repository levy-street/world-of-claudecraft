// The clear-item-name SQL boundary (server/clear_item_name_db.ts): the
// existence probe the fenced-save refusal arm asks instead of re-loading the
// whole blob (the Phase 18 clear-item-name-select1 item). Exercised through
// the REAL module over a mocked pg pool (the save_offline_character_state
// idiom) so the statement text, its parameters, its statement-timeout
// discipline, and the rowCount mapping are the production path's own; the
// real-Postgres arm (a row with state, a null-state row, a missing row,
// another realm's row) rides
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

import {
  CLEAR_ITEM_NAME_PROBE_TIMEOUT_MS,
  characterStateExists,
} from '../../server/clear_item_name_db';
import { DB_STATEMENT_TIMEOUT_MS } from '../../server/db';
import { REALM } from '../../server/realm';

/** A pooled client whose every statement answers with `rowCount`, the shape
 *  runWithStatementTimeout drives (BEGIN, SET LOCAL, the read, COMMIT). */
function transactionClient(rowCount: number) {
  const client = { query: vi.fn(), release: vi.fn() };
  client.query.mockResolvedValue({ rows: rowCount > 0 ? [{ '?column?': 1 }] : [], rowCount });
  return client;
}

function probeCall(client: ReturnType<typeof transactionClient>) {
  return client.query.mock.calls.find(
    (call) => typeof call[0] === 'string' && call[0].includes('FROM characters'),
  );
}

afterEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
});

describe('characterStateExists (the SELECT 1 probe behind the refusal arm)', () => {
  it('asks SELECT 1 over id, realm, and state IS NOT NULL, never the blob columns', async () => {
    const client = transactionClient(1);
    dbMock.connect.mockResolvedValue(client as never);

    expect(await characterStateExists(41)).toBe(true);

    const call = probeCall(client);
    if (!call) throw new Error('no probe statement was issued');
    // The exact predicate the first load (db.ts getCharacterById) answers
    // not-found on, id-realm-state, so the two arms can never disagree about
    // what a vanished character is; and a projection of 1, so the refusal
    // path never pays the JSONB blob a second time.
    expect((call[0] as string).replace(/\s+/g, ' ').trim()).toBe(
      'SELECT 1 FROM characters WHERE id = $1 AND realm = $2 AND state IS NOT NULL',
    );
    expect(call[1]).toEqual([41, REALM]);
    // Never a bare pool read: the probe rides the same transaction wrapper its
    // sibling write does.
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('runs under its OWN lowered statement timeout, not the 15s session default', async () => {
    // The A2 arm of the Phase 18 security review. The probe is one indexed
    // single-row read on the refusal path of an operator action, so a
    // degraded database must cost it a couple of seconds, not the full
    // session default with a pooled client pinned for all of it (the
    // GUILD_BANK_LOG_TIMEOUT_MS lowering precedent, which is what "the same
    // runWithStatementTimeout discipline its sibling write uses" means for a
    // read this cheap). Pinned by literal so a quiet raise back to the
    // default, or to the heavy allowance, reds here.
    const client = transactionClient(1);
    dbMock.connect.mockResolvedValue(client as never);

    await characterStateExists(41);

    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe('SET LOCAL statement_timeout = 2000');
    expect(statements).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    // The constant itself, and its relation to the session default it lowers.
    expect(CLEAR_ITEM_NAME_PROBE_TIMEOUT_MS).toBe(2_000);
    expect(CLEAR_ITEM_NAME_PROBE_TIMEOUT_MS).toBeLessThan(DB_STATEMENT_TIMEOUT_MS);
  });

  it('answers false on a 0-row result (no row, a null state, or another realm)', async () => {
    const client = transactionClient(0);
    dbMock.connect.mockResolvedValue(client as never);
    expect(await characterStateExists(42)).toBe(false);

    // A driver that reports no rowCount at all reads as absent, never as present.
    const blind = { query: vi.fn(), release: vi.fn() };
    blind.query.mockResolvedValue({ rows: [] } as never);
    dbMock.connect.mockResolvedValue(blind as never);
    expect(await characterStateExists(43)).toBe(false);
  });

  it('releases the pooled client and rolls back when the read throws', async () => {
    // A statement timeout on this path must not leak a client: the refusal
    // arm runs while an operator waits, and a leaked client is the failure
    // that outlives the request.
    const client = { query: vi.fn(), release: vi.fn() };
    client.query.mockImplementation(async (text: string) => {
      if (text.includes('FROM characters')) throw new Error('canceling statement due to timeout');
      return { rows: [], rowCount: 0 };
    });
    dbMock.connect.mockResolvedValue(client as never);

    await expect(characterStateExists(44)).rejects.toThrow('canceling statement');
    expect(client.query.mock.calls.map((call) => String(call[0]))).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
