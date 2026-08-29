// Low-frequency observability for the database-wide bank-ledger growth
// singleton. Enforcement remains entirely inside PostgreSQL; this monitor only
// refreshes the process-local Prometheus projection before the hard ceiling is
// reached. One indexed point read per minute is deliberately independent of
// ledger writes and never queues on a saturated pool. Active SQL is aborted
// and drained on shutdown; if an otherwise non-full pool was opening a brand
// new socket, pg-pool may finish that attempt under its bounded connection
// timeout and pool.end() remains the final teardown authority.

import type { QueryResult, QueryResultRow } from 'pg';
import type { BackgroundDbPermit } from './background_db_gate';
import { observeBankLedgerGrowthBudget } from './bank_ledger_growth_budget';

export const BANK_LEDGER_GROWTH_MONITOR_INTERVAL_MS = 60_000;
export const BANK_LEDGER_GROWTH_MONITOR_WALL_TIMEOUT_MS = 1_500;
export const BANK_LEDGER_GROWTH_MONITOR_STATEMENT_TIMEOUT_MS = 1_000;

/** Fraction of the hard limit at which the warn arm fires. Without it, the
 * first operator signal for a filling ledger is players being refused at the
 * ceiling; 0.8 matches the paging guidance in DEPLOY.md. */
export const BANK_LEDGER_GROWTH_WARN_FRACTION = 0.8;

/** Same tolerant integer decoding the budget observer applies to raw driver
 * values (BIGINT arrives as a string). */
function warnSafeCount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** True when the observed lifetime insert count has crossed the warn fraction
 * of the hard limit. Tolerates raw driver values; anything malformed reads as
 * not-warning (the monitor separately fails the refresh on malformed rows). */
export function bankLedgerGrowthWarningActive(
  committedRows: unknown,
  hardLimitRows: unknown,
): boolean {
  const committed = warnSafeCount(committedRows);
  const limit = warnSafeCount(hardLimitRows);
  if (committed === null || limit === null || limit <= 0) return false;
  return committed >= limit * BANK_LEDGER_GROWTH_WARN_FRACTION;
}

/** One console.warn per process CROSSING of the warn fraction: latched while
 * the condition holds, re-armed if the observation drops back below (a raised
 * limit after a restarted process, or a re-seeded singleton). The gauge arm
 * (limit_warning on woc_bank_ledger_growth_budget) is the alertable signal;
 * this line is the human breadcrumb in the realm log. */
export function createBankLedgerGrowthWarnLatch(
  warn: (message: string) => void = (message) => console.warn(message),
): (committedRows: unknown, hardLimitRows: unknown) => void {
  let armed = true;
  return (committedRows, hardLimitRows) => {
    if (!bankLedgerGrowthWarningActive(committedRows, hardLimitRows)) {
      armed = true;
      return;
    }
    if (!armed) return;
    armed = false;
    warn(
      `bank ledger growth budget crossed ${BANK_LEDGER_GROWTH_WARN_FRACTION} of the hard limit (${String(committedRows)} of ${String(hardLimitRows)} lifetime inserted rows): plan capacity work before the ceiling refuses ledger writes (woc_bank_ledger_growth_budget{measure="limit_warning"})`,
    );
  };
}

export interface BankLedgerGrowthMonitorClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  release(error?: Error | boolean): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}

export interface BankLedgerGrowthMonitorPool {
  connect(): Promise<BankLedgerGrowthMonitorClient>;
  /** Public pg-pool occupancy counters make a non-queuing checkout enforceable
   * without reaching into pg-pool internals. */
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  readonly options: { readonly max: number };
}

export interface BankLedgerGrowthBudgetRow {
  readonly committedRows: unknown;
  readonly hardLimitRows: unknown;
}

export class BankLedgerGrowthMonitorAborted extends Error {
  readonly code = 'BANK_LEDGER_GROWTH_MONITOR_ABORTED' as const;

  constructor(message = 'bank ledger growth monitor read aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export class BankLedgerGrowthMonitorPoolBusy extends Error {
  readonly code = 'BANK_LEDGER_GROWTH_MONITOR_POOL_BUSY' as const;

  constructor() {
    super('bank ledger growth monitor skipped a saturated database pool');
    this.name = 'BankLedgerGrowthMonitorPoolBusy';
  }
}

const pgErrorCode = (error: unknown): string | undefined =>
  (error as { code?: string } | null | undefined)?.code;

const errorForRelease = (error: unknown): Error =>
  error instanceof Error ? error : new Error('PostgreSQL bank-ledger growth monitor failed');

/** Pool checkout itself has no cancellation API. If cancellation wins while a
 * non-full pool is opening a new socket, reject now and destroy any eventual
 * client; pg-pool bounds that underlying connect attempt with its own timeout. */
function acquireMonitorClient(
  pool: BankLedgerGrowthMonitorPool,
  signal: AbortSignal,
): Promise<BankLedgerGrowthMonitorClient> {
  if (signal.aborted) return Promise.reject(new BankLedgerGrowthMonitorAborted());

  // pg-pool does not expose cancellation for a queued checkout. Refuse before
  // connect() when production occupancy says this call would queue, otherwise
  // the wall deadline could leave a ghost telemetry waiter ahead of gameplay
  // for the remainder of connectionTimeoutMillis. The snapshot and connect()
  // happen in one synchronous turn, so another JavaScript caller cannot enter
  // between them. A non-full pool may still open a new connection; an idle
  // client may be borrowed immediately.
  if (pool.waitingCount > 0 || (pool.idleCount === 0 && pool.totalCount >= pool.options.max)) {
    return Promise.reject(new BankLedgerGrowthMonitorPoolBusy());
  }

  let checkout: Promise<BankLedgerGrowthMonitorClient>;
  try {
    checkout = pool.connect();
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let state: 'waiting' | 'aborted' | 'settled' = 'waiting';
    let abortError: BankLedgerGrowthMonitorAborted | null = null;
    const detach = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (state !== 'waiting') return;
      state = 'aborted';
      abortError = new BankLedgerGrowthMonitorAborted();
      detach();
      reject(abortError);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    void checkout.then(
      (client) => {
        if (state === 'aborted') {
          client.release(abortError ?? new BankLedgerGrowthMonitorAborted());
          return;
        }
        state = 'settled';
        detach();
        resolve(client);
      },
      (error) => {
        if (state !== 'waiting') return;
        state = 'settled';
        detach();
        reject(error);
      },
    );
  });
}

/** One bounded auto-commit primary-key read. SET/RESET use an owned client so
 * the server-side timeout cannot leak to the next borrower. A known SELECT
 * result remains authoritative if RESET fails; only that client is poisoned. */
export async function readBankLedgerGrowthBudget(
  pool: BankLedgerGrowthMonitorPool,
  signal?: AbortSignal,
): Promise<BankLedgerGrowthBudgetRow> {
  const deadline = new AbortController();
  const timeout = setTimeout(
    () => deadline.abort(new BankLedgerGrowthMonitorAborted('bank ledger growth read timed out')),
    BANK_LEDGER_GROWTH_MONITOR_WALL_TIMEOUT_MS,
  );
  timeout.unref();
  const onOuterAbort = () => deadline.abort(new BankLedgerGrowthMonitorAborted());
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  if (signal?.aborted) onOuterAbort();

  let client: BankLedgerGrowthMonitorClient | null = null;
  let released = false;
  let causalError: Error | null = null;
  let clientErrorListenerAttached = false;
  let abortListenerAttached = false;

  const detach = () => {
    if (abortListenerAttached) {
      abortListenerAttached = false;
      deadline.signal.removeEventListener('abort', onAbort);
    }
    if (client && clientErrorListenerAttached) {
      clientErrorListenerAttached = false;
      client.removeListener('error', onClientError);
    }
  };
  const release = (error?: Error) => {
    if (!client || released) return;
    released = true;
    detach();
    if (error) client.release(error);
    else client.release();
  };
  const onAbort = () => {
    if (released) return;
    causalError =
      deadline.signal.reason instanceof Error
        ? deadline.signal.reason
        : new BankLedgerGrowthMonitorAborted();
    release(causalError);
  };
  const onClientError = (error: Error) => {
    if (released) return;
    causalError = error;
    release(error);
  };

  try {
    client = await acquireMonitorClient(pool, deadline.signal);
    client.on('error', onClientError);
    clientErrorListenerAttached = true;
    deadline.signal.addEventListener('abort', onAbort, { once: true });
    abortListenerAttached = true;
    if (deadline.signal.aborted) onAbort();
    if (released) throw causalError ?? new BankLedgerGrowthMonitorAborted();

    try {
      await client.query(
        `SET statement_timeout = ${BANK_LEDGER_GROWTH_MONITOR_STATEMENT_TIMEOUT_MS}`,
      );
    } catch (error) {
      if (causalError) throw causalError;
      release(errorForRelease(error));
      throw error;
    }
    if (released) throw causalError ?? new BankLedgerGrowthMonitorAborted();

    let result: QueryResult;
    try {
      result = await client.query(
        `SELECT committed_rows, hard_limit_rows
           FROM public.bank_ledger_growth_budget
          WHERE singleton = TRUE`,
      );
    } catch (error) {
      if (causalError) throw causalError;
      if (pgErrorCode(error) === undefined) {
        release(errorForRelease(error));
      } else {
        try {
          await client.query('RESET statement_timeout');
          release();
        } catch (resetError) {
          release(errorForRelease(resetError));
        }
      }
      throw error;
    }

    if (!released) {
      try {
        await client.query('RESET statement_timeout');
        release();
      } catch (resetError) {
        release(errorForRelease(resetError));
      }
    }

    if (result.rows.length !== 1) {
      throw new Error('bank ledger growth budget singleton is missing or duplicated');
    }
    const row = result.rows[0] as Record<string, unknown>;
    return {
      committedRows: row.committed_rows,
      hardLimitRows: row.hard_limit_rows,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onOuterAbort);
    release();
  }
}

export interface BankLedgerGrowthMonitorDeps {
  readonly pool: BankLedgerGrowthMonitorPool;
  /** Immediate admission only: telemetry never queues ahead of durability. */
  readonly tryAcquireBackgroundPermit: () => BackgroundDbPermit | null;
  readonly read?: (
    pool: BankLedgerGrowthMonitorPool,
    signal: AbortSignal,
  ) => Promise<BankLedgerGrowthBudgetRow>;
  /** False means the database row was malformed or disagreed with this
   * process's configured durable limit, which is a monitor failure. */
  readonly observe?: (committedRows: unknown, hardLimitRows: unknown) => boolean;
  readonly onError?: (error: unknown) => void;
  /** Sink for the latched warn-fraction crossing line (default console.warn). */
  readonly warn?: (message: string) => void;
  readonly intervalMs?: number;
}

export interface BankLedgerGrowthMonitor {
  refresh(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export function createBankLedgerGrowthMonitor(
  deps: BankLedgerGrowthMonitorDeps,
): BankLedgerGrowthMonitor {
  const read = deps.read ?? readBankLedgerGrowthBudget;
  const observe = deps.observe ?? observeBankLedgerGrowthBudget;
  const warnLatch = createBankLedgerGrowthWarnLatch(deps.warn);
  const intervalMs = deps.intervalMs ?? BANK_LEDGER_GROWTH_MONITOR_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError('bank ledger growth monitor interval must be a positive safe integer');
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  let activeAbort: AbortController | null = null;
  let stopped = false;
  let failureStreak = false;

  const report = (error: unknown) => {
    if (failureStreak || stopped) return;
    failureStreak = true;
    try {
      deps.onError?.(error);
    } catch {
      // A diagnostic sink cannot turn a voided interval into a rejection.
    }
  };

  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    const run = (async () => {
      let permit: BackgroundDbPermit | null;
      try {
        permit = deps.tryAcquireBackgroundPermit();
      } catch (error) {
        report(error);
        return;
      }
      if (!permit) return;

      const controller = new AbortController();
      activeAbort = controller;
      try {
        const row = await read(deps.pool, controller.signal);
        if (stopped || controller.signal.aborted) return;
        if (!observe(row.committedRows, row.hardLimitRows)) {
          throw new Error('bank ledger growth monitor returned invalid durable budget values');
        }
        // Only an accepted observation drives the warn latch: the values were
        // just validated against this process's configured durable limit.
        warnLatch(row.committedRows, row.hardLimitRows);
        failureStreak = false;
      } catch (error) {
        if (
          !stopped &&
          !controller.signal.aborted &&
          !(error instanceof BankLedgerGrowthMonitorPoolBusy)
        ) {
          report(error);
        }
      } finally {
        if (activeAbort === controller) activeAbort = null;
        permit.release();
      }
    })().finally(() => {
      if (running === run) running = null;
    });
    running = run;
    return run;
  };

  return {
    refresh,
    start(): void {
      if (stopped || timer !== null) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
      timer.unref?.();
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      activeAbort?.abort(new BankLedgerGrowthMonitorAborted());
      if (running) await running.catch(() => {});
    },
  };
}
