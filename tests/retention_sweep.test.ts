import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRetentionSweep,
  RETENTION_SWEEP_ADVISORY_LOCK_KEY,
  RETENTION_SWEEP_BATCH_SIZE,
  RETENTION_SWEEP_POLL_MS,
  type RetentionOnlineSamples,
  type RetentionSweepDeps,
  type RetentionSweepLockClient,
  type RetentionTable,
  retentionBatchVerdict,
  retentionSweepDue,
  utcDayOf,
} from '../server/retention_sweep';

describe('retention sweep constants', () => {
  it('pins the advisory lock key, batch size, and poll interval to their literals', () => {
    // A constant compared against itself proves nothing, so assert the literals:
    // changing any of them then has to be a deliberate edit that reddens this pin.
    expect(RETENTION_SWEEP_ADVISORY_LOCK_KEY).toBe(0x57_4f_43_02);
    // db.ts holds the sibling schema advisory key "WOC\x01" as a module-private
    // constant, so the collision check pins the sibling's literal here too.
    expect(RETENTION_SWEEP_ADVISORY_LOCK_KEY).not.toBe(0x57_4f_43_01);
    expect(RETENTION_SWEEP_BATCH_SIZE).toBe(1000);
    expect(RETENTION_SWEEP_POLL_MS).toBe(60_000);
  });
});

describe('utcDayOf', () => {
  it('returns the ISO date prefix of the UTC timestamp', () => {
    expect(utcDayOf(new Date('2026-01-05T23:59:59Z'))).toBe('2026-01-05');
    expect(utcDayOf(new Date('2026-01-06T00:00:00Z'))).toBe('2026-01-06');
  });
});

describe('retentionSweepDue', () => {
  it('is not due before the target hour', () => {
    expect(retentionSweepDue(new Date('2026-01-05T03:59:59Z'), 4, null)).toBe(false);
  });

  it('is due at the target hour', () => {
    expect(retentionSweepDue(new Date('2026-01-05T04:00:00Z'), 4, null)).toBe(true);
  });

  it('is still due hours after the target hour: a late wake re-arms, never misses', () => {
    // The gate compares the current hour with >=, not equality, so a process
    // that slept through 04:00 still owes the day its sweep at 09:30.
    expect(retentionSweepDue(new Date('2026-01-05T09:30:00Z'), 4, null)).toBe(true);
  });

  it('is not due again the same UTC day after firing', () => {
    expect(retentionSweepDue(new Date('2026-01-05T04:01:00Z'), 4, '2026-01-05')).toBe(false);
    expect(retentionSweepDue(new Date('2026-01-05T23:59:59Z'), 4, '2026-01-05')).toBe(false);
  });

  it('re-arms on the next UTC day', () => {
    expect(retentionSweepDue(new Date('2026-01-06T04:00:00Z'), 4, '2026-01-05')).toBe(true);
  });

  it('fires from midnight when utcHour is 0', () => {
    expect(retentionSweepDue(new Date('2026-01-05T00:00:00Z'), 0, '2026-01-04')).toBe(true);
  });

  it('treats the UTC day boundary exactly: 23:xx fired-day is quiet, 00:xx next day fires', () => {
    // With utcHour 0 every hour passes the gate, so the day comparison alone
    // must carry the once-per-day property across midnight.
    expect(retentionSweepDue(new Date('2026-01-05T23:59:00Z'), 0, '2026-01-05')).toBe(false);
    expect(retentionSweepDue(new Date('2026-01-06T00:01:00Z'), 0, '2026-01-05')).toBe(true);
  });
});

describe('retentionBatchVerdict', () => {
  it('continues on a full batch under budget', () => {
    expect(
      retentionBatchVerdict({
        rowsThisRun: 1000,
        maxRowsPerRun: 10_000,
        lastBatchRows: 1000,
        batchSize: 1000,
      }),
    ).toBe('continue');
  });

  it('stops caught-up on a short batch', () => {
    expect(
      retentionBatchVerdict({
        rowsThisRun: 999,
        maxRowsPerRun: 10_000,
        lastBatchRows: 999,
        batchSize: 1000,
      }),
    ).toBe('stop-caught-up');
  });

  it('stops on budget when rowsThisRun reaches or passes the cap', () => {
    expect(
      retentionBatchVerdict({
        rowsThisRun: 10_000,
        maxRowsPerRun: 10_000,
        lastBatchRows: 1000,
        batchSize: 1000,
      }),
    ).toBe('stop-budget');
    expect(
      retentionBatchVerdict({
        rowsThisRun: 10_500,
        maxRowsPerRun: 10_000,
        lastBatchRows: 1000,
        batchSize: 1000,
      }),
    ).toBe('stop-budget');
  });

  it('treats a negative budget like zero: stop-budget before any batch', () => {
    // Config deliberately passes a negative RETENTION_SWEEP_MAX_ROWS_PER_RUN
    // through unvalidated (tests/server/http/config.test.ts pins the -5
    // pass-through and defers safety HERE): zero rows have always been pruned
    // when a loop starts, and 0 >= -5 already reads stop-budget.
    expect(
      retentionBatchVerdict({
        rowsThisRun: 0,
        maxRowsPerRun: -5,
        lastBatchRows: 1000,
        batchSize: 1000,
      }),
    ).toBe('stop-budget');
  });

  it('reads a short batch as caught up even when the budget is also spent', () => {
    // Precedence pin: the caller treats the two stops differently (caught-up
    // moves to the next realm, budget ends the whole group), so a table that
    // drains exactly as the budget runs out must report caught-up.
    expect(
      retentionBatchVerdict({
        rowsThisRun: 10_003,
        maxRowsPerRun: 10_000,
        lastBatchRows: 3,
        batchSize: 1000,
      }),
    ).toBe('stop-caught-up');
  });
});

// Shell test scaffolding. Every stub records its calls so assertions can pin
// exact call counts and ordering, mirroring the decisive-pin style of the
// keepalive sweep tests.

interface StubClient {
  client: RetentionSweepLockClient;
  queries: Array<{ text: string; values: unknown[] | undefined }>;
  releaseCount: number;
  // Every release argument, recorded verbatim: the destroy-vs-pool decision is
  // load-bearing (a poisoned lock must never go back to the pool), so tests
  // pin the argument, not just the call count.
  releaseArgs: Array<boolean | undefined>;
}

function stubClient(
  acquired = true,
  opts: { failLock?: Error; failUnlock?: Error } = {},
): StubClient {
  const stub: StubClient = {
    queries: [],
    releaseCount: 0,
    releaseArgs: [],
    client: {
      async query(text: string, values?: unknown[]) {
        stub.queries.push({ text, values });
        if (text.includes('pg_try_advisory_lock')) {
          if (opts.failLock) throw opts.failLock;
          return { rows: [{ acquired }] };
        }
        if (text.includes('pg_advisory_unlock') && opts.failUnlock) throw opts.failUnlock;
        return { rows: [] };
      },
      release(destroy?: boolean) {
        stub.releaseCount += 1;
        stub.releaseArgs.push(destroy);
      },
    },
  };
  return stub;
}

// A table whose pruneBatch answers from a queue, repeating the last entry once
// the queue is exhausted (so [10] means "full batches forever" and [3] means
// one short batch).
function stubTable(name: string, batches: number[], order?: string[]) {
  const calls: number[] = [];
  const table: RetentionTable = {
    name,
    async pruneBatch(batchSize: number) {
      order?.push(name);
      calls.push(batchSize);
      return batches[Math.min(calls.length - 1, batches.length - 1)] ?? 0;
    },
  };
  return { table, calls };
}

// Online-samples stub with the same repeat-last queue semantics per realm.
// Failed folds and prunes appear in `order` as attempts but never in `folds`
// or `prunes`.
function stubSamples(
  realmBatches: Record<string, number[]>,
  opts: { foldFails?: string[]; pruneFails?: string[]; order?: string[] } = {},
) {
  const folds: string[] = [];
  const prunes: Array<{ realm: string; batchSize: number }> = [];
  const pruneCounts: Record<string, number> = {};
  const samples: RetentionOnlineSamples = {
    async listRealms() {
      return Object.keys(realmBatches);
    },
    async foldPeak(realm: string) {
      opts.order?.push(`fold:${realm}`);
      if (opts.foldFails?.includes(realm)) throw new Error(`fold failed: ${realm}`);
      folds.push(realm);
    },
    async pruneBatch(realm: string, batchSize: number) {
      opts.order?.push(`prune:${realm}`);
      if (opts.pruneFails?.includes(realm)) throw new Error(`prune failed: ${realm}`);
      prunes.push({ realm, batchSize });
      const idx = pruneCounts[realm] ?? 0;
      pruneCounts[realm] = idx + 1;
      const batches = realmBatches[realm] ?? [];
      return batches[Math.min(idx, batches.length - 1)] ?? 0;
    },
  };
  return { samples, folds, prunes };
}

function baseDeps(overrides: Partial<RetentionSweepDeps>): RetentionSweepDeps {
  return {
    connect: async () => stubClient().client,
    utcHour: 4,
    maxRowsPerRun: 1_000_000,
    batchSize: 10,
    tables: [],
    pollIntervalMs: 1_000,
    onError: () => {},
    onInfo: () => {},
    ...overrides,
  };
}

describe('createRetentionSweep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('gates on the off-peak hour: quiet before it, one run at it, quiet after, next day re-arms', async () => {
    let now = new Date('2026-01-05T02:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(baseDeps({ connect, tables: [t.table], now: () => now }));
    sweep.start();

    // Three polls before 04:00 UTC: the hour gate holds and nothing connects.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(connect).not.toHaveBeenCalled();

    // The first poll at or past the hour runs exactly once.
    now = new Date('2026-01-05T04:00:10Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // Later polls the same UTC day are inert: the day is marked.
    now = new Date('2026-01-05T18:00:00Z');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // The next UTC day re-arms.
    now = new Date('2026-01-06T04:00:10Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);
    await sweep.stop();
  });

  it('still fires once when the first poll lands hours past the target hour (late boot)', async () => {
    let now = new Date('2026-01-05T07:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const sweep = createRetentionSweep(baseDeps({ connect, now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // Only once for the day, even though every remaining hour passes the gate.
    now = new Date('2026-01-05T11:00:00Z');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('defaults the poll cadence to RETENTION_SWEEP_POLL_MS when pollIntervalMs is absent', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const sweep = createRetentionSweep(
      baseDeps({ connect, now: () => now, pollIntervalMs: undefined }),
    );
    sweep.start();

    // One millisecond short of the exported constant: no poll yet. This ties
    // the fallback arm to RETENTION_SWEEP_POLL_MS itself, so a fallback that
    // drifted to some other literal would fire early or late and go red here.
    await vi.advanceTimersByTimeAsync(RETENTION_SWEEP_POLL_MS - 1);
    expect(connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('marks the day, prunes nothing, and says so when a peer holds the advisory lock', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient(false);
    const connect = vi.fn(async () => stub.client);
    const onInfo = vi.fn();
    const t = stubTable('t', [10]);
    const sweep = createRetentionSweep(
      baseDeps({ connect, tables: [t.table], now: () => now, onInfo }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.calls).toHaveLength(0);
    expect(stub.releaseCount).toBe(1);
    // Only the try-lock ran: no unlock, because this process never held the lock.
    expect(stub.queries).toHaveLength(1);
    expect(stub.queries[0].text).toContain('pg_try_advisory_lock');
    // The miss speaks: a wedged peer holding the lock forever must never read
    // like a healthy quiet night, since this sweep is the only bound on the
    // history tables' growth.
    expect(onInfo).toHaveBeenCalledWith("retention sweep: a peer holds today's sweep lock");
    expect(onInfo).toHaveBeenCalledTimes(1);

    // The miss still consumes the day: the peer that holds the lock IS today's
    // sweep, so a later poll the same day must not retry.
    now = new Date('2026-01-05T12:00:00Z');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(connect).toHaveBeenCalledTimes(1);
    // Once per process per day: the inert later polls add no second line.
    expect(onInfo).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('sends the advisory key literal in the values of BOTH the try-lock and the unlock', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(
      baseDeps({ connect: async () => stub.client, tables: [t.table], now: () => now }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The constant pin above does not tie these CALLS to the constant: a call
    // that shipped db.ts's sibling boot-DDL key 0x57_4f_43_01 would satisfy a
    // values-vs-constant comparison. The literal here is the write-vs-read
    // side of the pin, so that mutation goes red.
    const lock = stub.queries.find((q) => q.text.includes('pg_try_advisory_lock'));
    const unlock = stub.queries.find((q) => q.text.includes('pg_advisory_unlock'));
    expect(lock?.values).toEqual([0x57_4f_43_02]);
    expect(unlock?.values).toEqual([0x57_4f_43_02]);
    await sweep.stop();
  });

  it('does not consume the day on a connect failure: the next poll retries', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const onError = vi.fn();
    const boom = new Error('db down');
    const connect = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue(stub.client);
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(
      baseDeps({ connect, tables: [t.table], now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('connect', boom);
    expect(t.calls).toHaveLength(0);

    // A down database must not eat the day: the very next poll retries and wins.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(t.calls).toHaveLength(1);

    // And now the day is marked, so a third poll is inert.
    now = new Date('2026-01-05T14:00:00Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);
    await sweep.stop();
  });

  it('a try-lock failure destroys the client, keeps the day open, and the next poll retries', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const boom = new Error('lock query failed');
    const bad = stubClient(true, { failLock: boom });
    const healthy = stubClient();
    const onError = vi.fn();
    const t = stubTable('t', [0]);
    const connect = vi.fn().mockResolvedValueOnce(bad.client).mockResolvedValue(healthy.client);
    const sweep = createRetentionSweep(
      baseDeps({ connect, tables: [t.table], now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledWith('lock', boom);
    expect(t.calls).toHaveLength(0);
    // The lock state on this connection is unknown after the failed query, so
    // pooling it could park the advisory lock in the pool and silently stop
    // every future sweep. The truthy release argument is the destroy path.
    expect(bad.releaseCount).toBe(1);
    expect(bad.releaseArgs[0]).toBeTruthy();

    // The failure did not consume the day: the very next poll retries and wins.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(t.calls).toHaveLength(1);
    await sweep.stop();
  });

  it('an unlock failure destroys the client but the completed sweep keeps the day', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const boom = new Error('unlock failed');
    const stub = stubClient(true, { failUnlock: boom });
    const connect = vi.fn(async () => stub.client);
    const onError = vi.fn();
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(
      baseDeps({ connect, tables: [t.table], now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The sweep itself ran; only the unlock failed afterwards.
    expect(t.calls).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith('unlock', boom);
    // The connection may still hold the session lock, so it must be destroyed,
    // never pooled: a pooled holder would block every future sweep.
    expect(stub.releaseCount).toBe(1);
    expect(stub.releaseArgs[0]).toBeTruthy();

    // The day stays consumed: the run completed, only the cleanup misfired.
    now = new Date('2026-01-05T12:00:00Z');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('pools the client on the healthy path: release carries no destroy argument', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(
      baseDeps({ connect: async () => stub.client, tables: [t.table], now: () => now }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The destroy arm exists only for a poisoned lock; a healthy run must hand
    // the connection back to the pool, so any truthy argument here is a
    // regression that would churn a pooled connection every night.
    expect(stub.releaseCount).toBe(1);
    expect(stub.releaseArgs[0]).toBeFalsy();
    await sweep.stop();
  });

  it('sweeps tables in array order and stops a table after one short batch', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const order: string[] = [];
    const a = stubTable('a', [3], order);
    const b = stubTable('b', [2], order);
    const sweep = createRetentionSweep(baseDeps({ tables: [a.table, b.table], now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // One call each: 3 < 10 and 2 < 10 both read caught-up on the first batch.
    expect(order).toEqual(['a', 'b']);
    expect(a.calls).toEqual([10]);
    expect(b.calls).toEqual([10]);
    await sweep.stop();
  });

  it('stops a table at the per-run budget when batches keep coming back full', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const t = stubTable('t', [10]); // repeat-last: full batches forever
    const sweep = createRetentionSweep(
      baseDeps({ tables: [t.table], maxRowsPerRun: 20, now: () => now }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // Two full batches reach the 20-row budget exactly; a third would be over it.
    expect(t.calls).toHaveLength(2);
    await sweep.stop();
  });

  it('names a table that hit the budget with rows remaining; a caught-up table stays quiet', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const onInfo = vi.fn();
    const capped = stubTable('capped', [10]); // repeat-last: full batches forever
    const drained = stubTable('drained', [3]); // one short batch, caught up
    const sweep = createRetentionSweep(
      baseDeps({
        tables: [capped.table, drained.table],
        maxRowsPerRun: 20,
        now: () => now,
        onInfo,
      }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // A capped run must be visible: without this line a retention window that
    // is falling behind (a privacy signal on personal-data tables) would be
    // indistinguishable from a caught-up table.
    expect(onInfo).toHaveBeenCalledWith(
      'retention sweep: capped hit the 20 row budget with expired rows remaining',
    );
    // Exactly one budget line: the caught-up table adds nothing beyond its
    // rows in the summary.
    const budgetLines = onInfo.mock.calls.filter(([m]) => String(m).includes('budget'));
    expect(budgetLines).toHaveLength(1);
    await sweep.stop();
  });

  it('names every realm the spent group budget skipped before their folds', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const onInfo = vi.fn();
    const online = stubSamples({ r1: [10], r2: [10], r3: [10] });
    const sweep = createRetentionSweep(
      baseDeps({ onlineSamples: online.samples, maxRowsPerRun: 10, now: () => now, onInfo }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // r1's own prune loop announces its cap with evidence (it ran batches);
    // r2 and r3 were never folded, so no prune loop exists for them and the
    // group line must speak for BOTH, without claiming expired rows it never
    // measured for either.
    expect(onInfo).toHaveBeenCalledWith(
      'retention sweep: online-samples:r1 hit the 10 row budget with expired rows remaining',
    );
    expect(onInfo).toHaveBeenCalledWith(
      'retention sweep: the online-samples group hit the 10 row budget before r2, r3',
    );
    expect(online.folds).toEqual(['r1']);
    await sweep.stop();
  });

  it('a zero budget takes the lock and marks the day but issues zero batches', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const connect = vi.fn(async () => stub.client);
    const onInfo = vi.fn();
    const t = stubTable('t', [10]);
    const online = stubSamples({ r1: [10] });
    const sweep = createRetentionSweep(
      baseDeps({
        connect,
        tables: [t.table],
        onlineSamples: online.samples,
        maxRowsPerRun: 0,
        now: () => now,
        onInfo,
      }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The verdict runs BEFORE the first batch, so a zero budget means zero
    // pruneBatch calls anywhere, and no fold either (no prune would follow it).
    expect(t.calls).toHaveLength(0);
    expect(online.folds).toHaveLength(0);
    expect(online.prunes).toHaveLength(0);
    expect(stub.queries.some((q) => q.text.includes('pg_try_advisory_lock'))).toBe(true);
    // The nightly budget lines are deliberate noise under a zero budget: a
    // zero budget IS a permanently stalled retention window, so each table
    // announces its cap, the group names every unfolded realm, and the 0-row
    // summary still fires (the run-end liveness line).
    expect(onInfo).toHaveBeenCalledWith(
      'retention sweep: t hit the 0 row budget with expired rows remaining',
    );
    expect(onInfo).toHaveBeenCalledWith(
      'retention sweep: the online-samples group hit the 0 row budget before r1',
    );
    expect(onInfo).toHaveBeenCalledWith('retention sweep pruned 0 rows');

    // The day is still consumed: budget zero is a configuration, not a failure.
    now = new Date('2026-01-05T15:00:00Z');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('normalizes batchSize 0 to 1 instead of looping forever on empty batches', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(
      baseDeps({ tables: [t.table], batchSize: 0, now: () => now }),
    );
    sweep.start();

    // The single terminating call is the whole point: an unnormalized LIMIT 0
    // batch deletes zero rows, zero is never short of a zero batch size, and the
    // loop would never end. Normalized, the 0-row batch reads short of 1.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.calls).toEqual([1]);
    await sweep.stop();
  });

  it('contains one table batch failure: siblings sweep, unlock rides the same client', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const boom = new Error('prune failed');
    const bad: RetentionTable = {
      name: 'bad',
      pruneBatch: async () => {
        throw boom;
      },
    };
    const good = stubTable('good', [4]);
    const onError = vi.fn();
    const onInfo = vi.fn();
    const sweep = createRetentionSweep(
      baseDeps({
        connect: async () => stub.client,
        tables: [bad, good.table],
        now: () => now,
        onError,
        onInfo,
      }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledWith('bad', boom);
    expect(good.calls).toHaveLength(1);
    // An error stop is never mistaken for a budget stop: the failed table gets
    // its onError line, not a budget-cap line (the post-loop verdict still
    // reads 'continue' because the failed batch never touched the state).
    const badBudgetLines = onInfo.mock.calls.filter(
      ([m]) => String(m).includes('bad') && String(m).includes('budget'),
    );
    expect(badBudgetLines).toHaveLength(0);
    // The lock and unlock rode the same client object, in that order, and the
    // client went back to the pool exactly once.
    expect(stub.queries.map((q) => q.text)).toEqual([
      expect.stringContaining('pg_try_advisory_lock'),
      expect.stringContaining('pg_advisory_unlock'),
    ]);
    expect(stub.releaseCount).toBe(1);
    await sweep.stop();
  });

  it('folds a realm before its first prune', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const order: string[] = [];
    const online = stubSamples({ r1: [0] }, { order });
    const sweep = createRetentionSweep(baseDeps({ onlineSamples: online.samples, now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The fold is the precondition that makes the prune safe, so it must come
    // first for the realm.
    expect(order).toEqual(['fold:r1', 'prune:r1']);
    await sweep.stop();
  });

  it('sweeps the plain tables before the online-samples group', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const order: string[] = [];
    const t = stubTable('t', [0], order);
    const online = stubSamples({ r1: [0] }, { order });
    const sweep = createRetentionSweep(
      baseDeps({ tables: [t.table], onlineSamples: online.samples, now: () => now }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The deps contract promises the tables array in order first, then the
    // online-samples group.
    expect(order).toEqual(['t', 'fold:r1', 'prune:r1']);
    await sweep.stop();
  });

  it('a fold failure skips only that realm: the next realm still folds and prunes', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const order: string[] = [];
    const onError = vi.fn();
    const online = stubSamples({ r1: [0], r2: [0] }, { foldFails: ['r1'], order });
    const sweep = createRetentionSweep(
      baseDeps({ onlineSamples: online.samples, now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // r1's fold attempt failed, so r1 was never pruned this run; r2 was
    // unaffected. The next scheduled run retries r1 from its oldest rows.
    expect(order).toEqual(['fold:r1', 'fold:r2', 'prune:r2']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('online-samples:r1');
    await sweep.stop();
  });

  it('a prune failure skips only that realm: the next realm still folds and prunes', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const order: string[] = [];
    const onError = vi.fn();
    const online = stubSamples({ r1: [0], r2: [0] }, { pruneFails: ['r1'], order });
    const sweep = createRetentionSweep(
      baseDeps({ onlineSamples: online.samples, now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // r1 folded but its prune loop failed and stopped for the run; r2 was
    // unaffected, mirroring the fold-failure containment above.
    expect(order).toEqual(['fold:r1', 'prune:r1', 'fold:r2', 'prune:r2']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('online-samples:r1');
    await sweep.stop();
  });

  it('a listRealms failure skips the group but the run still counts for the day', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const onError = vi.fn();
    const t = stubTable('t', [0]);
    const online: RetentionOnlineSamples = {
      listRealms: async () => {
        throw new Error('realms unavailable');
      },
      foldPeak: async () => {},
      pruneBatch: async () => 0,
    };
    const sweep = createRetentionSweep(
      baseDeps({ connect, tables: [t.table], onlineSamples: online, now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The plain tables still swept; only the online group was skipped.
    expect(t.calls).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('online-samples');

    // The run happened, so the day is marked and no later poll retries it.
    now = new Date('2026-01-05T16:00:00Z');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('shares one budget across realms and stops later realms without folding them', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const onInfo = vi.fn();
    // Budget 15, batch size 10. r1 drains with one short batch of 5 rows;
    // r2 answers full batches forever; r3 exists to prove the group ends.
    const online = stubSamples({ r1: [5], r2: [10], r3: [10] });
    const sweep = createRetentionSweep(
      baseDeps({ onlineSamples: online.samples, maxRowsPerRun: 15, now: () => now, onInfo }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // r2 stopped after ONE batch only because r1's 5 rows counted against the
    // shared budget (5 + 10 = 15); an unshared budget would grant r2 a second
    // batch. r3 never folded: a spent budget stops the group before the fold,
    // because no prune would follow it.
    expect(online.folds).toEqual(['r1', 'r2']);
    expect(online.prunes.map((p) => p.realm)).toEqual(['r1', 'r2']);
    // The group line names exactly the realms skipped FROM the exhaustion
    // point, not the ones already processed: a slice-from-zero mutant would
    // name r1 and r2 here.
    expect(onInfo).toHaveBeenCalledWith(
      'retention sweep: the online-samples group hit the 15 row budget before r3',
    );
    await sweep.stop();
  });

  it('counts rows from good batches toward the summary and shared budget after a failure', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const onInfo = vi.fn();
    const onError = vi.fn();
    const boom = new Error('third batch failed');
    let r1Calls = 0;
    const prunes: string[] = [];
    // r1 delivers two full batches (20 rows) and dies on the third; r2 answers
    // full batches forever. Budget 25, batch size 10.
    const samples: RetentionOnlineSamples = {
      listRealms: async () => ['r1', 'r2'],
      foldPeak: async () => {},
      async pruneBatch(realm) {
        prunes.push(realm);
        if (realm === 'r1') {
          r1Calls += 1;
          if (r1Calls === 3) throw boom;
        }
        return 10;
      },
    };
    const sweep = createRetentionSweep(
      baseDeps({ onlineSamples: samples, maxRowsPerRun: 25, now: () => now, onInfo, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledWith('online-samples:r1', boom);
    // r1's 20 good rows survived its failed third batch and counted against
    // the shared 25-row budget, so r2 got exactly one batch (20 + 10 >= 25).
    // Accounting that dropped the partial progress would grant r2 a second.
    expect(prunes).toEqual(['r1', 'r1', 'r1', 'r2']);
    // The run summary reflects the same 30 rows, failure included.
    expect(onInfo).toHaveBeenCalledWith('retention sweep pruned 30 rows');
    await sweep.stop();
  });

  it('always logs the run-end summary, naming 0 rows on a caught-up night', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const onInfo = vi.fn();
    const t = stubTable('t', [7, 0]); // day one prunes 7 rows, day two finds none
    const sweep = createRetentionSweep(baseDeps({ tables: [t.table], now: () => now, onInfo }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onInfo).toHaveBeenCalledTimes(1);
    expect(onInfo).toHaveBeenCalledWith('retention sweep pruned 7 rows');

    // The 0-row night still speaks, naming its 0 rows: a dead sweep (a wedged
    // lock, a stuck peer, a zero-budget misconfiguration) must be
    // distinguishable from a caught-up one, so a silent day is the wedge
    // signal, never a quiet night.
    now = new Date('2026-01-06T04:00:00Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.calls).toHaveLength(2);
    expect(onInfo).toHaveBeenCalledTimes(2);
    expect(onInfo).toHaveBeenCalledWith('retention sweep pruned 0 rows');
    await sweep.stop();
  });

  it('coalesces polls while a run is in flight instead of stacking runs', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    let resolveConnect!: (client: RetentionSweepLockClient) => void;
    const connect = vi.fn(
      () =>
        new Promise<RetentionSweepLockClient>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const sweep = createRetentionSweep(baseDeps({ connect, now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // Three more polls land while the run hangs on connect: the in-flight guard
    // coalesces them all, so no second run stacks on the same budget.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(connect).toHaveBeenCalledTimes(1);

    resolveConnect(stub.client);
    await sweep.stop();
    expect(stub.releaseCount).toBe(1);
  });

  it('stops the poll loop: no runs fire after stop()', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const sweep = createRetentionSweep(baseDeps({ connect, now: () => now }));
    sweep.start();
    await sweep.stop();

    // The clock is due the whole time; only the cleared interval keeps it quiet.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(connect).not.toHaveBeenCalled();
  });

  it('start() is idempotent: a double start leaks no second interval past stop()', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const sweep = createRetentionSweep(baseDeps({ connect, now: () => now }));
    sweep.start();
    sweep.start();
    await sweep.stop();

    // An unguarded second start would replace the timer handle and orphan the
    // first interval where stop() cannot clear it; the due clock would then
    // still fire here. Zero connects is the whole assertion.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(connect).not.toHaveBeenCalled();
  });

  it('stop() settles only after an in-flight run finishes, and the unlock still ran', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    let resolveBatch!: (rows: number) => void;
    const t: RetentionTable = {
      name: 't',
      pruneBatch: () =>
        new Promise<number>((resolve) => {
          resolveBatch = resolve;
        }),
    };
    const sweep = createRetentionSweep(
      baseDeps({ connect: async () => stub.client, tables: [t], now: () => now }),
    );
    sweep.start();

    // The run is now blocked inside its first batch.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stub.queries.some((q) => q.text.includes('pg_try_advisory_lock'))).toBe(true);

    let settled = false;
    const stopping = sweep.stop().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    // stop() must wait for the run: a prune query racing pool.end() at shutdown
    // is exactly what the await exists to prevent.
    expect(settled).toBe(false);

    resolveBatch(0); // the short batch lets the run finish and unlock
    await stopping;
    expect(settled).toBe(true);
    expect(stub.queries.some((q) => q.text.includes('pg_advisory_unlock'))).toBe(true);
    expect(stub.releaseCount).toBe(1);
  });

  it('stop() ends an in-flight run at the batch boundary instead of draining the budget', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const onInfo = vi.fn();
    const resolvers: Array<(rows: number) => void> = [];
    const t: RetentionTable = {
      name: 't',
      pruneBatch: () =>
        new Promise<number>((resolve) => {
          resolvers.push(resolve);
        }),
    };
    const sweep = createRetentionSweep(
      baseDeps({ connect: async () => stub.client, tables: [t], now: () => now, onInfo }),
    );
    sweep.start();

    // The run is blocked inside its first batch; the budget would allow
    // thousands more batches after it.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolvers).toHaveLength(1);

    let settled = false;
    const stopping = sweep.stop().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    // A FULL batch resolves: without the stopping flag the loop would issue a
    // second batch, and shutdown would wait out the whole catch-up budget,
    // long enough for a supervisor SIGKILL to preempt the character saves
    // that follow this stop in main.ts's shutdown.
    resolvers[0](10);
    await stopping;
    expect(settled).toBe(true);
    expect(resolvers).toHaveLength(1);
    // The interrupted run still closed cleanly: run-end line, unlock on the
    // same client, pooled release.
    expect(onInfo).toHaveBeenCalledWith('retention sweep pruned 10 rows');
    expect(stub.queries.some((q) => q.text.includes('pg_advisory_unlock'))).toBe(true);
    expect(stub.releaseCount).toBe(1);
  });

  it('reads a non-finite batch count as caught up instead of looping forever', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const calls: number[] = [];
    const t: RetentionTable = {
      name: 't',
      async pruneBatch(batchSize: number) {
        calls.push(batchSize);
        // NaN first, then a terminating short batch: unclamped code survives
        // to a SECOND call here (and against a NaN-forever primitive would
        // spin the microtask loop unboundedly), so one call is the pin.
        return calls.length === 1 ? Number.NaN : 0;
      },
    };
    const sweep = createRetentionSweep(baseDeps({ tables: [t], now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // NaN compares false on both verdict arms, so an unclamped read keeps the
    // verdict at 'continue'; the clamp reads it as a short batch (caught up),
    // the safe stop, and never issues a second batch.
    expect(calls).toHaveLength(1);
    await sweep.stop();
  });

  it('threads the configured hour to the gate: quiet at five, fires at six with utcHour 6', async () => {
    let now = new Date('2026-01-05T05:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const sweep = createRetentionSweep(baseDeps({ connect, utcHour: 6, now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // Every other shell test gates at utcHour 4 with probes at 02:00/04:00, so
    // a hardcoded gate hour of 3 or 4 would pass them all; this second
    // configured value pins that the poll threads deps.utcHour.
    expect(connect).not.toHaveBeenCalled();

    now = new Date('2026-01-05T06:00:00Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('skips the sweep when the persisted marker already names today, but still unlocks', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const connect = vi.fn(async () => stub.client);
    const onInfo = vi.fn();
    const t = stubTable('t', [10]);
    const loadLastSweepDay = vi.fn(async () => '2026-01-05');
    const saveLastSweepDay = vi.fn(async () => {});
    const sweep = createRetentionSweep(
      baseDeps({
        connect,
        tables: [t.table],
        now: () => now,
        onInfo,
        loadLastSweepDay,
        saveLastSweepDay,
      }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // A peer, or an earlier life of this process before a restart, already
    // swept today: no batch fires and no marker write repeats.
    expect(loadLastSweepDay).toHaveBeenCalledTimes(1);
    expect(t.calls).toHaveLength(0);
    expect(saveLastSweepDay).not.toHaveBeenCalled();
    // The skipped day still speaks (the run-end contract): the marker line is
    // the day's one line, and no pruned summary joins it.
    expect(onInfo).toHaveBeenCalledWith(
      "retention sweep: today's sweep already ran (persisted marker)",
    );
    expect(onInfo).toHaveBeenCalledTimes(1);
    // The early return still travels the finally blocks: unlock and release.
    expect(stub.queries.some((q) => q.text.includes('pg_advisory_unlock'))).toBe(true);
    expect(stub.releaseCount).toBe(1);

    // The local day is consumed too: later polls the same day stay quiet.
    now = new Date('2026-01-05T13:00:00Z');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('sweeps normally when the persisted marker names an older day, then writes today', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const t = stubTable('t', [3]);
    const loadLastSweepDay = vi.fn(async () => '2026-01-04');
    const saveLastSweepDay = vi.fn(async () => {});
    const sweep = createRetentionSweep(
      baseDeps({ tables: [t.table], now: () => now, loadLastSweepDay, saveLastSweepDay }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // Yesterday's marker means today is unswept: the run proceeds and then
    // advances the marker so the next restart today stays quiet.
    expect(t.calls).toHaveLength(1);
    expect(saveLastSweepDay).toHaveBeenCalledTimes(1);
    expect(saveLastSweepDay).toHaveBeenCalledWith('2026-01-05');
    await sweep.stop();
  });

  it('a marker read failure must not stop retention: the sweep proceeds', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const boom = new Error('marker table unavailable');
    const onError = vi.fn();
    const t = stubTable('t', [3]);
    const loadLastSweepDay = vi.fn(async (): Promise<string | null> => {
      throw boom;
    });
    const sweep = createRetentionSweep(
      baseDeps({ tables: [t.table], now: () => now, onError, loadLastSweepDay }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The sweep is idempotent, so the worst case of proceeding is one bounded
    // re-sweep; skipping on a read failure could stall retention indefinitely.
    expect(onError).toHaveBeenCalledWith('last-run-read', boom);
    expect(t.calls).toHaveLength(1);
    await sweep.stop();
  });

  it('a marker write failure is reported but the run still completes', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const boom = new Error('marker write failed');
    const onError = vi.fn();
    const onInfo = vi.fn();
    const stub = stubClient();
    const t = stubTable('t', [3]);
    const saveLastSweepDay = vi.fn(async () => {
      throw boom;
    });
    const sweep = createRetentionSweep(
      baseDeps({
        connect: async () => stub.client,
        tables: [t.table],
        now: () => now,
        onError,
        onInfo,
        saveLastSweepDay,
      }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // A lost write costs at most one bounded re-sweep after a restart; the run
    // itself finished, logged its summary, unlocked, and pooled the client.
    expect(onError).toHaveBeenCalledWith('last-run-write', boom);
    expect(onInfo).toHaveBeenCalledWith('retention sweep pruned 3 rows');
    expect(stub.queries.some((q) => q.text.includes('pg_advisory_unlock'))).toBe(true);
    expect(stub.releaseCount).toBe(1);
    expect(stub.releaseArgs[0]).toBeFalsy();
    await sweep.stop();
  });

  it('never consults the persisted marker when a peer holds the lock', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient(false);
    const loadLastSweepDay = vi.fn(async () => null);
    const saveLastSweepDay = vi.fn(async () => {});
    const sweep = createRetentionSweep(
      baseDeps({
        connect: async () => stub.client,
        now: () => now,
        loadLastSweepDay,
        saveLastSweepDay,
      }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The marker lives under the lock: the losing process defers to the peer
    // entirely and neither reads nor writes it, so a slow marker store can
    // never stack reads from every process in the fleet.
    expect(loadLastSweepDay).not.toHaveBeenCalled();
    expect(saveLastSweepDay).not.toHaveBeenCalled();
    await sweep.stop();
  });
});
