// Real node-postgres lifecycle proof for the minute bank-ledger growth read.
// Unit tests pin the protocol and failure branches; this suite proves pg-pool
// actually destroys an active client on release(error), never queues behind a
// saturated pool, and lets monitor.stop drain before pool.end.

import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BankLedgerGrowthMonitorPoolBusy,
  createBankLedgerGrowthMonitor,
  readBankLedgerGrowthBudget,
} from '../../server/bank_ledger_growth_monitor';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_bank_growth_monitor_verify';
const describeDb = ADMIN_URL ? describe : describe.skip;

function verifyUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${VERIFY_DB}`;
  return url.toString();
}

describeDb('bank-ledger growth monitor against real PostgreSQL', () => {
  let admin: Pool;
  const openPools = new Set<Pool>();

  function trackedPool(applicationName: string, max = 1): Pool {
    const pool = new Pool({
      connectionString: verifyUrl(ADMIN_URL as string),
      application_name: applicationName,
      max,
    });
    openPools.add(pool);
    return pool;
  }

  async function closePool(pool: Pool): Promise<void> {
    openPools.delete(pool);
    await pool.end();
  }

  async function waitForMonitorRead(applicationName: string): Promise<void> {
    await vi.waitFor(
      async () => {
        const active = await admin.query(
          `SELECT EXISTS (
             SELECT 1
               FROM pg_catalog.pg_stat_activity
              WHERE datname = $1
                AND application_name = $2
                AND state = 'active'
                AND query LIKE '%FROM public.bank_ledger_growth_budget%'
           ) AS active`,
          [VERIFY_DB, applicationName],
        );
        expect(active.rows[0].active).toBe(true);
      },
      { timeout: 3_000, interval: 10 },
    );
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const callerDb = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    expect(callerDb).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_catalog.pg_terminate_backend(pid)
         FROM pg_catalog.pg_stat_activity
        WHERE datname = $1 AND pid <> pg_catalog.pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    const setup = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 1 });
    try {
      // A point read that remains active long enough to observe and abort.
      await setup.query(`CREATE VIEW public.bank_ledger_growth_budget AS
        SELECT TRUE AS singleton,
               123::bigint AS committed_rows,
               10000000::bigint AS hard_limit_rows
          FROM pg_catalog.pg_sleep(10)`);
    } finally {
      await setup.end();
    }
  }, 30_000);

  afterEach(async () => {
    await Promise.all([...openPools].map((pool) => pool.end().catch(() => {})));
    openPools.clear();
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query(
      `SELECT pg_catalog.pg_terminate_backend(pid)
         FROM pg_catalog.pg_stat_activity
        WHERE datname = $1 AND pid <> pg_catalog.pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.end();
  }, 30_000);

  it('aborts an active socket promptly, replaces it, and leaves no pool waiter', async () => {
    const applicationName = 'growth-monitor-active-abort';
    const pool = trackedPool(applicationName);
    const controller = new AbortController();
    const pending = readBankLedgerGrowthBudget(pool, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      code: 'BANK_LEDGER_GROWTH_MONITOR_ABORTED',
    });
    await waitForMonitorRead(applicationName);

    const startedAt = performance.now();
    controller.abort();
    await rejection;
    expect(performance.now() - startedAt).toBeLessThan(1_000);

    await expect(pool.query('SELECT 1 AS ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
    await vi.waitFor(() => {
      expect(pool.waitingCount).toBe(0);
      expect(pool.totalCount).toBe(1);
    });
  });

  it('never creates a checkout waiter when the real pool is saturated', async () => {
    const pool = trackedPool('growth-monitor-saturated-pool');
    const held = await pool.connect();
    let heldReleased = false;
    try {
      const startedAt = performance.now();
      await expect(readBankLedgerGrowthBudget(pool)).rejects.toBeInstanceOf(
        BankLedgerGrowthMonitorPoolBusy,
      );
      expect(performance.now() - startedAt).toBeLessThan(1_000);
      expect(pool.waitingCount).toBe(0);
      expect(pool.totalCount).toBe(1);

      const permitRelease = vi.fn();
      const onError = vi.fn();
      const monitor = createBankLedgerGrowthMonitor({
        pool,
        tryAcquireBackgroundPermit: () => ({ release: permitRelease }),
        onError,
      });
      await monitor.refresh();
      await monitor.stop();
      expect(pool.waitingCount).toBe(0);
      expect(pool.totalCount).toBe(1);
      expect(permitRelease).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      held.release();
      heldReleased = true;
      await expect(pool.query('SELECT 1 AS ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
      expect(pool.waitingCount).toBe(0);
      expect(pool.totalCount).toBe(1);
    } finally {
      if (!heldReleased) held.release();
    }
  });

  it('monitor.stop aborts and drains the real query before pool.end', async () => {
    const applicationName = 'growth-monitor-stop-drain';
    const pool = trackedPool(applicationName);
    const permitRelease = vi.fn();
    const monitor = createBankLedgerGrowthMonitor({
      pool,
      tryAcquireBackgroundPermit: () => ({ release: permitRelease }),
    });
    const refresh = monitor.refresh();
    await waitForMonitorRead(applicationName);

    const stopStartedAt = performance.now();
    await monitor.stop();
    expect(performance.now() - stopStartedAt).toBeLessThan(1_000);
    await refresh;
    expect(permitRelease).toHaveBeenCalledTimes(1);
    expect(pool.waitingCount).toBe(0);

    const endStartedAt = performance.now();
    await closePool(pool);
    expect(performance.now() - endStartedAt).toBeLessThan(1_000);
  });
});
