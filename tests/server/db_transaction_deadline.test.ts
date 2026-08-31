import { EventEmitter } from 'node:events';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  backendCancelViaPool,
  createDbTransactionDeadline,
  DbTransactionAborted,
  type DbTransactionDeadlineClient,
  DbTransactionDeadlineExceeded,
  type DbTransactionDeadlineScheduler,
  type DbTransactionDeadlineTimer,
} from '../../server/db_transaction_deadline';

const result = <Row extends QueryResultRow = QueryResultRow>(): QueryResult<Row> =>
  ({ rows: [] }) as unknown as QueryResult<Row>;

class FakeTimer implements DbTransactionDeadlineTimer {
  cleared = false;
  readonly unref = vi.fn();

  constructor(
    readonly atMs: number,
    readonly run: () => void,
  ) {}
}

class FakeScheduler implements DbTransactionDeadlineScheduler {
  now = 0;
  readonly timers: FakeTimer[] = [];

  nowMs = (): number => this.now;

  setTimeout = (run: () => void, delayMs: number): FakeTimer => {
    const timer = new FakeTimer(this.now + delayMs, run);
    this.timers.push(timer);
    return timer;
  };

  clearTimeout = (timer: DbTransactionDeadlineTimer): void => {
    (timer as FakeTimer).cleared = true;
  };

  elapse(ms: number): void {
    this.now += ms;
  }

  advance(ms: number): void {
    this.elapse(ms);
    for (const timer of this.timers) {
      if (!timer.cleared && timer.atMs <= this.now) {
        timer.cleared = true;
        timer.run();
      }
    }
  }
}

class FakeClient extends EventEmitter implements DbTransactionDeadlineClient {
  readonly queries: string[] = [];
  readonly releases: Array<Error | boolean | undefined> = [];

  constructor(
    private readonly respond: (text: string) => Promise<QueryResult<QueryResultRow>> = async () =>
      result(),
  ) {
    super();
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: unknown[],
  ): Promise<QueryResult<Row>> {
    this.queries.push(text);
    return (await this.respond(text)) as QueryResult<Row>;
  }

  release(error?: Error | boolean): void {
    this.releases.push(error);
  }
}

const fakeClient = (
  responder?: (text: string) => Promise<QueryResult<QueryResultRow>>,
): FakeClient => {
  return new FakeClient(responder);
};

const owner = (
  client: FakeClient,
  scheduler: FakeScheduler,
  timeoutMs = 100,
  signal?: AbortSignal,
) =>
  createDbTransactionDeadline(client, {
    operation: 'bank save',
    timeoutMs,
    scheduler,
    signal,
  });

describe('database transaction whole-operation deadline', () => {
  it('destroys the checked-out client when an active query reaches the wall deadline', async () => {
    const scheduler = new FakeScheduler();
    const active: { reject?: (error: Error) => void } = {};
    const client = fakeClient((text) =>
      text === 'SELECT slow'
        ? new Promise((_resolve, reject) => {
            active.reject = reject;
          })
        : Promise.resolve(result()),
    );
    const transaction = owner(client, scheduler);
    const pending = transaction.query('SELECT slow');

    scheduler.advance(100);
    const releasedWith = client.releases[0];
    active.reject?.(new Error('Connection terminated'));

    await expect(pending).rejects.toBe(releasedWith);
    expect(releasedWith).toBeInstanceOf(DbTransactionDeadlineExceeded);
    expect(client.releases).toEqual([releasedWith]);
    expect(scheduler.timers[0]?.unref).toHaveBeenCalledOnce();
  });

  it('expires while idle between statements and refuses every later query', async () => {
    const scheduler = new FakeScheduler();
    const client = fakeClient();
    const transaction = owner(client, scheduler);

    await transaction.query('BEGIN');
    scheduler.advance(100);
    const releasedWith = client.releases[0];

    await expect(transaction.query('SELECT 1')).rejects.toBe(releasedWith);
    expect(client.queries).toEqual(['BEGIN']);
    transaction.release();
    expect(client.releases).toEqual([releasedWith]);
  });

  it('clears the timer after a known COMMIT and returns the client once', async () => {
    const scheduler = new FakeScheduler();
    const client = fakeClient();
    const transaction = owner(client, scheduler);

    await transaction.query('BEGIN');
    await transaction.query('UPDATE characters SET state = state');
    await transaction.commit();
    transaction.release();
    scheduler.advance(1_000);

    expect(client.queries).toEqual(['BEGIN', 'UPDATE characters SET state = state', 'COMMIT']);
    expect(client.releases).toEqual([undefined]);
    expect(scheduler.timers[0]?.cleared).toBe(true);
  });

  it('rolls back an early coded query error while time remains', async () => {
    const scheduler = new FakeScheduler();
    const queryError = Object.assign(new Error('unique violation'), { code: '23505' });
    const client = fakeClient((text) =>
      text === 'INSERT' ? Promise.reject(queryError) : Promise.resolve(result()),
    );
    const transaction = owner(client, scheduler);

    await transaction.query('BEGIN');
    await expect(transaction.query('INSERT')).rejects.toBe(queryError);
    await transaction.rollback();
    transaction.release();

    expect(client.queries).toEqual(['BEGIN', 'INSERT', 'ROLLBACK']);
    expect(client.releases).toEqual([undefined]);
  });

  it('destroys instead of starting a rollback after the deadline', async () => {
    const scheduler = new FakeScheduler();
    const client = fakeClient();
    const transaction = owner(client, scheduler);
    await transaction.query('BEGIN');
    scheduler.elapse(101);

    await transaction.rollback();
    transaction.release();

    expect(client.queries).toEqual(['BEGIN']);
    expect(client.releases[0]).toBeInstanceOf(DbTransactionDeadlineExceeded);
    expect(client.releases).toHaveLength(1);
  });

  it('makes completion and final release idempotent', async () => {
    const scheduler = new FakeScheduler();
    const client = fakeClient();
    const transaction = owner(client, scheduler);

    await transaction.query('BEGIN');
    await transaction.commit();
    await transaction.commit();
    await transaction.rollback();
    transaction.release();
    transaction.release();

    expect(client.queries).toEqual(['BEGIN', 'COMMIT']);
    expect(client.releases).toEqual([undefined]);
  });

  it('destroys a client after a codeless query failure without attempting rollback', async () => {
    const scheduler = new FakeScheduler();
    const queryError = new Error('query read timeout');
    const client = fakeClient((text) =>
      text === 'UPDATE' ? Promise.reject(queryError) : Promise.resolve(result()),
    );
    const transaction = owner(client, scheduler);

    await transaction.query('BEGIN');
    await expect(transaction.query('UPDATE')).rejects.toBe(queryError);
    await transaction.rollback();
    transaction.release();

    expect(client.queries).toEqual(['BEGIN', 'UPDATE']);
    expect(client.releases).toEqual([queryError]);
  });

  it('destroys a client when rollback itself fails', async () => {
    const scheduler = new FakeScheduler();
    const rollbackError = Object.assign(new Error('connection failure'), { code: '08006' });
    const client = fakeClient((text) =>
      text === 'ROLLBACK' ? Promise.reject(rollbackError) : Promise.resolve(result()),
    );
    const transaction = owner(client, scheduler);

    await transaction.query('BEGIN');
    await transaction.rollback();
    transaction.release();

    expect(client.queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.releases).toEqual([rollbackError]);
  });

  it('preserves an ambiguous COMMIT error and never sends rollback after forced release', async () => {
    const scheduler = new FakeScheduler();
    const commitError = new Error('connection terminated during COMMIT');
    const client = fakeClient((text) =>
      text === 'COMMIT' ? Promise.reject(commitError) : Promise.resolve(result()),
    );
    const transaction = owner(client, scheduler);
    await transaction.query('BEGIN');

    await expect(transaction.commit()).rejects.toBe(commitError);
    await transaction.rollback();
    transaction.release();

    expect(client.queries).toEqual(['BEGIN', 'COMMIT']);
    expect(client.releases).toEqual([commitError]);
  });

  it('marks a wall deadline reached during COMMIT as outcome-ambiguous', async () => {
    const scheduler = new FakeScheduler();
    const active: { reject?: (error: Error) => void } = {};
    const client = fakeClient((text) =>
      text === 'COMMIT'
        ? new Promise((_resolve, reject) => {
            active.reject = reject;
          })
        : Promise.resolve(result()),
    );
    const transaction = owner(client, scheduler);
    await transaction.query('BEGIN');
    const pendingCommit = transaction.commit();

    scheduler.advance(100);
    const deadlineError = client.releases[0];
    active.reject?.(new Error('Connection terminated'));

    await expect(pendingCommit).rejects.toBe(deadlineError);
    expect(deadlineError).toMatchObject({ commitMayHaveSucceeded: true });
    await transaction.rollback();
    transaction.release();
    expect(client.queries).toEqual(['BEGIN', 'COMMIT']);
    expect(client.releases).toEqual([deadlineError]);
  });

  it('captures an asynchronous checked-out-client error and releases once', async () => {
    const scheduler = new FakeScheduler();
    const client = fakeClient();
    const transaction = owner(client, scheduler);
    const connectionError = Object.assign(new Error('idle transaction terminated'), {
      code: '25P03',
    });

    client.emit('error', connectionError);
    scheduler.advance(1_000);
    transaction.release();

    expect(client.releases).toEqual([connectionError]);
    await expect(transaction.query('SELECT 1')).rejects.toBe(connectionError);
  });

  it('rejects a pre-aborted transaction with a stable owned error before issuing SQL', async () => {
    const scheduler = new FakeScheduler();
    const client = fakeClient();
    const controller = new AbortController();
    controller.abort(new Error('sensitive caller reason'));

    const transaction = owner(client, scheduler, 100, controller.signal);
    const abortError = client.releases[0];

    if (!(abortError instanceof Error)) throw new Error('expected abort release error');
    expect(abortError).toBeInstanceOf(DbTransactionAborted);
    expect(abortError).toMatchObject({
      code: 'DB_TRANSACTION_ABORTED',
      commitMayHaveSucceeded: false,
      message: 'bank save transaction aborted',
      name: 'DbTransactionAborted',
    });
    expect(abortError).not.toHaveProperty('cause');
    expect(abortError.message).not.toContain('sensitive caller reason');
    await expect(transaction.query('BEGIN')).rejects.toBe(abortError);
    expect(client.queries).toEqual([]);
    expect(client.releases).toEqual([abortError]);
    expect(scheduler.timers).toEqual([]);
  });

  it('destroys an idle transaction once when its signal aborts', async () => {
    const scheduler = new FakeScheduler();
    const client = fakeClient();
    const controller = new AbortController();
    const transaction = owner(client, scheduler, 100, controller.signal);
    await transaction.query('BEGIN');

    controller.abort();
    const abortError = client.releases[0];

    expect(abortError).toBeInstanceOf(DbTransactionAborted);
    expect(abortError).toMatchObject({ commitMayHaveSucceeded: false });
    await expect(transaction.query('SELECT 1')).rejects.toBe(abortError);
    transaction.release();
    scheduler.advance(1_000);
    expect(client.queries).toEqual(['BEGIN']);
    expect(client.releases).toEqual([abortError]);
  });

  it('keeps an active-statement abort causal over the later driver socket error', async () => {
    const scheduler = new FakeScheduler();
    const active: { reject?: (error: Error) => void } = {};
    const client = fakeClient((text) =>
      text === 'SELECT slow'
        ? new Promise((_resolve, reject) => {
            active.reject = reject;
          })
        : Promise.resolve(result()),
    );
    const controller = new AbortController();
    const transaction = owner(client, scheduler, 100, controller.signal);
    const pending = transaction.query('SELECT slow');

    controller.abort();
    const abortError = client.releases[0];
    const laterSocketError = new Error('distinct later driver socket error');
    active.reject?.(laterSocketError);

    await expect(pending).rejects.toBe(abortError);
    expect(abortError).toBeInstanceOf(DbTransactionAborted);
    expect(abortError).toMatchObject({ commitMayHaveSucceeded: false });
    expect(abortError).not.toBe(laterSocketError);
    expect(client.releases).toEqual([abortError]);
  });

  it('marks only an active COMMIT abort as outcome-ambiguous', async () => {
    const scheduler = new FakeScheduler();
    const active: { reject?: (error: Error) => void } = {};
    const client = fakeClient((text) =>
      text === 'COMMIT'
        ? new Promise((_resolve, reject) => {
            active.reject = reject;
          })
        : Promise.resolve(result()),
    );
    const controller = new AbortController();
    const transaction = owner(client, scheduler, 100, controller.signal);
    await transaction.query('BEGIN');
    const pendingCommit = transaction.commit();

    controller.abort();
    const abortError = client.releases[0];
    const laterSocketError = new Error('driver error after COMMIT socket destruction');
    active.reject?.(laterSocketError);

    await expect(pendingCommit).rejects.toBe(abortError);
    expect(abortError).toBeInstanceOf(DbTransactionAborted);
    expect(abortError).toMatchObject({ commitMayHaveSucceeded: true });
    expect(abortError).not.toBe(laterSocketError);
    await transaction.rollback();
    transaction.release();
    expect(client.releases).toEqual([abortError]);
  });

  it('keeps the first terminal cause across abort and deadline races', async () => {
    const abortFirstScheduler = new FakeScheduler();
    const abortFirstActive: { reject?: (error: Error) => void } = {};
    const abortFirstClient = fakeClient(
      () =>
        new Promise((_resolve, reject) => {
          abortFirstActive.reject = reject;
        }),
    );
    const abortFirstController = new AbortController();
    const abortFirst = owner(
      abortFirstClient,
      abortFirstScheduler,
      100,
      abortFirstController.signal,
    );
    const abortFirstPending = abortFirst.query('SELECT slow');
    abortFirstController.abort();
    const abortWon = abortFirstClient.releases[0];
    abortFirstScheduler.advance(100);
    abortFirstActive.reject?.(new Error('socket closed after abort'));
    await expect(abortFirstPending).rejects.toBe(abortWon);
    expect(abortWon).toBeInstanceOf(DbTransactionAborted);
    expect(abortFirstClient.releases).toEqual([abortWon]);

    const deadlineFirstScheduler = new FakeScheduler();
    const deadlineFirstActive: { reject?: (error: Error) => void } = {};
    const deadlineFirstClient = fakeClient(
      () =>
        new Promise((_resolve, reject) => {
          deadlineFirstActive.reject = reject;
        }),
    );
    const deadlineFirstController = new AbortController();
    const deadlineFirst = owner(
      deadlineFirstClient,
      deadlineFirstScheduler,
      100,
      deadlineFirstController.signal,
    );
    const deadlineFirstPending = deadlineFirst.query('SELECT slow');
    deadlineFirstScheduler.advance(100);
    const deadlineWon = deadlineFirstClient.releases[0];
    deadlineFirstController.abort();
    deadlineFirstActive.reject?.(new Error('socket closed after deadline'));
    await expect(deadlineFirstPending).rejects.toBe(deadlineWon);
    expect(deadlineWon).toBeInstanceOf(DbTransactionDeadlineExceeded);
    expect(deadlineFirstClient.releases).toEqual([deadlineWon]);
  });

  it('detaches the abort listener after commit, rollback, and release', async () => {
    for (const completion of ['commit', 'rollback', 'release'] as const) {
      const scheduler = new FakeScheduler();
      const client = fakeClient();
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
      const transaction = owner(client, scheduler, 100, controller.signal);
      await transaction.query('BEGIN');

      if (completion === 'commit') await transaction.commit();
      if (completion === 'rollback') await transaction.rollback();
      if (completion === 'release') transaction.release();

      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
      const releaseCount = client.releases.length;
      controller.abort();
      expect(client.releases).toHaveLength(releaseCount);

      if (completion !== 'release') transaction.release();
      expect(client.releases).toHaveLength(1);
      removeListener.mockRestore();
    }
  });

  it('ignores abort after a known commit and returns the client normally', async () => {
    const scheduler = new FakeScheduler();
    const client = fakeClient();
    const controller = new AbortController();
    const transaction = owner(client, scheduler, 100, controller.signal);

    await transaction.query('BEGIN');
    await transaction.commit();
    controller.abort();
    transaction.release();

    expect(client.queries).toEqual(['BEGIN', 'COMMIT']);
    expect(client.releases).toEqual([undefined]);
  });

  it('accepts a real pg PoolClient structurally', () => {
    const acceptsPoolClient = (client: PoolClient): void => {
      const scheduler = new FakeScheduler();
      createDbTransactionDeadline(client, { timeoutMs: 100, scheduler });
    };
    expect(acceptsPoolClient).toBeTypeOf('function');
  });
});

describe('best-effort backend cancellation on socket destruction', () => {
  const pidClient = (
    pid: number | undefined,
    responder?: (text: string) => Promise<QueryResult<QueryResultRow>>,
  ): FakeClient => {
    const client = fakeClient(responder);
    (client as { processID?: number }).processID = pid;
    return client;
  };
  const cancellingOwner = (
    client: FakeClient,
    scheduler: FakeScheduler,
    cancelBackend: (processId: number) => Promise<void>,
    signal?: AbortSignal,
  ) =>
    createDbTransactionDeadline(client, {
      operation: 'bank save',
      timeoutMs: 100,
      scheduler,
      signal,
      cancelBackend,
    });

  it('cancels the detached backend exactly once with its pid on expiry', async () => {
    const scheduler = new FakeScheduler();
    const client = pidClient(4242);
    const cancelBackend = vi.fn(async () => {});
    const transaction = cancellingOwner(client, scheduler, cancelBackend);

    await transaction.query('BEGIN');
    scheduler.advance(100);

    expect(cancelBackend).toHaveBeenCalledTimes(1);
    expect(cancelBackend).toHaveBeenCalledWith(4242);
    expect(client.releases[0]).toBeInstanceOf(DbTransactionDeadlineExceeded);
    // A later refused query must not re-cancel: the destruction was one event.
    await expect(transaction.query('SELECT 1')).rejects.toBeInstanceOf(
      DbTransactionDeadlineExceeded,
    );
    expect(cancelBackend).toHaveBeenCalledTimes(1);
  });

  it('cancels the detached backend once when an idle abort destroys the socket', async () => {
    const scheduler = new FakeScheduler();
    const client = pidClient(77);
    const cancelBackend = vi.fn(async () => {});
    const controller = new AbortController();
    const transaction = cancellingOwner(client, scheduler, cancelBackend, controller.signal);

    await transaction.query('BEGIN');
    controller.abort();

    expect(cancelBackend).toHaveBeenCalledTimes(1);
    expect(cancelBackend).toHaveBeenCalledWith(77);
    expect(client.releases[0]).toBeInstanceOf(DbTransactionAborted);
    expect(transaction).toBeDefined();
  });

  it('swallows a rejecting hook without replacing the primary outcome', async () => {
    const scheduler = new FakeScheduler();
    const client = pidClient(9);
    const cancelBackend = vi.fn(async () => {
      throw new Error('cancellation connection refused');
    });
    const transaction = cancellingOwner(client, scheduler, cancelBackend);

    await transaction.query('BEGIN');
    scheduler.advance(100);
    // Let the rejected hook promise settle; the swallow must keep the
    // deadline error causal and raise no unhandled rejection.
    await Promise.resolve();
    await Promise.resolve();

    expect(cancelBackend).toHaveBeenCalledTimes(1);
    expect(client.releases[0]).toBeInstanceOf(DbTransactionDeadlineExceeded);
    await expect(transaction.query('SELECT 1')).rejects.toBeInstanceOf(
      DbTransactionDeadlineExceeded,
    );
  });

  it('never cancels when the transaction completes cleanly', async () => {
    const scheduler = new FakeScheduler();
    const client = pidClient(4242);
    const cancelBackend = vi.fn(async () => {});
    const transaction = cancellingOwner(client, scheduler, cancelBackend);

    await transaction.query('BEGIN');
    await transaction.commit();
    transaction.release();

    expect(cancelBackend).not.toHaveBeenCalled();
    expect(client.releases).toEqual([undefined]);
  });

  it('backendCancelViaPool cancels only an actively executing backend by pid', async () => {
    // The state = 'active' guard narrows the pid-reuse window: an idle reused
    // pid is spared, and the parameter binds the pid rather than interpolating
    // it. Pin the exact SQL so a reworded cancel is a conscious edit here too.
    const query = vi.fn(async (): Promise<unknown> => ({ rows: [] }));
    await backendCancelViaPool({ query })(4242);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid = $1 AND state = 'active'",
      [4242],
    );
  });

  it('skips the hook when the client exposes no backend pid', async () => {
    const scheduler = new FakeScheduler();
    const client = pidClient(undefined);
    const cancelBackend = vi.fn(async () => {});
    const transaction = cancellingOwner(client, scheduler, cancelBackend);

    await transaction.query('BEGIN');
    scheduler.advance(100);

    expect(cancelBackend).not.toHaveBeenCalled();
    expect(client.releases[0]).toBeInstanceOf(DbTransactionDeadlineExceeded);
    expect(transaction).toBeDefined();
  });
});
