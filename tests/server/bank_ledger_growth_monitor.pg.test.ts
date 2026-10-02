// Real node-postgres lifecycle proof for the minute bank-ledger growth read.
// Unit tests pin the protocol and failure branches; this suite proves pg-pool
// actually destroys an active client on release(error), never queues behind a
// saturated pool, and lets monitor.stop drain before pool.end. Its sibling, the
// keep-forever housing growth read (server/freehold_receipt_growth_monitor.ts),
// rides the same disposable database for one case: the catalog statement runs
// against a real freehold_operation_receipts table and answers the estimate
// and the bytes without scanning it.

import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditGrowthBytesSql } from '../../server/audit_growth_sources';
import {
  BankLedgerGrowthMonitorPoolBusy,
  createBankLedgerGrowthMonitor,
  readBankLedgerGrowthBudget,
} from '../../server/bank_ledger_growth_monitor';
import { freeholdClaimSchema } from '../../server/freehold_claim_db';
import { freeholdOperationSchema } from '../../server/freehold_operation_db';
import {
  createFreeholdReceiptGrowthMonitor,
  FREEHOLD_RECEIPT_GROWTH_SQL,
  freeholdReceiptGrowthReadout,
  readFreeholdReceiptGrowth,
} from '../../server/freehold_receipt_growth_monitor';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_bank_growth_monitor_verify';
const describeDb = ADMIN_URL ? describe : describe.skip;
/** pg's admin_shutdown: what pg_terminate_backend leaves an idle client. */
const ADMIN_SHUTDOWN = '57P01';

function verifyUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${VERIFY_DB}`;
  return url.toString();
}

describeDb('bank-ledger growth monitor against real PostgreSQL', () => {
  let admin: Pool;
  const openPools = new Set<Pool>();
  // Every idle-client error a tracked pool reported, save the teardown's
  // 57P01: each case fails on any left here (afterEach), so a real one surfaces.
  const idleClientErrors: unknown[] = [];

  function trackedPool(applicationName: string, max = 1): Pool {
    const pool = new Pool({
      connectionString: verifyUrl(ADMIN_URL as string),
      application_name: applicationName,
      max,
    });
    // An idle client's error re-emits on its pool. The teardown terminates every
    // backend of the verify database, so a client still idle there (its pool
    // ending) reports a 57P01 that, unlistened, surfaces as an unhandled error
    // and fails the run after every case passed. The server's own pool listens.
    // Only that code is swallowed: anything else is recorded and fails the case.
    pool.on('error', (error) => {
      if ((error as { code?: unknown }).code !== ADMIN_SHUTDOWN) idleClientErrors.push(error);
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
    expect(idleClientErrors.splice(0), 'an idle client error other than 57P01').toEqual([]);
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
    // The teardown's own terminations land after the last afterEach.
    expect(idleClientErrors.splice(0), 'an idle client error other than 57P01').toEqual([]);
  }, 30_000);

  it('swallows only the teardown 57P01 from an idle client and records any other error', async () => {
    const applicationName = 'growth-monitor-idle-error';
    const pool = trackedPool(applicationName);
    // A real idle client: checked out, used, released, still connected.
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    const reported = new Promise<unknown>((resolve) => pool.once('error', resolve));
    await admin.query(
      `SELECT pg_catalog.pg_terminate_backend(pid)
         FROM pg_catalog.pg_stat_activity
        WHERE datname = $1 AND application_name = $2`,
      [VERIFY_DB, applicationName],
    );
    // The real termination carries the code the listener swallows: nothing recorded.
    expect(await reported).toMatchObject({ code: ADMIN_SHUTDOWN });
    expect(idleClientErrors).toEqual([]);
    // Any other idle-client error is recorded, for afterEach to fail the case on.
    const other = Object.assign(new Error('idle client failure'), { code: '08006' });
    pool.emit('error', other, client);
    expect(idleClientErrors).toEqual([other]);
    // This case consumes its own synthetic error, so its afterEach stays green.
    idleClientErrors.splice(0);
  });

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

  it('reads the real keep-forever housing tables through one catalog statement: absent, unknown, then estimated', async () => {
    const pool = trackedPool('freehold-receipt-growth');
    // The monitor names no clock or timer; real ones are bound here, as
    // server/main.ts binds them.
    const scheduleDeadline = (callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    };

    // Not applied yet: to_regclass resolves nothing, and the pass is a healthy
    // absent reading rather than an undefined-table error.
    expect(await readFreeholdReceiptGrowth(pool, scheduleDeadline)).toEqual([
      { table: 'freehold_operation_receipts', present: false, reltuples: null, totalBytes: null },
      { table: 'freehold_plot_claims', present: false, reltuples: null, totalBytes: null },
    ]);

    // The real DDL, applied the way ensureSchema applies it (one transaction,
    // because the fragment uses SET LOCAL), after accounts and characters
    // stand-ins its foreign keys and guard triggers need.
    await pool.query('CREATE TABLE public.accounts (id SERIAL PRIMARY KEY)');
    await pool.query('CREATE TABLE public.characters (id SERIAL PRIMARY KEY, account_id INT)');
    const setup = await pool.connect();
    try {
      await setup.query('BEGIN');
      await setup.query(freeholdClaimSchema('public'));
      await setup.query(freeholdOperationSchema('public'));
      await setup.query('COMMIT');
    } finally {
      setup.release();
    }

    // Never vacuumed or analyzed: PostgreSQL reports reltuples -1, which the
    // monitor renders as UNKNOWN (never zero rows), while the bytes are real.
    const permitRelease = vi.fn();
    const onError = vi.fn();
    const monitor = createFreeholdReceiptGrowthMonitor({
      pool,
      tryAcquireBackgroundPermit: () => ({ release: permitRelease }),
      onError,
      nowMs: () => Date.now(),
      scheduleDeadline,
      scheduleRepeating: () => () => {},
    });
    const fresh = await readFreeholdReceiptGrowth(pool, scheduleDeadline);
    expect(fresh).toHaveLength(2);
    expect(fresh[0]).toMatchObject({ table: 'freehold_operation_receipts', present: true });
    expect(Number(fresh[0]?.reltuples)).toBe(-1);
    expect(fresh[1]).toMatchObject({ table: 'freehold_plot_claims', present: true });
    expect(Number(fresh[1]?.reltuples)).toBe(-1);
    await monitor.refresh();
    const sizeOf = async (table: string) =>
      Number(
        (
          await pool.query(
            `SELECT pg_catalog.pg_total_relation_size($1::text::pg_catalog.regclass) AS size`,
            [`public.${table}`],
          )
        ).rows[0].size,
      );
    const freshBytes = await sizeOf('freehold_operation_receipts');
    const claimsBytes = await sizeOf('freehold_plot_claims');
    expect(freshBytes).toBeGreaterThan(0);
    expect(claimsBytes).toBeGreaterThan(0);
    expect(freeholdReceiptGrowthReadout().tables).toEqual([
      {
        table: 'freehold_operation_receipts',
        present: true,
        rowsEstimate: null,
        bytes: freshBytes,
      },
      { table: 'freehold_plot_claims', present: true, rowsEstimate: null, bytes: claimsBytes },
    ]);

    // Grown and analyzed: the estimate is the planner's figure and the bytes
    // equal pg_total_relation_size exactly, through the same one statement.
    await pool.query(
      `INSERT INTO public.freehold_operation_receipts (operation_id, kind, outcome)
       SELECT 'fop:' || g, 'test_kind', 'cancelled' FROM pg_catalog.generate_series(1, 300) AS g`,
    );
    await pool.query('ANALYZE public.freehold_operation_receipts');
    // The claims table, analyzed EMPTY: a known zero, never the unknown -1.
    await pool.query('ANALYZE public.freehold_plot_claims');
    await monitor.refresh();
    const grownBytes = await sizeOf('freehold_operation_receipts');
    expect(grownBytes).toBeGreaterThan(freshBytes);
    expect(freeholdReceiptGrowthReadout().tables).toEqual([
      {
        table: 'freehold_operation_receipts',
        present: true,
        rowsEstimate: 300,
        bytes: grownBytes,
      },
      {
        table: 'freehold_plot_claims',
        present: true,
        rowsEstimate: 0,
        bytes: await sizeOf('freehold_plot_claims'),
      },
    ]);
    expect(onError).not.toHaveBeenCalled();
    expect(permitRelease).toHaveBeenCalledTimes(2);

    // O(1): the plan touches the catalog only. No plan node scans the receipts
    // table itself, however large it grows.
    const plan = await pool.query(`EXPLAIN (FORMAT JSON) ${FREEHOLD_RECEIPT_GROWTH_SQL}`);
    const relations: string[] = [];
    const walk = (node: Record<string, unknown>) => {
      if (typeof node['Relation Name'] === 'string') relations.push(node['Relation Name']);
      for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? []) walk(child);
    };
    walk((plan.rows[0]['QUERY PLAN'] as Array<{ Plan: Record<string, unknown> }>)[0].Plan);
    expect(relations).toContain('pg_class');
    expect(relations).not.toContain('freehold_operation_receipts');
    expect(relations).not.toContain('freehold_plot_claims');
    expect(relations.every((name) => name === 'pg_class')).toBe(true);

    await monitor.stop();
    await pool.query(
      'DROP TABLE public.freehold_operation_receipts, public.freehold_operations, public.freehold_plot_claims, public.characters, public.accounts CASCADE',
    );
    await closePool(pool);
  });
});
