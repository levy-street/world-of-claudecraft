import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { DbTransactionDeadlineClient } from '../../server/db_transaction_deadline';
import { DbTransactionAborted } from '../../server/db_transaction_deadline';
import {
  beginStoragePurchase,
  claimStoragePurchaseSpend,
  deletePendingStoragePurchaseWithoutDebit,
  openStoragePurchaseForCharacter,
  pendingStoragePurchasesForCharacter,
  releaseStoragePurchaseSpendClaim,
  renewStoragePurchaseSpendClaim,
  STORAGE_PURCHASE_SIGNAL_STATEMENT_TIMEOUT_MS,
  StoragePurchaseDbAborted,
  settleStoragePurchase,
  storagePurchaseByKey,
} from '../../server/storage_purchase_db';

const CLAIM_TOKEN = '00000000-0000-4000-8000-000000000001';
const ROW = {
  realm: 'r1',
  accountId: 7,
  characterId: 42,
  itemId: 'strongbox_rung_01',
  expectedCostClaudium: 100,
  idempotencyKey: 'k-abort',
  claimToken: CLAIM_TOKEN,
};
const RAW_ROW = {
  id: 5,
  realm: ROW.realm,
  account_id: ROW.accountId,
  character_id: ROW.characterId,
  item_id: ROW.itemId,
  expected_cost_claudium: ROW.expectedCostClaudium,
  idempotency_key: ROW.idempotencyKey,
  status: 'pending',
};

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

function clientWithQuery(
  query: (text: string, values?: unknown[]) => Promise<QueryResult>,
  release = vi.fn<(error?: Error | boolean) => void>(),
): DbTransactionDeadlineClient {
  return {
    query,
    release,
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as DbTransactionDeadlineClient;
}

describe('storage purchase database cancellation', () => {
  it('pins the recovery statement timeout to two seconds', () => {
    expect(STORAGE_PURCHASE_SIGNAL_STATEMENT_TIMEOUT_MS).toBe(2_000);
  });

  it('refuses a pre-aborted read before pool checkout or SQL', async () => {
    const controller = new AbortController();
    controller.abort();
    const db = {
      query: vi.fn(),
      connect: vi.fn(),
    };

    await expect(
      openStoragePurchaseForCharacter(db, ROW.characterId, controller.signal),
    ).rejects.toBeInstanceOf(StoragePurchaseDbAborted);
    expect(db.connect).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('abandons a queued checkout immediately and destroys a client delivered after abort', async () => {
    let resolveCheckout: ((client: DbTransactionDeadlineClient) => void) | undefined;
    const checkout = new Promise<DbTransactionDeadlineClient>((resolve) => {
      resolveCheckout = resolve;
    });
    const db = {
      query: vi.fn(),
      connect: vi.fn(() => checkout),
    };
    const controller = new AbortController();
    const pending = pendingStoragePurchasesForCharacter(db, ROW.characterId, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      code: 'STORAGE_PURCHASE_DB_ABORTED',
      operation: 'storage purchase pending scan',
    });

    await vi.waitFor(() => expect(db.connect).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejection;

    const lateQuery = vi.fn();
    const lateRelease = vi.fn();
    resolveCheckout?.(clientWithQuery(lateQuery, lateRelease));
    await vi.waitFor(() => expect(lateRelease).toHaveBeenCalledTimes(1));
    expect(lateQuery).not.toHaveBeenCalled();
    expect(lateRelease.mock.calls[0][0]).toBeInstanceOf(StoragePurchaseDbAborted);
  });

  it('destroys an active read, detaches listeners, and leaves the next checkout healthy', async () => {
    let rejectActive: ((error: unknown) => void) | undefined;
    const firstQuery = vi.fn(
      () =>
        new Promise<QueryResult>((_resolve, reject) => {
          rejectActive = reject;
        }),
    );
    const firstRelease = vi.fn((error?: Error | boolean) => {
      if (error instanceof Error) rejectActive?.(new Error('socket destroyed'));
    });
    const first = clientWithQuery(firstQuery, firstRelease);
    const secondRelease = vi.fn();
    const second = clientWithQuery(
      vi.fn(async () => ({ rows: [RAW_ROW], rowCount: 1 })),
      secondRelease,
    );
    const db = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
    };
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = openStoragePurchaseForCharacter(db, ROW.characterId, controller.signal);
    const rejection = expect(pending).rejects.toBeInstanceOf(StoragePurchaseDbAborted);

    await vi.waitFor(() => expect(firstQuery).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejection;
    expect(firstRelease).toHaveBeenCalledTimes(1);
    expect(firstRelease.mock.calls[0][0]).toBeInstanceOf(StoragePurchaseDbAborted);
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));

    const healthy = await openStoragePurchaseForCharacter(
      db,
      ROW.characterId,
      new AbortController().signal,
    );
    expect(healthy).toMatchObject({ idempotencyKey: ROW.idempotencyKey });
    expect(secondRelease).toHaveBeenCalledWith();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('preserves a SQLSTATE error that wins and returns that client normally', async () => {
    const pgError = Object.assign(new Error('lock timeout'), { code: '55P03' });
    const release = vi.fn();
    const query = vi.fn(async (text: string): Promise<QueryResult> => {
      if (text.startsWith('SET statement_timeout') || text === 'RESET statement_timeout') {
        return { rows: [], rowCount: null };
      }
      throw pgError;
    });
    const client = clientWithQuery(query, release);
    const db = { query: vi.fn(), connect: vi.fn(async () => client) };

    await expect(
      claimStoragePurchaseSpend(db, ROW.idempotencyKey, CLAIM_TOKEN, new AbortController().signal),
    ).rejects.toBe(pgError);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith();
    expect(query.mock.calls.map(([text]) => text)).toEqual([
      'SET statement_timeout = 2000',
      expect.stringContaining('UPDATE storage_purchases'),
      'RESET statement_timeout',
    ]);
  });

  it('destroys a client when setting the recovery statement timeout fails', async () => {
    const setError = Object.assign(new Error('cannot set timeout'), { code: '57P01' });
    const release = vi.fn();
    const query = vi.fn(async () => Promise.reject(setError));
    const client = clientWithQuery(query, release);
    const db = { query: vi.fn(), connect: vi.fn(async () => client) };

    await expect(
      claimStoragePurchaseSpend(db, ROW.idempotencyKey, CLAIM_TOKEN, new AbortController().signal),
    ).rejects.toBe(setError);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SET statement_timeout = 2000');
    expect(release).toHaveBeenCalledWith(setError);
  });

  it('poisons on RESET failure but preserves the target SQLSTATE error', async () => {
    const pgError = Object.assign(new Error('lock timeout'), { code: '55P03' });
    const resetError = new Error('reset failed');
    const release = vi.fn();
    const query = vi.fn(async (text: string): Promise<QueryResult> => {
      if (text.startsWith('SET statement_timeout')) return { rows: [], rowCount: null };
      if (text === 'RESET statement_timeout') throw resetError;
      throw pgError;
    });
    const client = clientWithQuery(query, release);
    const db = { query: vi.fn(), connect: vi.fn(async () => client) };

    await expect(
      claimStoragePurchaseSpend(db, ROW.idempotencyKey, CLAIM_TOKEN, new AbortController().signal),
    ).rejects.toBe(pgError);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(resetError);
  });

  it('poisons on RESET failure without replacing a known target result', async () => {
    const resetError = new Error('reset failed');
    const release = vi.fn();
    const query = vi.fn(async (text: string): Promise<QueryResult> => {
      if (text.startsWith('SET statement_timeout')) return { rows: [], rowCount: null };
      if (text === 'RESET statement_timeout') throw resetError;
      return { rows: [{ id: 5 }], rowCount: 1 };
    });
    const client = clientWithQuery(query, release);
    const db = { query: vi.fn(), connect: vi.fn(async () => client) };

    await expect(
      claimStoragePurchaseSpend(db, ROW.idempotencyKey, CLAIM_TOKEN, new AbortController().signal),
    ).resolves.toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(resetError);
  });

  it('destroys a client after a codeless driver failure without replacing the error', async () => {
    const driverError = new Error('query timeout');
    const release = vi.fn();
    const query = vi.fn(async (text: string): Promise<QueryResult> => {
      if (text.startsWith('SET statement_timeout')) return { rows: [], rowCount: null };
      throw driverError;
    });
    const client = clientWithQuery(query, release);
    const db = { query: vi.fn(), connect: vi.fn(async () => client) };

    await expect(
      claimStoragePurchaseSpend(db, ROW.idempotencyKey, CLAIM_TOKEN, new AbortController().signal),
    ).rejects.toBe(driverError);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(driverError);
  });

  it('keeps the first client error, releases once, and removes the real error listener', async () => {
    const events = new EventEmitter();
    let rejectActive: ((error: unknown) => void) | undefined;
    const query = vi.fn(
      () =>
        new Promise<QueryResult>((_resolve, reject) => {
          rejectActive = reject;
        }),
    );
    const release = vi.fn();
    const client = {
      query,
      release,
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
    } as unknown as DbTransactionDeadlineClient;
    const db = { query: vi.fn(), connect: vi.fn(async () => client) };
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = openStoragePurchaseForCharacter(db, ROW.characterId, controller.signal);
    const observed = pending.then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );

    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    const clientError = new Error('connection reset');
    events.emit('error', clientError);
    rejectActive?.(new Error('later query rejection'));
    expect((await observed).error).toBe(clientError);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(clientError);
    expect(events.listenerCount('error')).toBe(0);
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it.each([
    ['key lookup', (db: never, signal: AbortSignal) => storagePurchaseByKey(db, 'k', signal)],
    [
      'claim',
      (db: never, signal: AbortSignal) => claimStoragePurchaseSpend(db, 'k', CLAIM_TOKEN, signal),
    ],
    [
      'renew',
      (db: never, signal: AbortSignal) =>
        renewStoragePurchaseSpendClaim(db, 'k', CLAIM_TOKEN, signal),
    ],
    [
      'release',
      (db: never, signal: AbortSignal) =>
        releaseStoragePurchaseSpendClaim(db, 'k', CLAIM_TOKEN, signal),
    ],
    [
      'settle',
      (db: never, signal: AbortSignal) =>
        settleStoragePurchase(db, 'k', 'unresolved', CLAIM_TOKEN, signal),
    ],
    [
      'no-debit discard',
      (db: never, signal: AbortSignal) =>
        deletePendingStoragePurchaseWithoutDebit(db, 'k', CLAIM_TOKEN, signal),
    ],
    [
      'pending scan',
      (db: never, signal: AbortSignal) => pendingStoragePurchasesForCharacter(db, 42, signal),
    ],
    [
      'open scan',
      (db: never, signal: AbortSignal) => openStoragePurchaseForCharacter(db, 42, signal),
    ],
  ])('routes the cancellable %s through an owned pool client', async (_name, run) => {
    const release = vi.fn();
    const client = clientWithQuery(
      vi.fn(async () => ({ rows: [RAW_ROW], rowCount: 1 })),
      release,
    );
    const db = { query: vi.fn(), connect: vi.fn(async () => client) };

    await run(db as never, new AbortController().signal);
    expect(db.connect).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith();
  });

  it.each([
    ['BEGIN', false],
    ['SET LOCAL', false],
    ['SELECT id FROM accounts', false],
    ['SELECT id FROM characters', false],
    ['pg_advisory_xact_lock', false],
    ['COMMIT', true],
  ] as const)(
    'destroys an aborted begin transaction during %s and reports commit ambiguity=%s',
    async (blockedText, commitMayHaveSucceeded) => {
      let rejectActive: ((error: unknown) => void) | undefined;
      const calls: string[] = [];
      const query = vi.fn(async (text: string): Promise<QueryResult> => {
        calls.push(text);
        if (text.includes(blockedText)) {
          return new Promise<QueryResult>((_resolve, reject) => {
            rejectActive = reject;
          });
        }
        if (text.includes('INSERT INTO storage_purchases')) {
          return { rows: [RAW_ROW], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
      const release = vi.fn((error?: Error | boolean) => {
        if (error instanceof Error) rejectActive?.(new Error('socket destroyed'));
      });
      const client = clientWithQuery(query, release);
      const db = { query, connect: vi.fn(async () => client) };
      const controller = new AbortController();
      const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
      const pending = beginStoragePurchase(db, ROW, controller.signal);
      const rejection = expect(pending).rejects.toMatchObject({
        name: 'DbTransactionAborted',
        code: 'DB_TRANSACTION_ABORTED',
        commitMayHaveSucceeded,
      });

      await vi.waitFor(() => expect(calls.some((text) => text.includes(blockedText))).toBe(true));
      controller.abort();
      await rejection;
      expect(release).toHaveBeenCalledTimes(1);
      expect(release.mock.calls[0][0]).toBeInstanceOf(DbTransactionAborted);
      expect(calls.some((text) => text === 'ROLLBACK')).toBe(false);
      expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    },
  );
});
