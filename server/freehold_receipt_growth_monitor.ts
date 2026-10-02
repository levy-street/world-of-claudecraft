// Low-frequency observability for the KEEP-FOREVER housing tables, today the
// operation receipts (freehold_operation_receipts, server/freehold_operation_db.ts).
// A receipt is the tombstone of a closed housing operation and PERMANENT replay
// authority: deleting one would re-enable its operation, and no signed
// replay-horizon evidence exists that would make a sweep safe, so the retention
// sweep deliberately has no arm for it (pinned absent by
// tests/server/main_retention_wiring.test.ts). Its growth is OBSERVED instead of
// swept: this monitor refreshes a process-local readout once a minute, and the
// woc_freehold_receipt_growth gauge (server/http/game_metrics.ts) reads that
// readout at scrape time, so a scrape never queries PostgreSQL. The shape is the
// bank ledger growth monitor's (server/bank_ledger_growth_monitor.ts).
//
// O(1) PER PASS, NEVER A COUNT(*): the one catalog statement, its watched-table
// list (the extension point 07b's history table joins) and its bounded
// execution live in server/freehold_receipt_growth_db.ts, which says why a pass
// costs the list length and not the table size. This module keeps the
// scheduling, the admission gate and the scrape-time readout.
//
// Admission mirrors the bank monitor: tryAcquire on the shared background gate,
// so a busy gate skips the pass instead of queueing ahead of durability work, and
// a full pool is refused before checkout, so no telemetry waiter ever sits in
// pg-pool's queue. Active SQL is aborted and drained on stop, which main.ts
// awaits before pool.end(); if a non-full pool was opening a brand new socket,
// pg-pool may finish that attempt under its bounded connection timeout and
// pool.end() remains the final teardown authority. Every clock and timer is an
// injected port (nowMs, scheduleDeadline, scheduleRepeating), bound at the
// composition root in server/main.ts, so this module never names a wall clock
// or a timer itself (the freehold_* scan in tests/server/freehold_persist.test.ts)
// and its tests drive time by hand. The main-thread cost of a
// pass is one async round trip plus decoding one row per watched table,
// independent of how large any table grows, so, like the bank monitor, it bills
// nothing to the tick profiler.

import type { BackgroundDbPermit } from './background_db_gate';
import { boundedDatabaseError } from './freehold_bounded_error';
import {
  FREEHOLD_RECEIPT_GROWTH_TABLES,
  type FreeholdReceiptGrowthDeadline,
  FreeholdReceiptGrowthMonitorAborted,
  type FreeholdReceiptGrowthMonitorPool,
  FreeholdReceiptGrowthMonitorPoolBusy,
  type FreeholdReceiptGrowthRow,
  type FreeholdReceiptGrowthTable,
  readFreeholdReceiptGrowth,
} from './freehold_receipt_growth_db';

// Re-exported for the importers that name the monitor: the watched list is the
// gauge's label vocabulary (server/http/game_metrics.ts), and the statement and
// the read are what the bank and housing growth pg suite executes.
export {
  FREEHOLD_RECEIPT_GROWTH_SQL,
  FREEHOLD_RECEIPT_GROWTH_TABLES,
  type FreeholdReceiptGrowthTable,
  readFreeholdReceiptGrowth,
} from './freehold_receipt_growth_db';

export const FREEHOLD_RECEIPT_GROWTH_MONITOR_INTERVAL_MS = 60_000;

/** Arm the repeating pass and return its cancel. The binding must not hold the
 *  process open (main.ts unrefs it). */
export type FreeholdReceiptGrowthRepeat = (callback: () => void, ms: number) => () => void;

export interface FreeholdReceiptGrowthReading {
  readonly table: FreeholdReceiptGrowthTable;
  /** False when to_regclass resolved nothing: this database has not applied
   *  the table, so it has no measure at all. */
  readonly present: boolean;
  /** pg_class.reltuples, rounded. Null while PostgreSQL does not know (-1,
   *  before the table's first vacuum or analyze) and when absent. */
  readonly rowsEstimate: number | null;
  /** pg_total_relation_size. Null only when absent. */
  readonly bytes: number | null;
}

export interface FreeholdReceiptGrowthReadout {
  /** One reading per watched table, in list order; empty before the first
   *  accepted pass. */
  readonly tables: readonly FreeholdReceiptGrowthReading[];
  /** When the pass behind `tables` STARTED; null before the first one. */
  readonly observedAtMs: number | null;
}

/** undefined means malformed; null means PostgreSQL does not know yet. */
function decodeRowsEstimate(value: unknown): number | null | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  // -1 is the never-vacuumed, never-analyzed value: an estimate of nothing,
  // never zero rows.
  if (parsed < 0) return null;
  const rounded = Math.round(parsed);
  return Number.isSafeInteger(rounded) ? rounded : undefined;
}

function decodeBytes(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Decode one pass's rows against the fixed list, or null when the answer is
 *  malformed (a missing, extra or reordered row, or an undecodable value). */
export function decodeFreeholdReceiptGrowthRows(
  rows: readonly FreeholdReceiptGrowthRow[],
): readonly FreeholdReceiptGrowthReading[] | null {
  if (rows.length !== FREEHOLD_RECEIPT_GROWTH_TABLES.length) return null;
  const readings: FreeholdReceiptGrowthReading[] = [];
  for (const [index, table] of FREEHOLD_RECEIPT_GROWTH_TABLES.entries()) {
    const row = rows[index];
    if (row.table !== table) return null;
    if (row.present !== true && row.present !== false) return null;
    // A relation dropped between to_regclass and the size read answers a NULL
    // size: that is absence, not a malformed reading.
    if (row.present === false || row.totalBytes === null) {
      readings.push(Object.freeze({ table, present: false, rowsEstimate: null, bytes: null }));
      continue;
    }
    const rowsEstimate = decodeRowsEstimate(row.reltuples);
    const bytes = decodeBytes(row.totalBytes);
    if (rowsEstimate === undefined || bytes === null) return null;
    readings.push(Object.freeze({ table, present: true, rowsEstimate, bytes }));
  }
  return Object.freeze(readings);
}

// Process-local. Only this module's monitor writes it, one pass at a time
// (refresh coalesces), so unlike the bank budget no ordering ticket is needed:
// no other writer can observe the database later than an in-flight pass.
let observedTables: readonly FreeholdReceiptGrowthReading[] = Object.freeze([]);
let observedAtMs: number | null = null;

/** Record one pass for the scrape-time gauge. False (and nothing recorded)
 *  when the rows are malformed, which the monitor reports as a failure. */
export function observeFreeholdReceiptGrowth(
  rows: readonly FreeholdReceiptGrowthRow[],
  nowMs: number,
): boolean {
  const readings = decodeFreeholdReceiptGrowthRows(rows);
  if (readings === null || !Number.isFinite(nowMs) || nowMs < 0) return false;
  observedTables = readings;
  observedAtMs = nowMs;
  return true;
}

export function freeholdReceiptGrowthReadout(): FreeholdReceiptGrowthReadout {
  return Object.freeze({ tables: observedTables, observedAtMs });
}

export interface FreeholdReceiptGrowthMonitorDeps {
  readonly pool: FreeholdReceiptGrowthMonitorPool;
  /** Immediate admission only: telemetry never queues ahead of durability. */
  readonly tryAcquireBackgroundPermit: () => BackgroundDbPermit | null;
  /** The clock and timer ports, bound by the composition root (server/main.ts). */
  readonly nowMs: () => number;
  /** Bounds the default read's wall time. */
  readonly scheduleDeadline: FreeholdReceiptGrowthDeadline;
  readonly scheduleRepeating: FreeholdReceiptGrowthRepeat;
  readonly read?: (
    pool: FreeholdReceiptGrowthMonitorPool,
    signal: AbortSignal,
  ) => Promise<readonly FreeholdReceiptGrowthRow[]>;
  /** False means the catalog answer was malformed, which is a monitor failure.
   * The timestamp is claimed BEFORE the read, so the readout's age describes
   * the snapshot. */
  readonly observe?: (rows: readonly FreeholdReceiptGrowthRow[], observedAtMs: number) => boolean;
  /** Handed the BOUNDED classification (boundedDatabaseError), never the raw
   *  error: a pg error's `detail` can carry row content into the log line. */
  readonly onError?: (error: Readonly<Record<string, unknown>>) => void;
  readonly intervalMs?: number;
}

export interface FreeholdReceiptGrowthMonitor {
  refresh(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export function createFreeholdReceiptGrowthMonitor(
  deps: FreeholdReceiptGrowthMonitorDeps,
): FreeholdReceiptGrowthMonitor {
  const read =
    deps.read ??
    ((pool: FreeholdReceiptGrowthMonitorPool, signal: AbortSignal) =>
      readFreeholdReceiptGrowth(pool, deps.scheduleDeadline, signal));
  const observe = deps.observe ?? observeFreeholdReceiptGrowth;
  const intervalMs = deps.intervalMs ?? FREEHOLD_RECEIPT_GROWTH_MONITOR_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError(
      'freehold receipt growth monitor interval must be a positive safe integer',
    );
  }

  let cancelRepeat: (() => void) | null = null;
  let running: Promise<void> | null = null;
  let activeAbort: AbortController | null = null;
  let stopped = false;
  let failureStreak = false;

  const report = (error: unknown) => {
    if (failureStreak || stopped) return;
    failureStreak = true;
    try {
      deps.onError?.(boundedDatabaseError(error));
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
        // Inside the try: a clock port that throws is a reported failure whose
        // permit still returns and whose abort handle still clears.
        const startedAtMs = deps.nowMs();
        const rows = await read(deps.pool, controller.signal);
        if (stopped || controller.signal.aborted) return;
        if (!observe(rows, startedAtMs)) {
          throw new Error('freehold receipt growth monitor returned malformed catalog values');
        }
        failureStreak = false;
      } catch (error) {
        if (
          !stopped &&
          !controller.signal.aborted &&
          !(error instanceof FreeholdReceiptGrowthMonitorPoolBusy)
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
      if (stopped || cancelRepeat !== null) return;
      void refresh();
      cancelRepeat = deps.scheduleRepeating(() => void refresh(), intervalMs);
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (cancelRepeat !== null) {
        cancelRepeat();
        cancelRepeat = null;
      }
      activeAbort?.abort(new FreeholdReceiptGrowthMonitorAborted());
      if (running) await running.catch(() => {});
    },
  };
}
