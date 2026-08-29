import { EventEmitter } from 'node:events';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  beginCharacterSaveTx,
  CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS,
  CHARACTER_SAVE_STATEMENT_TIMEOUT_MS,
  CHARACTER_SAVE_TRANSACTION_TIMEOUT_MS,
  prepareCharacterSaveEffects,
} from '../../server/character_save_transaction';
import type { DbTransactionDeadlineClient } from '../../server/db_transaction_deadline';
import { REALM } from '../../server/realm';
import type { StorageAppliedEffect } from '../../server/storage_purchase_db';

const result = (): QueryResult<QueryResultRow> =>
  ({ rows: [], rowCount: 0 }) as unknown as QueryResult<QueryResultRow>;

class FakeClient extends EventEmitter implements DbTransactionDeadlineClient {
  readonly queries: string[] = [];
  readonly releases: Array<Error | boolean | undefined> = [];

  constructor(private readonly failOn?: string) {
    super();
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<QueryResult<Row>> {
    this.queries.push(text);
    if (this.failOn && text.includes(this.failOn)) {
      throw Object.assign(new Error('setup refused'), { code: '55P03' });
    }
    return result() as QueryResult<Row>;
  }

  release(error?: Error | boolean): void {
    this.releases.push(error);
  }
}

const EFFECT: StorageAppliedEffect = {
  realm: REALM,
  accountId: 7,
  characterId: 42,
  itemId: 'strongbox_rung_01',
  expectedCostClaudium: 100,
  idempotencyKey: 'storage-save-transaction-test',
  spendClaimToken: '00000000-0000-4000-8000-000000000001',
  purchasedSlotsBefore: 0,
  purchasedSlotsAfter: 6,
};

describe('bounded character save transaction', () => {
  it('starts with the heavy statement, lock, idle, and whole-operation bounds', async () => {
    const client = new FakeClient();
    const transaction = await beginCharacterSaveTx(client, 'test save');

    expect(CHARACTER_SAVE_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(CHARACTER_SAVE_TRANSACTION_TIMEOUT_MS).toBe(65_000);
    expect(client.queries).toEqual([
      'BEGIN',
      `SET LOCAL statement_timeout = 60000;
       SET LOCAL lock_timeout = '2s';
       SET LOCAL idle_in_transaction_session_timeout = '10s'`,
    ]);

    await transaction.commit();
    transaction.release();
    expect(client.releases).toEqual([undefined]);
  });

  it('rolls back and releases when transaction setup is refused', async () => {
    const client = new FakeClient('lock_timeout');

    await expect(beginCharacterSaveTx(client, 'test save')).rejects.toThrow('setup refused');

    expect(client.queries).toEqual([
      'BEGIN',
      `SET LOCAL statement_timeout = 60000;
       SET LOCAL lock_timeout = '2s';
       SET LOCAL idle_in_transaction_session_timeout = '10s'`,
      'ROLLBACK',
    ]);
    expect(client.releases).toEqual([undefined]);
  });

  it('uses the shorter server bound for a retry-safe recovery save', async () => {
    const client = new FakeClient();
    const controller = new AbortController();
    const transaction = await beginCharacterSaveTx(client, 'recovery save', controller.signal);

    expect(CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(client.queries[1]).toContain('SET LOCAL statement_timeout = 15000');

    await transaction.rollback();
    transaction.release();
    expect(client.releases).toEqual([undefined]);
  });

  it('rejects an oversized or mismatched no-ledger effect batch synchronously', () => {
    expect(() => prepareCharacterSaveEffects(42, [EFFECT, EFFECT], undefined)).toThrow(
      /exceeds one pending purchase/,
    );
    expect(() =>
      prepareCharacterSaveEffects(41, [{ ...EFFECT, characterId: 41, realm: 'other' }], undefined),
    ).toThrow(/does not match the character save/);
  });

  it('forwards cancelBackend into the deadline so an abort cancels the save backend', async () => {
    // The wiring proof for db.ts's beginSaveTx wrapper: the fourth argument must
    // reach createDbTransactionDeadline, or a deadline-destroyed save backend
    // keeps its locks for the full server-side statement_timeout.
    const client = Object.assign(new FakeClient(), { processID: 4242 });
    const cancelled: number[] = [];
    const controller = new AbortController();
    const transaction = await beginCharacterSaveTx(
      client,
      'cancel forwarding save',
      controller.signal,
      async (pid) => {
        cancelled.push(pid);
      },
    );
    controller.abort();
    await Promise.resolve();
    expect(cancelled).toEqual([4242]);
    await expect(transaction.query('SELECT 1')).rejects.toThrow();
  });

  it('never fires cancelBackend on a cleanly completed save transaction', async () => {
    const client = Object.assign(new FakeClient(), { processID: 4242 });
    const cancelled: number[] = [];
    const transaction = await beginCharacterSaveTx(client, 'clean save', undefined, async (pid) => {
      cancelled.push(pid);
    });
    await transaction.rollback();
    transaction.release();
    expect(cancelled).toEqual([]);
  });
});
