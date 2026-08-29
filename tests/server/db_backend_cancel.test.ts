import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module builds its Pool lazily through a dynamic import of ./db, so stub
// both: pg with a constructor spy, and db with just the connection string.
const rig = vi.hoisted(() => ({
  pools: [] as Array<{
    options: Record<string, unknown>;
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }>,
  queryImpl: vi.fn(async () => ({ rows: [] })),
  // One-shot Pool constructor failure: rejects the module's lazy factory so
  // the rejected-memo tests can drive it.
  poolConstructError: null as Error | null,
}));
vi.mock('pg', () => ({
  Pool: function Pool(options: Record<string, unknown>) {
    if (rig.poolConstructError) {
      const error = rig.poolConstructError;
      rig.poolConstructError = null;
      throw error;
    }
    const pool = {
      options,
      query: vi.fn((...args: unknown[]) => rig.queryImpl(...(args as []))),
      end: vi.fn(async () => {}),
      on: vi.fn(),
    };
    rig.pools.push(pool);
    return pool;
  },
}));
vi.mock('../../server/db', () => ({ DATABASE_URL: 'postgres://cancel-test/db' }));

import {
  cancelDetachedBackend,
  closeBackendCancelPool,
  DB_CANCEL_IDLE_TIMEOUT_MS,
  DB_CANCEL_POOL_CONNECT_TIMEOUT_MS,
  DB_CANCEL_QUERY_TIMEOUT_MS,
  DB_CANCEL_STATEMENT_TIMEOUT_MS,
  getBackendCancelCounts,
} from '../../server/db_backend_cancel';

describe('the dedicated deadline-cancel side pool', () => {
  beforeEach(() => {
    rig.queryImpl.mockReset();
    rig.queryImpl.mockResolvedValue({ rows: [] });
  });

  it('constructs ONE max-1 sub-second pool even under two same-tick first cancels', async () => {
    // Deadline expiries cluster at exactly the saturation moment that
    // produces them, so the double-first-cancel shape is the expected case,
    // not a rare one: a resolved-value memo would let both construct a Pool
    // across the dynamic-import await and orphan one outside teardown.
    const before = rig.pools.length;
    await Promise.all([cancelDetachedBackend(41), cancelDetachedBackend(42)]);
    expect(rig.pools.length).toBe(before + 1);
    const pool = rig.pools[rig.pools.length - 1];
    // The pool must never ride the main pool's budget or bounds: max 1 and
    // sub-second everything, so a cancel that cannot run promptly is dropped
    // rather than queued behind login checkouts.
    expect(pool.options).toMatchObject({
      connectionString: 'postgres://cancel-test/db',
      max: 1,
      connectionTimeoutMillis: DB_CANCEL_POOL_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: DB_CANCEL_IDLE_TIMEOUT_MS,
      statement_timeout: DB_CANCEL_STATEMENT_TIMEOUT_MS,
      query_timeout: DB_CANCEL_QUERY_TIMEOUT_MS,
    });
    expect(DB_CANCEL_POOL_CONNECT_TIMEOUT_MS).toBe(500);
    expect(DB_CANCEL_STATEMENT_TIMEOUT_MS).toBe(750);
    expect(DB_CANCEL_QUERY_TIMEOUT_MS).toBe(1_000);
    // The "transient connection" budget claim is an explicit bound, never
    // pg-pool's implicit default.
    expect(DB_CANCEL_IDLE_TIMEOUT_MS).toBe(10_000);
    // Both cancels went through pg_cancel_backend on the ACTIVE-state guard.
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toContain('pg_cancel_backend');
    expect(pool.query.mock.calls[0][0]).toContain("state = 'active'");
    expect(pool.query.mock.calls[0][1]).toEqual([41]);
  });

  it('counts requests and failures, rethrowing so the deadline owner can swallow', async () => {
    const start = getBackendCancelCounts();
    await cancelDetachedBackend(7);
    expect(getBackendCancelCounts()).toEqual({
      requested: start.requested + 1,
      failed: start.failed,
    });
    rig.queryImpl.mockRejectedValueOnce(new Error('cancel pool saturated'));
    await expect(cancelDetachedBackend(8)).rejects.toThrow('cancel pool saturated');
    expect(getBackendCancelCounts()).toEqual({
      requested: start.requested + 2,
      failed: start.failed + 1,
    });
  });

  it('closeBackendCancelPool ends the one constructed pool', async () => {
    await cancelDetachedBackend(9);
    const pool = rig.pools[rig.pools.length - 1];
    await closeBackendCancelPool();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('a rejected lazy factory does not poison later cancels: the memo retries fresh', async () => {
    // A fresh module instance: the file-level import already memoized a live
    // pool, and this trap is specifically about the FIRST construction failing.
    vi.resetModules();
    const fresh = await import('../../server/db_backend_cancel');
    rig.poolConstructError = new Error('cancel pool boot failed');
    const before = rig.pools.length;
    await expect(fresh.cancelDetachedBackend(21)).rejects.toThrow('cancel pool boot failed');
    expect(fresh.getBackendCancelCounts()).toEqual({ requested: 1, failed: 1 });
    // The next deadline expiry constructs a NEW pool and cancels normally;
    // with a still-memoized rejection this would replay the boot error.
    await fresh.cancelDetachedBackend(22);
    expect(rig.pools.length).toBe(before + 1);
    const pool = rig.pools[rig.pools.length - 1];
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual([22]);
    expect(fresh.getBackendCancelCounts()).toEqual({ requested: 2, failed: 1 });
    // And shutdown after the recovery never wedges (the close-latch tests
    // below cover closing over a still-rejected memo).
    await expect(fresh.closeBackendCancelPool()).resolves.toBeUndefined();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('once closed, a late cancel counts a failure and never constructs a new pool', async () => {
    vi.resetModules();
    const fresh = await import('../../server/db_backend_cancel');
    // The trap this latch closes: the factory REJECTED (memo nulled), then
    // shutdown closed the (absent) pool. A cancel arriving before
    // process.exit would otherwise rebuild a fresh Pool nothing ever ends.
    rig.poolConstructError = new Error('cancel pool boot failed');
    await expect(fresh.cancelDetachedBackend(31)).rejects.toThrow('cancel pool boot failed');
    // Closing over the rejected (nulled) memo still never wedges shutdown.
    await expect(fresh.closeBackendCancelPool()).resolves.toBeUndefined();
    const before = rig.pools.length;
    await expect(fresh.cancelDetachedBackend(32)).rejects.toThrow('closed for shutdown');
    expect(rig.pools.length).toBe(before);
    // Counted like any refused cancel: a request and a failure.
    expect(fresh.getBackendCancelCounts()).toEqual({ requested: 2, failed: 2 });
  });

  it('the closed latch also refuses a late cancel after a normally constructed pool ended', async () => {
    vi.resetModules();
    const fresh = await import('../../server/db_backend_cancel');
    await fresh.cancelDetachedBackend(33);
    const pool = rig.pools[rig.pools.length - 1];
    await fresh.closeBackendCancelPool();
    expect(pool.end).toHaveBeenCalledTimes(1);
    const before = rig.pools.length;
    await expect(fresh.cancelDetachedBackend(34)).rejects.toThrow('closed for shutdown');
    expect(rig.pools.length).toBe(before);
    // The ended pool was never queried again either.
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('closeBackendCancelPool never throws past a failing end(), so shutdown reaches the main pool.end()', async () => {
    vi.resetModules();
    const fresh = await import('../../server/db_backend_cancel');
    await fresh.cancelDetachedBackend(23);
    const pool = rig.pools[rig.pools.length - 1];
    pool.end.mockRejectedValueOnce(new Error('end() lost the socket'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mainPoolEnd = vi.fn();
    try {
      // The real shutdown chain shape (main.ts): closeBackendCancelPool(),
      // THEN the main pools' end() and process.exit(0). A throw from the
      // close would skip both.
      await fresh.closeBackendCancelPool();
      mainPoolEnd();
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(mainPoolEnd).toHaveBeenCalledTimes(1);
  });
});
