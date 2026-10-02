// The SQL half of the keep-forever housing growth monitor
// (server/freehold_receipt_growth_monitor.ts, which keeps the scheduling, the
// admission gate and the scrape-time readout): the one catalog statement and
// its bounded execution on an owned client.
//
// O(1) PER PASS, NEVER A COUNT(*): ONE catalog statement reads, for every table
// in FREEHOLD_RECEIPT_GROWTH_TABLES, pg_class.reltuples (the planner's row
// estimate, maintained by vacuum and analyze, and -1 until the table's first
// vacuum or analyze, which renders as UNKNOWN) and pg_total_relation_size (heap,
// indexes and TOAST, from file sizes). Neither scans a heap, so a pass costs the
// list length, not the table size. Each name resolves through to_regclass on
// the session's search_path, exactly as every runtime housing statement names
// its tables unqualified, so a realm whose housing tables live in another
// schema is observed where it writes; a database that has not applied a table
// yet reads it as ABSENT rather than failing the pass. It is not lock-free:
// pg_total_relation_size opens each relation with AccessShareLock (held only
// while that size is read), so it can
// wait behind an ACCESS EXCLUSIVE holder such as a boot DDL transaction; the
// statement timeout below bounds that to one missed telemetry beat.
//
// FREEHOLD_RECEIPT_GROWTH_TABLES is the extension point: 07b's history table
// joins that list and rides the same statement, session and cadence. It lives
// HERE, beside the statement built from it, and the monitor re-exports it as
// the gauge's label vocabulary.
//
// A full pool is refused before checkout, so no telemetry waiter ever sits in
// pg-pool's queue, and an abort (the wall deadline or the monitor's stop)
// releases the client with its cause. The deadline is an injected port
// (scheduleDeadline), so this module never names a wall clock or a timer
// itself (the freehold_* scan in tests/server/freehold_persist.test.ts).

import type { QueryResult, QueryResultRow } from 'pg';

export const FREEHOLD_RECEIPT_GROWTH_MONITOR_WALL_TIMEOUT_MS = 1_500;
export const FREEHOLD_RECEIPT_GROWTH_MONITOR_STATEMENT_TIMEOUT_MS = 1_000;

/** The keep-forever housing tables whose growth is observed rather than swept:
 *  the operation receipts (permanent replay authority) and the plot claims (one
 *  row per plot id ever claimed, kept so a generation never restarts). Fixed,
 *  so it is also the gauge's whole `table` label vocabulary. 07b's history
 *  table joins here. */
export const FREEHOLD_RECEIPT_GROWTH_TABLES = Object.freeze([
  'freehold_operation_receipts',
  'freehold_plot_claims',
] as const);

export type FreeholdReceiptGrowthTable = (typeof FREEHOLD_RECEIPT_GROWTH_TABLES)[number];

/** Arm a one-shot deadline and return its cancel: the housing store's
 *  scheduleDeadline shape (server/freehold_persist.ts). */
export type FreeholdReceiptGrowthDeadline = (callback: () => void, ms: number) => () => void;

/** One statement for the whole list, built once from fixed identifiers. The
 *  slot column keeps the answer in list order. */
function freeholdReceiptGrowthSql(tables: readonly string[]): string {
  const watched = tables
    .map((table, index) => {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
        throw new Error('freehold receipt growth table must be a simple lowercase identifier');
      }
      return `(${index + 1}, '${table}'::text, pg_catalog.to_regclass('${table}'))`;
    })
    .join(',\n               ');
  return `SELECT watched.table_name,
       relation.oid IS NOT NULL AS present,
       relation.reltuples::float8 AS reltuples,
       pg_catalog.pg_total_relation_size(relation.oid) AS total_bytes
  FROM (VALUES ${watched}) AS watched(slot, table_name, relid)
  LEFT JOIN pg_catalog.pg_class AS relation ON relation.oid = watched.relid
 ORDER BY watched.slot`;
}

export const FREEHOLD_RECEIPT_GROWTH_SQL = freeholdReceiptGrowthSql(FREEHOLD_RECEIPT_GROWTH_TABLES);

/** One raw catalog row, as the driver hands it back (float8 arrives as a
 *  number, bigint as a string). Decoded by observeFreeholdReceiptGrowth
 *  (server/freehold_receipt_growth_monitor.ts). */
export interface FreeholdReceiptGrowthRow {
  readonly table: unknown;
  readonly present: unknown;
  readonly reltuples: unknown;
  readonly totalBytes: unknown;
}

export interface FreeholdReceiptGrowthMonitorClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  release(error?: Error | boolean): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}

export interface FreeholdReceiptGrowthMonitorPool {
  connect(): Promise<FreeholdReceiptGrowthMonitorClient>;
  /** Public pg-pool occupancy counters make a non-queuing checkout enforceable
   * without reaching into pg-pool internals. */
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  readonly options: { readonly max: number };
}

export class FreeholdReceiptGrowthMonitorAborted extends Error {
  readonly code = 'FREEHOLD_RECEIPT_GROWTH_MONITOR_ABORTED' as const;

  constructor(message = 'freehold receipt growth monitor read aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export class FreeholdReceiptGrowthMonitorPoolBusy extends Error {
  readonly code = 'FREEHOLD_RECEIPT_GROWTH_MONITOR_POOL_BUSY' as const;

  constructor() {
    super('freehold receipt growth monitor skipped a saturated database pool');
    this.name = 'FreeholdReceiptGrowthMonitorPoolBusy';
  }
}

const pgErrorCode = (error: unknown): string | undefined =>
  (error as { code?: string } | null | undefined)?.code;

const errorForRelease = (error: unknown): Error =>
  error instanceof Error ? error : new Error('PostgreSQL freehold receipt growth monitor failed');

/** Pool checkout itself has no cancellation API. If cancellation wins while a
 * non-full pool is opening a new socket, reject now and destroy any eventual
 * client; pg-pool bounds that underlying connect attempt with its own timeout. */
function acquireMonitorClient(
  pool: FreeholdReceiptGrowthMonitorPool,
  signal: AbortSignal,
): Promise<FreeholdReceiptGrowthMonitorClient> {
  if (signal.aborted) return Promise.reject(new FreeholdReceiptGrowthMonitorAborted());

  // Refuse before connect() when occupancy says this call would queue: a queued
  // checkout cannot be cancelled, so the wall deadline would leave a ghost
  // telemetry waiter ahead of gameplay. The snapshot and connect() happen in one
  // synchronous turn, so another JavaScript caller cannot enter between them.
  if (pool.waitingCount > 0 || (pool.idleCount === 0 && pool.totalCount >= pool.options.max)) {
    return Promise.reject(new FreeholdReceiptGrowthMonitorPoolBusy());
  }

  let checkout: Promise<FreeholdReceiptGrowthMonitorClient>;
  try {
    checkout = pool.connect();
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let state: 'waiting' | 'aborted' | 'settled' = 'waiting';
    let abortError: FreeholdReceiptGrowthMonitorAborted | null = null;
    const detach = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (state !== 'waiting') return;
      state = 'aborted';
      abortError = new FreeholdReceiptGrowthMonitorAborted();
      detach();
      reject(abortError);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    void checkout.then(
      (client) => {
        if (state === 'aborted') {
          client.release(abortError ?? new FreeholdReceiptGrowthMonitorAborted());
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

/** One bounded auto-commit catalog read. SET/RESET use an owned client so the
 * server-side timeout cannot leak to the next borrower. A known SELECT result
 * remains authoritative if RESET fails; only that client is poisoned. */
export async function readFreeholdReceiptGrowth(
  pool: FreeholdReceiptGrowthMonitorPool,
  scheduleDeadline: FreeholdReceiptGrowthDeadline,
  signal?: AbortSignal,
): Promise<readonly FreeholdReceiptGrowthRow[]> {
  const deadline = new AbortController();
  const cancelDeadline = scheduleDeadline(
    () =>
      deadline.abort(
        new FreeholdReceiptGrowthMonitorAborted('freehold receipt growth read timed out'),
      ),
    FREEHOLD_RECEIPT_GROWTH_MONITOR_WALL_TIMEOUT_MS,
  );
  const onOuterAbort = () => deadline.abort(new FreeholdReceiptGrowthMonitorAborted());
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  if (signal?.aborted) onOuterAbort();

  let client: FreeholdReceiptGrowthMonitorClient | null = null;
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
        : new FreeholdReceiptGrowthMonitorAborted();
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
    if (released) throw causalError ?? new FreeholdReceiptGrowthMonitorAborted();

    try {
      await client.query(
        `SET statement_timeout = ${FREEHOLD_RECEIPT_GROWTH_MONITOR_STATEMENT_TIMEOUT_MS}`,
      );
    } catch (error) {
      if (causalError) throw causalError;
      release(errorForRelease(error));
      throw error;
    }
    if (released) throw causalError ?? new FreeholdReceiptGrowthMonitorAborted();

    let result: QueryResult;
    try {
      result = await client.query(FREEHOLD_RECEIPT_GROWTH_SQL);
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

    return result.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        table: row.table_name,
        present: row.present,
        reltuples: row.reltuples,
        totalBytes: row.total_bytes,
      };
    });
  } finally {
    cancelDeadline();
    signal?.removeEventListener('abort', onOuterAbort);
    release();
  }
}
