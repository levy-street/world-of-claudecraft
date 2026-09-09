// Real node-postgres lifecycle proof for the minute bank-ledger growth read.
// Unit tests pin the protocol and failure branches; this suite proves pg-pool
// actually destroys an active client on release(error), never queues behind a
// saturated pool, and lets monitor.stop drain before pool.end.

import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditGrowthBytesSql } from '../../server/audit_growth_sources';
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

  it('sums the whole audit surface in one lock-free expression, tolerating tables that do not exist', async () => {
    // The byte measure rides the minute point read, so it has to answer
    // against a partially migrated database rather than failing the refresh.
    // Here only two of the three audit tables exist.
    const pool = trackedPool('growth-monitor-audit-bytes');
    const bytesSql = `SELECT ${auditGrowthBytesSql()} AS total_bytes`;
    // No audit table at all: an honest null, not an error.
    expect((await pool.query(bytesSql)).rows).toEqual([{ total_bytes: null }]);

    await pool.query('CREATE TABLE public.bank_ledger (id BIGSERIAL PRIMARY KEY, payload TEXT)');
    await pool.query(
      `INSERT INTO public.bank_ledger (payload)
       SELECT repeat('x', 200) FROM pg_catalog.generate_series(1, 500)`,
    );
    const ledgerOnly = Number((await pool.query(bytesSql)).rows[0].total_bytes);
    expect(ledgerOnly).toBeGreaterThan(0);

    await pool.query(
      'CREATE TABLE public.material_source_journal (id BIGSERIAL PRIMARY KEY, payload TEXT)',
    );
    await pool.query(
      `INSERT INTO public.material_source_journal (payload)
       SELECT repeat('y', 200) FROM pg_catalog.generate_series(1, 500)`,
    );
    // Aggregate, not per table: the source journal's storage joins the same
    // figure the ledger's does.
    const aggregate = Number((await pool.query(bytesSql)).rows[0].total_bytes);
    expect(aggregate).toBeGreaterThan(ledgerOnly);
    expect(aggregate).toBe(
      Number(
        (
          await pool.query(
            `SELECT pg_catalog.pg_total_relation_size('public.bank_ledger'::pg_catalog.regclass)
                  + pg_catalog.pg_total_relation_size('public.material_source_journal'::pg_catalog.regclass)
               AS expected`,
          )
        ).rows[0].expected,
      ),
    );

    // It is NOT lock-free. pg_total_relation_size opens each relation with
    // AccessShareLock, so it waits behind an ACCESS EXCLUSIVE holder (a boot
    // transaction is the real one). Prove the conflict, and prove the caller's
    // statement timeout is what bounds it: the cost of a boot is one failed
    // telemetry beat, not a stuck client.
    const blocker = trackedPool('growth-monitor-audit-bytes-blocker');
    const held = await blocker.connect();
    try {
      await held.query('BEGIN');
      await held.query('LOCK TABLE public.bank_ledger IN ACCESS EXCLUSIVE MODE');
      const waiter = await pool.connect();
      try {
        await waiter.query('SET statement_timeout = 250');
        const startedAt = performance.now();
        await expect(waiter.query(bytesSql)).rejects.toMatchObject({ code: '57014' });
        expect(performance.now() - startedAt).toBeLessThan(2_000);
        await waiter.query('RESET statement_timeout');
      } finally {
        waiter.release();
      }
      await held.query('ROLLBACK');
    } finally {
      held.release();
    }
    // Released with the blocking transaction: the very next read answers.
    await expect(pool.query(bytesSql)).resolves.toMatchObject({ rowCount: 1 });

    await pool.query('DROP TABLE public.bank_ledger');
    await pool.query('DROP TABLE public.material_source_journal');
    await closePool(blocker);
    await closePool(pool);
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
