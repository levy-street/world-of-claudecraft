import { EventEmitter } from 'node:events';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { bankLedgerGrowthBudgetReadout } from '../../server/bank_ledger_growth_budget';
import {
  BANK_LEDGER_GROWTH_MONITOR_INTERVAL_MS,
  BANK_LEDGER_GROWTH_MONITOR_STATEMENT_TIMEOUT_MS,
  BANK_LEDGER_GROWTH_MONITOR_WALL_TIMEOUT_MS,
  BANK_LEDGER_GROWTH_WARN_FRACTION,
  type BankLedgerGrowthMonitorClient,
  type BankLedgerGrowthMonitorPool,
  BankLedgerGrowthMonitorPoolBusy,
  bankLedgerGrowthWarningActive,
  createBankLedgerGrowthMonitor,
  createBankLedgerGrowthWarnLatch,
  readBankLedgerGrowthBudget,
} from '../../server/bank_ledger_growth_monitor';

const result = <Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> =>
  ({ rows, rowCount: rows.length }) as QueryResult<Row>;

function clientWithQuery(
  query: BankLedgerGrowthMonitorClient['query'],
  release = vi.fn<(error?: Error | boolean) => void>(),
): BankLedgerGrowthMonitorClient {
  const events = new EventEmitter();
  return {
    query,
    release,
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  };
}

function availablePool(
  connect: BankLedgerGrowthMonitorPool['connect'] = vi.fn(),
): BankLedgerGrowthMonitorPool {
  return {
    connect,
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    options: { max: 1 },
  };
}

describe('bank-ledger growth monitor', () => {
  it('pins its low-frequency and fail-fast bounds', () => {
    expect(BANK_LEDGER_GROWTH_MONITOR_INTERVAL_MS).toBe(60_000);
    expect(BANK_LEDGER_GROWTH_MONITOR_WALL_TIMEOUT_MS).toBe(1_500);
    expect(BANK_LEDGER_GROWTH_MONITOR_STATEMENT_TIMEOUT_MS).toBe(1_000);
  });

  it('reads the singleton under an owned server timeout and resets the client', async () => {
    const release = vi.fn();
    const queryMock = vi.fn(async (text: string) => {
      if (text.includes('SELECT committed_rows')) {
        return result([{ committed_rows: '123', hard_limit_rows: '10000000' }]);
      }
      return result([]);
    });
    const query = queryMock as BankLedgerGrowthMonitorClient['query'];
    const client = clientWithQuery(query, release);

    await expect(
      readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client))),
    ).resolves.toEqual({ committedRows: '123', hardLimitRows: '10000000' });
    expect(queryMock.mock.calls.map(([text]) => text)).toEqual([
      'SET statement_timeout = 1000',
      expect.stringContaining('WHERE singleton = TRUE'),
      'RESET statement_timeout',
    ]);
    const selectSql = queryMock.mock.calls[1]?.[0];
    expect(selectSql).toMatch(/SELECT\s+committed_rows,\s*hard_limit_rows/);
    expect(selectSql).toMatch(/FROM\s+public\.bank_ledger_growth_budget/);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith();
  });

  it.each([0, 2])('rejects a singleton query that returns %i rows', async (rowCount) => {
    const release = vi.fn();
    const rows = Array.from({ length: rowCount }, (_, index) => ({
      committed_rows: index,
      hard_limit_rows: 10_000_000,
    }));
    const queryMock = vi.fn(async (text: string) => {
      if (text.includes('SELECT committed_rows')) return result(rows);
      return result([]);
    });
    const client = clientWithQuery(queryMock as BankLedgerGrowthMonitorClient['query'], release);

    await expect(
      readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client))),
    ).rejects.toThrow('bank ledger growth budget singleton is missing or duplicated');
    expect(queryMock.mock.calls.map(([text]) => text)).toEqual([
      'SET statement_timeout = 1000',
      expect.stringContaining('WHERE singleton = TRUE'),
      'RESET statement_timeout',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith();
  });

  it('keeps a known read when RESET fails and poisons only that client', async () => {
    const resetError = new Error('reset failed');
    const release = vi.fn();
    const query = vi.fn(async (text: string) => {
      if (text === 'RESET statement_timeout') throw resetError;
      if (text.includes('SELECT committed_rows')) {
        return result([{ committed_rows: 77, hard_limit_rows: 10_000_000 }]);
      }
      return result([]);
    }) as BankLedgerGrowthMonitorClient['query'];
    const client = clientWithQuery(query, release);

    await expect(
      readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client))),
    ).resolves.toEqual({ committedRows: 77, hardLimitRows: 10_000_000 });
    expect(release).toHaveBeenCalledWith(resetError);
  });

  it('poisons a client when installing the server timeout fails', async () => {
    const setError = Object.assign(new Error('cannot set timeout'), { code: '57P01' });
    const release = vi.fn();
    const queryMock = vi.fn(async () => Promise.reject(setError));
    const client = clientWithQuery(queryMock as BankLedgerGrowthMonitorClient['query'], release);

    await expect(readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client)))).rejects.toBe(
      setError,
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(setError);
  });

  it('resets and reuses the client after a completed SQLSTATE failure', async () => {
    const pgError = Object.assign(new Error('statement timeout'), { code: '57014' });
    const release = vi.fn();
    const queryMock = vi.fn(async (text: string) => {
      if (text.startsWith('SET ') || text === 'RESET statement_timeout') return result([]);
      throw pgError;
    });
    const client = clientWithQuery(queryMock as BankLedgerGrowthMonitorClient['query'], release);

    await expect(readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client)))).rejects.toBe(
      pgError,
    );
    expect(queryMock.mock.calls.map(([text]) => text)).toEqual([
      'SET statement_timeout = 1000',
      expect.stringContaining('SELECT committed_rows'),
      'RESET statement_timeout',
    ]);
    expect(release).toHaveBeenCalledWith();
  });

  it('poisons the client when a codeless SELECT failure cannot prove protocol recovery', async () => {
    const selectError = new Error('socket closed during SELECT');
    const release = vi.fn();
    const queryMock = vi.fn(async (text: string) => {
      if (text.startsWith('SET ')) return result([]);
      throw selectError;
    });
    const client = clientWithQuery(queryMock as BankLedgerGrowthMonitorClient['query'], release);

    await expect(readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client)))).rejects.toBe(
      selectError,
    );
    expect(queryMock.mock.calls.map(([text]) => text)).toEqual([
      'SET statement_timeout = 1000',
      expect.stringContaining('SELECT committed_rows'),
    ]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(selectError);
  });

  it('poisons the client when RESET fails after a SQLSTATE SELECT failure', async () => {
    const selectError = Object.assign(new Error('statement timeout'), { code: '57014' });
    const resetError = new Error('connection lost during RESET');
    const release = vi.fn();
    const queryMock = vi.fn(async (text: string) => {
      if (text.startsWith('SET ')) return result([]);
      if (text === 'RESET statement_timeout') throw resetError;
      throw selectError;
    });
    const client = clientWithQuery(queryMock as BankLedgerGrowthMonitorClient['query'], release);

    await expect(readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client)))).rejects.toBe(
      selectError,
    );
    expect(queryMock.mock.calls.map(([text]) => text)).toEqual([
      'SET statement_timeout = 1000',
      expect.stringContaining('SELECT committed_rows'),
      'RESET statement_timeout',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(resetError);
  });

  it('rejects a pre-aborted read without attempting pool checkout', async () => {
    const controller = new AbortController();
    controller.abort();
    const connect = vi.fn();

    await expect(
      readBankLedgerGrowthBudget(availablePool(connect), controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
      code: 'BANK_LEDGER_GROWTH_MONITOR_ABORTED',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('propagates a synchronous pool checkout failure', async () => {
    const checkoutError = new Error('pool is closed');
    const connect = vi.fn(() => {
      throw checkoutError;
    });

    await expect(readBankLedgerGrowthBudget(availablePool(connect))).rejects.toBe(checkoutError);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('propagates an asynchronous pool checkout failure', async () => {
    const checkoutError = new Error('checkout rejected');
    const connect = vi.fn(async () => Promise.reject(checkoutError));

    await expect(readBankLedgerGrowthBudget(availablePool(connect))).rejects.toBe(checkoutError);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'an existing waiter',
      totalCount: 1,
      idleCount: 1,
      waitingCount: 1,
      max: 1,
    },
    {
      label: 'a full pool with no idle client',
      totalCount: 1,
      idleCount: 0,
      waitingCount: 0,
      max: 1,
    },
  ])('refuses checkout without queueing behind $label', async (occupancy) => {
    const connect = vi.fn();
    const pool: BankLedgerGrowthMonitorPool = {
      connect,
      totalCount: occupancy.totalCount,
      idleCount: occupancy.idleCount,
      waitingCount: occupancy.waitingCount,
      options: { max: occupancy.max },
    };

    await expect(readBankLedgerGrowthBudget(pool)).rejects.toBeInstanceOf(
      BankLedgerGrowthMonitorPoolBusy,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('borrows an idle client when the pool is fully grown but not saturated', async () => {
    const release = vi.fn();
    const queryMock = vi.fn(async (text: string) => {
      if (text.includes('SELECT committed_rows')) {
        return result([{ committed_rows: 321, hard_limit_rows: 10_000_000 }]);
      }
      return result([]);
    });
    const client = clientWithQuery(queryMock as BankLedgerGrowthMonitorClient['query'], release);
    const connect = vi.fn(async () => client);
    const pool: BankLedgerGrowthMonitorPool = {
      connect,
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      options: { max: 1 },
    };

    await expect(readBankLedgerGrowthBudget(pool)).resolves.toEqual({
      committedRows: 321,
      hardLimitRows: 10_000_000,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith();
  });

  it('rejects a cancelled checkout and destroys the client if it arrives later', async () => {
    let resolveCheckout!: (client: BankLedgerGrowthMonitorClient) => void;
    const checkout = new Promise<BankLedgerGrowthMonitorClient>((resolve) => {
      resolveCheckout = resolve;
    });
    const pool = availablePool(vi.fn(() => checkout));
    const controller = new AbortController();
    const pending = readBankLedgerGrowthBudget(pool, controller.signal);
    await vi.waitFor(() => expect(pool.connect).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    const query = vi.fn();
    const release = vi.fn();
    resolveCheckout(clientWithQuery(query as BankLedgerGrowthMonitorClient['query'], release));
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(query).not.toHaveBeenCalled();
    expect(release.mock.calls[0]?.[0]).toMatchObject({ name: 'AbortError' });
  });

  it('aborts an active read and destroys its checked-out client', async () => {
    let rejectRead: ((error: Error) => void) | null = null;
    const release = vi.fn((error?: Error | boolean) => {
      if (error instanceof Error) rejectRead?.(error);
    });
    const query = vi.fn((text: string) => {
      if (text.startsWith('SET statement_timeout')) return Promise.resolve(result([]));
      return new Promise<QueryResult>((_resolve, reject) => {
        rejectRead = reject;
      });
    }) as BankLedgerGrowthMonitorClient['query'];
    const client = clientWithQuery(query, release);
    const controller = new AbortController();
    const pending = readBankLedgerGrowthBudget(
      availablePool(vi.fn(async () => client)),
      controller.signal,
    );

    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      code: 'BANK_LEDGER_GROWTH_MONITOR_ABORTED',
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[0]).toMatchObject({ name: 'AbortError' });
  });

  it('destroys the checked-out client when it emits an error during SELECT', async () => {
    const clientError = Object.assign(new Error('connection terminated'), { code: '57P01' });
    const events = new EventEmitter();
    let rejectRead: ((error: Error) => void) | null = null;
    const release = vi.fn((error?: Error | boolean) => {
      if (error instanceof Error) rejectRead?.(error);
    });
    const query = vi.fn((text: string) => {
      if (text.startsWith('SET statement_timeout')) return Promise.resolve(result([]));
      return new Promise<QueryResult>((_resolve, reject) => {
        rejectRead = reject;
      });
    }) as BankLedgerGrowthMonitorClient['query'];
    const client: BankLedgerGrowthMonitorClient = {
      query,
      release,
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
    };
    const pending = readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client)));
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));

    events.emit('error', clientError);

    await expect(pending).rejects.toBe(clientError);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(clientError);
    expect(events.listenerCount('error')).toBe(0);
  });

  it('enforces its own wall deadline without an outer abort', async () => {
    vi.useFakeTimers();
    try {
      let rejectRead: ((error: Error) => void) | null = null;
      const release = vi.fn((error?: Error | boolean) => {
        if (error instanceof Error) rejectRead?.(error);
      });
      const query = vi.fn((text: string) => {
        if (text.startsWith('SET statement_timeout')) return Promise.resolve(result([]));
        return new Promise<QueryResult>((_resolve, reject) => {
          rejectRead = reject;
        });
      }) as BankLedgerGrowthMonitorClient['query'];
      const client = clientWithQuery(query, release);
      const pending = readBankLedgerGrowthBudget(availablePool(vi.fn(async () => client)));
      const rejection = expect(pending).rejects.toMatchObject({
        name: 'AbortError',
        code: 'BANK_LEDGER_GROWTH_MONITOR_ABORTED',
        message: expect.stringContaining('timed out'),
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(query).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(BANK_LEDGER_GROWTH_MONITOR_WALL_TIMEOUT_MS);

      await rejection;
      expect(release).toHaveBeenCalledTimes(1);
      expect(release.mock.calls[0]?.[0]).toMatchObject({ name: 'AbortError' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces overlapping refreshes and releases admission after observation', async () => {
    let resolveRead!: (row: { committedRows: number; hardLimitRows: number }) => void;
    const held = new Promise<{ committedRows: number; hardLimitRows: number }>((resolve) => {
      resolveRead = resolve;
    });
    const read = vi.fn(async () => held);
    const release = vi.fn();
    const observe = vi.fn(() => true);
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: vi.fn(() => ({ release })),
      read,
      observe,
    });

    const first = monitor.refresh();
    const second = monitor.refresh();
    expect(second).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    resolveRead({ committedRows: 456, hardLimitRows: 10_000_000 });
    await Promise.all([first, second]);

    expect(observe).toHaveBeenCalledWith(456, 10_000_000);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('rejects an invalid %s refresh interval', (_label, intervalMs) => {
    expect(() =>
      createBankLedgerGrowthMonitor({
        pool: availablePool(),
        tryAcquireBackgroundPermit: () => null,
        intervalMs,
      }),
    ).toThrow('bank ledger growth monitor interval must be a positive safe integer');
  });

  it('start refreshes immediately, coalesces a busy tick, and schedules the next interval', async () => {
    vi.useFakeTimers();
    try {
      const resolvers: Array<(row: { committedRows: number; hardLimitRows: number }) => void> = [];
      const read = vi.fn(
        async () =>
          new Promise<{ committedRows: number; hardLimitRows: number }>((resolve) => {
            resolvers.push(resolve);
          }),
      );
      const release = vi.fn();
      const monitor = createBankLedgerGrowthMonitor({
        pool: availablePool(),
        tryAcquireBackgroundPermit: () => ({ release }),
        read,
        observe: () => true,
        intervalMs: 100,
      });

      monitor.start();
      monitor.start();
      expect(read).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(read).toHaveBeenCalledTimes(1);

      resolvers[0]?.({ committedRows: 1, hardLimitRows: 10_000_000 });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(read).toHaveBeenCalledTimes(2);

      resolvers[1]?.({ committedRows: 2, hardLimitRows: 10_000_000 });
      await vi.advanceTimersByTimeAsync(0);
      await monitor.stop();
      expect(release).toHaveBeenCalledTimes(2);

      monitor.start();
      await monitor.refresh();
      await vi.advanceTimersByTimeAsync(500);
      await monitor.stop();
      expect(read).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('projects a successful default observation into the scrape readout', async () => {
    const release = vi.fn();
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read: async () => ({ committedRows: 7_654_321, hardLimitRows: 10_000_000 }),
    });

    await monitor.refresh();

    expect(bankLedgerGrowthBudgetReadout()).toMatchObject({
      committedRows: 7_654_321,
      hardLimitRows: 10_000_000,
      observedAtMs: expect.any(Number),
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('skips rather than queues when the shared background gate is full', async () => {
    const read = vi.fn();
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => null,
      read,
    });

    await monitor.refresh();

    expect(read).not.toHaveBeenCalled();
  });

  it('isolates a throwing shared-permit acquisition from the refresh loop', async () => {
    const acquireError = new Error('background gate unavailable');
    const read = vi.fn();
    const onError = vi.fn();
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: vi.fn(() => {
        throw acquireError;
      }),
      read,
      onError,
    });

    await expect(monitor.refresh()).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(acquireError);
  });

  it('silently yields its permit without checkout when the database pool is saturated', async () => {
    const connect = vi.fn();
    const release = vi.fn();
    const onError = vi.fn();
    const monitor = createBankLedgerGrowthMonitor({
      pool: {
        connect,
        totalCount: 1,
        idleCount: 0,
        waitingCount: 0,
        options: { max: 1 },
      },
      tryAcquireBackgroundPermit: () => ({ release }),
      onError,
    });

    await monitor.refresh();

    expect(connect).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports malformed durable values and does not treat them as a healthy refresh', async () => {
    const release = vi.fn();
    const onError = vi.fn();
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read: async () => ({ committedRows: 'bad', hardLimitRows: 10_000_000 }),
      observe: () => false,
      onError,
    });

    await monitor.refresh();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('invalid durable budget values'),
      }),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('logs only once per failure streak and resets suppression after success', async () => {
    const firstFailure = new Error('first failure');
    const duplicateFailure = new Error('duplicate failure');
    const nextStreakFailure = new Error('next streak failure');
    const read = vi
      .fn()
      .mockRejectedValueOnce(firstFailure)
      .mockRejectedValueOnce(duplicateFailure)
      .mockResolvedValueOnce({ committedRows: 10, hardLimitRows: 10_000_000 })
      .mockRejectedValueOnce(nextStreakFailure);
    const release = vi.fn();
    const onError = vi.fn();
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read,
      observe: () => true,
      onError,
    });

    await monitor.refresh();
    await monitor.refresh();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenNthCalledWith(1, firstFailure);

    await monitor.refresh();
    await monitor.refresh();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(2, nextStreakFailure);
    expect(release).toHaveBeenCalledTimes(4);
  });

  it('isolates a throwing diagnostic sink from refresh and permit cleanup', async () => {
    const readError = new Error('read failed');
    const release = vi.fn();
    const onError = vi.fn(() => {
      throw new Error('diagnostic sink failed');
    });
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read: async () => Promise.reject(readError),
      onError,
    });

    await expect(monitor.refresh()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(readError);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('stop does not return until an aborted in-flight refresh has drained', async () => {
    const release = vi.fn();
    let readSignal: AbortSignal | null = null;
    let finishRead!: (row: { committedRows: number; hardLimitRows: number }) => void;
    const read = vi.fn(
      async (_pool: unknown, signal: AbortSignal) =>
        new Promise<{ committedRows: number; hardLimitRows: number }>((resolve) => {
          readSignal = signal;
          finishRead = resolve;
        }),
    );
    const observe = vi.fn(() => true);
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read,
      observe,
    });
    const refresh = monitor.refresh();
    await vi.waitFor(() => expect(readSignal).not.toBeNull());

    let stopReturned = false;
    const stop = monitor.stop().then(() => {
      stopReturned = true;
    });
    await vi.waitFor(() => expect((readSignal as AbortSignal | null)?.aborted).toBe(true));
    await Promise.resolve();
    expect(stopReturned).toBe(false);

    finishRead({ committedRows: 999, hardLimitRows: 10_000_000 });
    await stop;

    await refresh;
    expect(stopReturned).toBe(true);
    expect(observe).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

// The warn arm: without it the first operator signal for a filling ledger is
// players being refused at the ceiling. The latch turns the once-per-minute
// observation stream into ONE console.warn per process crossing; the alertable
// signal is the limit_warning measure on woc_bank_ledger_growth_budget.
describe('bank-ledger growth warn latch', () => {
  it('pins the warn fraction and the crossing predicate boundary', () => {
    expect(BANK_LEDGER_GROWTH_WARN_FRACTION).toBe(0.8);
    // Raw driver values (BIGINT arrives as a string) and plain numbers both
    // decode; the crossing is INCLUSIVE at exactly the fraction.
    expect(bankLedgerGrowthWarningActive('7999999', '10000000')).toBe(false);
    expect(bankLedgerGrowthWarningActive('8000000', '10000000')).toBe(true);
    expect(bankLedgerGrowthWarningActive(8_000_000, 10_000_000)).toBe(true);
    expect(bankLedgerGrowthWarningActive(10_000_001, 10_000_000)).toBe(true);
    // Malformed values read as not-warning: the monitor separately fails the
    // refresh on them, and the gauge must not invent a warning from garbage.
    expect(bankLedgerGrowthWarningActive(null, 10_000_000)).toBe(false);
    expect(bankLedgerGrowthWarningActive(undefined, 10_000_000)).toBe(false);
    expect(bankLedgerGrowthWarningActive('not-a-count', '10000000')).toBe(false);
    expect(bankLedgerGrowthWarningActive('8000000', '')).toBe(false);
    expect(bankLedgerGrowthWarningActive('8000000', 0)).toBe(false);
    expect(bankLedgerGrowthWarningActive(-1, 10_000_000)).toBe(false);
  });

  it('warns once per crossing, stays silent while held, and re-arms below', () => {
    const warn = vi.fn<(message: string) => void>();
    const latch = createBankLedgerGrowthWarnLatch(warn);

    // Below the fraction: nothing.
    latch('7999999', '10000000');
    expect(warn).not.toHaveBeenCalled();

    // The crossing: exactly one line, carrying the evidence and the series
    // name an operator alerts on.
    latch('8000000', '10000000');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('0.8');
    expect(warn.mock.calls[0]?.[0]).toContain('8000000 of 10000000');
    expect(warn.mock.calls[0]?.[0]).toContain('limit_warning');

    // Held above: latched, no repeats however long the condition lasts.
    latch('8000001', '10000000');
    latch('9999999', '10000000');
    expect(warn).toHaveBeenCalledTimes(1);

    // Dropping back below re-arms (a raised limit after the mandated restart,
    // or a re-seeded singleton), so the NEXT crossing warns again.
    latch('7000000', '10000000');
    expect(warn).toHaveBeenCalledTimes(1);
    latch('8500000', '10000000');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('the monitor drives the latch only from an ACCEPTED observation', async () => {
    const warn = vi.fn<(message: string) => void>();
    const release = vi.fn();
    let row = { committedRows: 9_000_000, hardLimitRows: 10_000_000 };
    let accept = false;
    const monitor = createBankLedgerGrowthMonitor({
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read: async () => row,
      observe: () => accept,
      warn,
      onError: () => {},
    });

    // A refused observation (malformed or drifted values) never reaches the
    // latch: a warning must only ever come from validated durable values.
    await monitor.refresh();
    expect(warn).not.toHaveBeenCalled();

    accept = true;
    await monitor.refresh();
    expect(warn).toHaveBeenCalledTimes(1);

    // The latch is per process, not per refresh: the held condition stays at
    // one line across later polls.
    await monitor.refresh();
    expect(warn).toHaveBeenCalledTimes(1);

    // Below the fraction re-arms through the same wiring.
    row = { committedRows: 1_000_000, hardLimitRows: 10_000_000 };
    await monitor.refresh();
    row = { committedRows: 9_500_000, hardLimitRows: 10_000_000 };
    await monitor.refresh();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
