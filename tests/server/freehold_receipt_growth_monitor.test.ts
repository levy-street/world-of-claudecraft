// Guards: the keep-forever housing growth monitor
// (server/freehold_receipt_growth_monitor.ts, with its SQL half
// server/freehold_receipt_growth_db.ts): its one O(1) catalog statement
// pinned as a literal (never a COUNT), the -1 never-vacuumed estimate rendered
// unknown, a missing table read as absent, the admission rules (it yields when
// the background gate is busy and never queues on a full pool) and the stop
// drain. The nearest suite, tests/server/bank_ledger_growth_monitor.test.ts,
// pins the bank singleton read, which watches no housing table.
//
// Cost: 0.2 s

import { EventEmitter } from 'node:events';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  FREEHOLD_RECEIPT_GROWTH_MONITOR_STATEMENT_TIMEOUT_MS,
  FREEHOLD_RECEIPT_GROWTH_MONITOR_WALL_TIMEOUT_MS,
  FREEHOLD_RECEIPT_GROWTH_SQL,
  FREEHOLD_RECEIPT_GROWTH_TABLES,
  type FreeholdReceiptGrowthDeadline,
  type FreeholdReceiptGrowthMonitorClient,
  type FreeholdReceiptGrowthMonitorPool,
  FreeholdReceiptGrowthMonitorPoolBusy,
  type FreeholdReceiptGrowthRow,
  readFreeholdReceiptGrowth,
} from '../../server/freehold_receipt_growth_db';
import {
  createFreeholdReceiptGrowthMonitor,
  decodeFreeholdReceiptGrowthRows,
  FREEHOLD_RECEIPT_GROWTH_MONITOR_INTERVAL_MS,
  freeholdReceiptGrowthReadout,
  readFreeholdReceiptGrowth as monitorReexportedRead,
  FREEHOLD_RECEIPT_GROWTH_SQL as monitorReexportedSql,
  FREEHOLD_RECEIPT_GROWTH_TABLES as monitorReexportedTables,
  observeFreeholdReceiptGrowth,
} from '../../server/freehold_receipt_growth_monitor';

// The exact statement, as a literal: a rewrite that reaches for COUNT(*), drops
// to_regclass, or adds a second statement has to change this pin on purpose.
const PINNED_SQL = `SELECT watched.table_name,
       relation.oid IS NOT NULL AS present,
       relation.reltuples::float8 AS reltuples,
       pg_catalog.pg_total_relation_size(relation.oid) AS total_bytes
  FROM (VALUES (1, 'freehold_operation_receipts'::text, pg_catalog.to_regclass('freehold_operation_receipts')),
               (2, 'freehold_plot_claims'::text, pg_catalog.to_regclass('freehold_plot_claims'))) AS watched(slot, table_name, relid)
  LEFT JOIN pg_catalog.pg_class AS relation ON relation.oid = watched.relid
 ORDER BY watched.slot`;

const result = <Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> =>
  ({ rows, rowCount: rows.length }) as QueryResult<Row>;

function clientWithQuery(
  query: FreeholdReceiptGrowthMonitorClient['query'],
  release = vi.fn<(error?: Error | boolean) => void>(),
): FreeholdReceiptGrowthMonitorClient {
  const events = new EventEmitter();
  return {
    query,
    release,
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  };
}

function availablePool(
  connect: FreeholdReceiptGrowthMonitorPool['connect'] = vi.fn(),
): FreeholdReceiptGrowthMonitorPool {
  return { connect, totalCount: 0, idleCount: 0, waitingCount: 0, options: { max: 1 } };
}

// The module names no clock or timer (the freehold_* scan): every case binds
// the ports. A deadline that never fires suits the cases that do not drive time.
const idleDeadline: FreeholdReceiptGrowthDeadline = () => () => {};
const PORTS = {
  nowMs: () => 0,
  scheduleDeadline: idleDeadline,
  scheduleRepeating: () => () => {},
};

const presentRow = (reltuples: unknown, totalBytes: unknown): FreeholdReceiptGrowthRow => ({
  table: 'freehold_operation_receipts',
  present: true,
  reltuples,
  totalBytes,
});

/** The second watched table (the keep-forever plot claims), present and
 *  vacuumed: every whole answer carries it after the receipts row. */
const CLAIMS_ROW: FreeholdReceiptGrowthRow = {
  table: 'freehold_plot_claims',
  present: true,
  reltuples: 7,
  totalBytes: '8192',
};
const CLAIMS_RAW = {
  table_name: 'freehold_plot_claims',
  present: true,
  reltuples: 7,
  total_bytes: '8192',
};
const CLAIMS_READING = {
  table: 'freehold_plot_claims',
  present: true,
  rowsEstimate: 7,
  bytes: 8192,
};
/** One whole answer, in list order: the receipts row given, then the claims. */
const pass = (receipts: FreeholdReceiptGrowthRow): FreeholdReceiptGrowthRow[] => [
  receipts,
  CLAIMS_ROW,
];

describe('freehold receipt growth monitor: the catalog read', () => {
  it('pins its low-frequency and fail-fast bounds and the watched list', () => {
    expect(FREEHOLD_RECEIPT_GROWTH_MONITOR_INTERVAL_MS).toBe(60_000);
    expect(FREEHOLD_RECEIPT_GROWTH_MONITOR_WALL_TIMEOUT_MS).toBe(1_500);
    expect(FREEHOLD_RECEIPT_GROWTH_MONITOR_STATEMENT_TIMEOUT_MS).toBe(1_000);
    expect([...FREEHOLD_RECEIPT_GROWTH_TABLES]).toEqual([
      'freehold_operation_receipts',
      'freehold_plot_claims',
    ]);
    expect(Object.isFrozen(FREEHOLD_RECEIPT_GROWTH_TABLES)).toBe(true);
  });

  it('is one O(1) catalog statement, pinned as a literal, never a COUNT', () => {
    expect(FREEHOLD_RECEIPT_GROWTH_SQL).toBe(PINNED_SQL);
    expect(FREEHOLD_RECEIPT_GROWTH_SQL).not.toMatch(/count\s*\(/i);
    expect(FREEHOLD_RECEIPT_GROWTH_SQL.split(';')).toHaveLength(1);
  });

  it('keeps the statement and its execution in the SQL module, the monitor re-exporting the same bindings', () => {
    // The gauge and the pg suites still name the monitor; what they reach is
    // the one statement, list and read the SQL module owns, not a copy.
    expect(monitorReexportedSql).toBe(FREEHOLD_RECEIPT_GROWTH_SQL);
    expect(monitorReexportedTables).toBe(FREEHOLD_RECEIPT_GROWTH_TABLES);
    expect(monitorReexportedRead).toBe(readFreeholdReceiptGrowth);
  });

  it('runs that exact text under an owned server timeout and resets the client', async () => {
    const release = vi.fn();
    const queryMock = vi.fn(async (text: string) => {
      if (text === PINNED_SQL) {
        return result([
          {
            table_name: 'freehold_operation_receipts',
            present: true,
            reltuples: 1234,
            total_bytes: '57344',
          },
          CLAIMS_RAW,
        ]);
      }
      return result([]);
    });
    const client = clientWithQuery(
      queryMock as FreeholdReceiptGrowthMonitorClient['query'],
      release,
    );

    await expect(
      readFreeholdReceiptGrowth(availablePool(vi.fn(async () => client)), idleDeadline),
    ).resolves.toEqual(pass(presentRow(1234, '57344')));
    expect(queryMock.mock.calls.map(([text]) => text)).toEqual([
      'SET statement_timeout = 1000',
      PINNED_SQL,
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
      if (text === PINNED_SQL) {
        return result([
          { table_name: 'freehold_operation_receipts', present: false, reltuples: null },
          CLAIMS_RAW,
        ]);
      }
      return result([]);
    }) as FreeholdReceiptGrowthMonitorClient['query'];

    await expect(
      readFreeholdReceiptGrowth(
        availablePool(vi.fn(async () => clientWithQuery(query, release))),
        idleDeadline,
      ),
    ).resolves.toEqual([
      {
        table: 'freehold_operation_receipts',
        present: false,
        reltuples: null,
        totalBytes: undefined,
      },
      CLAIMS_ROW,
    ]);
    expect(release).toHaveBeenCalledWith(resetError);
  });

  it('resets and reuses the client after a completed SQLSTATE failure', async () => {
    const pgError = Object.assign(new Error('statement timeout'), { code: '57014' });
    const release = vi.fn();
    const queryMock = vi.fn(async (text: string) => {
      if (text.startsWith('SET ') || text === 'RESET statement_timeout') return result([]);
      throw pgError;
    });
    const client = clientWithQuery(
      queryMock as FreeholdReceiptGrowthMonitorClient['query'],
      release,
    );

    await expect(
      readFreeholdReceiptGrowth(availablePool(vi.fn(async () => client)), idleDeadline),
    ).rejects.toBe(pgError);
    expect(queryMock.mock.calls.map(([text]) => text)).toEqual([
      'SET statement_timeout = 1000',
      PINNED_SQL,
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
    const client = clientWithQuery(
      queryMock as FreeholdReceiptGrowthMonitorClient['query'],
      release,
    );

    await expect(
      readFreeholdReceiptGrowth(availablePool(vi.fn(async () => client)), idleDeadline),
    ).rejects.toBe(selectError);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(selectError);
  });

  it.each([
    { label: 'an existing waiter', totalCount: 1, idleCount: 1, waitingCount: 1 },
    { label: 'a full pool with no idle client', totalCount: 1, idleCount: 0, waitingCount: 0 },
  ])('refuses checkout without queueing behind $label', async (occupancy) => {
    const connect = vi.fn();
    const pool: FreeholdReceiptGrowthMonitorPool = { connect, ...occupancy, options: { max: 1 } };

    await expect(readFreeholdReceiptGrowth(pool, idleDeadline)).rejects.toBeInstanceOf(
      FreeholdReceiptGrowthMonitorPoolBusy,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('borrows an idle client when the pool is fully grown but not saturated', async () => {
    const release = vi.fn();
    const queryMock = vi.fn(async () => result([]));
    const client = clientWithQuery(
      queryMock as FreeholdReceiptGrowthMonitorClient['query'],
      release,
    );
    const connect = vi.fn(async () => client);

    await expect(
      readFreeholdReceiptGrowth(
        { connect, totalCount: 1, idleCount: 1, waitingCount: 0, options: { max: 1 } },
        idleDeadline,
      ),
    ).resolves.toEqual([]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith();
  });

  it('rejects a pre-aborted read without attempting pool checkout', async () => {
    const controller = new AbortController();
    controller.abort();
    const connect = vi.fn();

    await expect(
      readFreeholdReceiptGrowth(availablePool(connect), idleDeadline, controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
      code: 'FREEHOLD_RECEIPT_GROWTH_MONITOR_ABORTED',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects a cancelled checkout and destroys the client if it arrives later', async () => {
    let resolveCheckout!: (client: FreeholdReceiptGrowthMonitorClient) => void;
    const checkout = new Promise<FreeholdReceiptGrowthMonitorClient>((resolve) => {
      resolveCheckout = resolve;
    });
    const pool = availablePool(vi.fn(() => checkout));
    const controller = new AbortController();
    const pending = readFreeholdReceiptGrowth(pool, idleDeadline, controller.signal);
    await vi.waitFor(() => expect(pool.connect).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    const query = vi.fn();
    const release = vi.fn();
    resolveCheckout(clientWithQuery(query as FreeholdReceiptGrowthMonitorClient['query'], release));
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(query).not.toHaveBeenCalled();
    expect(release.mock.calls[0]?.[0]).toMatchObject({ name: 'AbortError' });
  });

  it('arms its wall deadline through the port, aborts on it, and destroys the client', async () => {
    let expire: (() => void) | null = null;
    const armedMs: number[] = [];
    const cancel = vi.fn();
    const deadline: FreeholdReceiptGrowthDeadline = (callback, ms) => {
      expire = callback;
      armedMs.push(ms);
      return cancel;
    };
    let rejectRead: ((error: Error) => void) | null = null;
    const release = vi.fn((error?: Error | boolean) => {
      if (error instanceof Error) rejectRead?.(error);
    });
    const query = vi.fn((text: string) => {
      if (text.startsWith('SET statement_timeout')) return Promise.resolve(result([]));
      return new Promise<QueryResult>((_resolve, reject) => {
        rejectRead = reject;
      });
    }) as FreeholdReceiptGrowthMonitorClient['query'];
    const pending = readFreeholdReceiptGrowth(
      availablePool(vi.fn(async () => clientWithQuery(query, release))),
      deadline,
    );
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      code: 'FREEHOLD_RECEIPT_GROWTH_MONITOR_ABORTED',
      message: expect.stringContaining('timed out'),
    });
    expect(armedMs).toEqual([FREEHOLD_RECEIPT_GROWTH_MONITOR_WALL_TIMEOUT_MS]);

    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    (expire as unknown as () => void)();

    await rejection;
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[0]).toMatchObject({ name: 'AbortError' });
    // The deadline is disarmed on the way out, whichever way the read ended.
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('disarms the wall deadline after a healthy read', async () => {
    const cancel = vi.fn();
    const client = clientWithQuery(
      vi.fn(async () => result([])) as FreeholdReceiptGrowthMonitorClient['query'],
    );
    await readFreeholdReceiptGrowth(availablePool(vi.fn(async () => client)), () => cancel);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('freehold receipt growth monitor: decoding and the readout', () => {
  it('renders the -1 never-vacuumed estimate as unknown, never as zero rows', () => {
    expect(decodeFreeholdReceiptGrowthRows(pass(presentRow(-1, '16384')))).toEqual([
      { table: 'freehold_operation_receipts', present: true, rowsEstimate: null, bytes: 16384 },
      CLAIMS_READING,
    ]);
    // A real zero (vacuumed, empty) stays a known zero, and an estimate rounds.
    expect(decodeFreeholdReceiptGrowthRows(pass(presentRow(0, '8192')))?.[0]?.rowsEstimate).toBe(0);
    expect(decodeFreeholdReceiptGrowthRows(pass(presentRow(1234.6, 8192)))?.[0]?.rowsEstimate).toBe(
      1235,
    );
  });

  it('reads a missing table as absent, with no measure at all', () => {
    const absent = {
      table: 'freehold_operation_receipts',
      present: false,
      rowsEstimate: null,
      bytes: null,
    };
    expect(
      decodeFreeholdReceiptGrowthRows(
        pass({
          table: 'freehold_operation_receipts',
          present: false,
          reltuples: null,
          totalBytes: null,
        }),
      ),
    ).toEqual([absent, CLAIMS_READING]);
    // Dropped between to_regclass and the size read: a NULL size is absence too.
    expect(decodeFreeholdReceiptGrowthRows(pass(presentRow(5, null)))).toEqual([
      absent,
      CLAIMS_READING,
    ]);
  });

  it.each([
    ['no row', []],
    ['a missing second table', [presentRow(1, '1')]],
    ['an extra row', [presentRow(1, '1'), CLAIMS_ROW, CLAIMS_ROW]],
    ['the two tables out of list order', [CLAIMS_ROW, presentRow(1, '1')]],
    ['a table outside the fixed list', pass({ ...presentRow(1, '1'), table: 'accounts' })],
    ['a non-boolean presence flag', pass({ ...presentRow(1, '1'), present: 't' })],
    ['an undecodable estimate', pass(presentRow('not-a-number', '1'))],
    ['a null estimate on a present table', pass(presentRow(null, '1'))],
    ['a negative size', pass(presentRow(1, '-5'))],
    ['an unsafe size', pass(presentRow(1, '9007199254740993'))],
    ['a malformed second row alone', [presentRow(1, '1'), { ...CLAIMS_ROW, totalBytes: '-1' }]],
  ])('refuses a malformed answer: %s', (_label, rows) => {
    expect(decodeFreeholdReceiptGrowthRows(rows as FreeholdReceiptGrowthRow[])).toBeNull();
  });

  it('projects an accepted pass into the scrape readout and leaves it on a refused one', () => {
    expect(observeFreeholdReceiptGrowth(pass(presentRow(42, '24576')), 5_000)).toBe(true);
    const accepted = freeholdReceiptGrowthReadout();
    expect(accepted).toEqual({
      tables: [
        { table: 'freehold_operation_receipts', present: true, rowsEstimate: 42, bytes: 24576 },
        CLAIMS_READING,
      ],
      observedAtMs: 5_000,
    });

    expect(observeFreeholdReceiptGrowth(pass(presentRow('bad', '1')), 6_000)).toBe(false);
    expect(observeFreeholdReceiptGrowth(pass(presentRow(1, '1')), Number.NaN)).toBe(false);
    expect(freeholdReceiptGrowthReadout()).toEqual(accepted);
  });
});

describe('freehold receipt growth monitor: lifecycle and admission', () => {
  it('yields without reading when the shared background gate is busy', async () => {
    const read = vi.fn();
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => null,
      read,
    });

    await monitor.refresh();

    expect(read).not.toHaveBeenCalled();
  });

  it('isolates a throwing permit acquisition from the refresh loop', async () => {
    const acquireError = new Error('background gate unavailable');
    const read = vi.fn();
    const onError = vi.fn();
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => {
        throw acquireError;
      },
      read,
      onError,
    });

    await expect(monitor.refresh()).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({
      code: undefined,
      constraint: undefined,
      message: 'background gate unavailable',
    });
  });

  it('hands the error sink only the bounded classification, never a pg error detail', async () => {
    // A real DatabaseError carries row content in `detail` (a 23514's failing
    // row, a 23505's key) and the statement in `where`; the log line gets the
    // code, the constraint and the message only (server/freehold_bounded_error.ts).
    const pgError = Object.assign(new Error('new row violates check constraint'), {
      code: '23514',
      constraint: 'freehold_operation_receipts_kind_shape',
      detail: 'Failing row contains (fop:secret, 42, plot:home).',
      where: 'SQL statement',
      table: 'freehold_operation_receipts',
    });
    const onError = vi.fn();
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release() {} }),
      read: async () => {
        throw pgError;
      },
      onError,
    });

    await monitor.refresh();

    expect(onError).toHaveBeenCalledTimes(1);
    const logged = onError.mock.calls[0]?.[0];
    expect(logged).toEqual({
      code: '23514',
      constraint: 'freehold_operation_receipts_kind_shape',
      message: 'new row violates check constraint',
    });
    expect(logged).not.toBe(pgError);
    expect(JSON.stringify(logged)).not.toContain('Failing row');
  });

  it('never queues on a saturated pool: it yields its permit silently, no checkout', async () => {
    const connect = vi.fn();
    const release = vi.fn();
    const onError = vi.fn();
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      pool: { connect, totalCount: 1, idleCount: 0, waitingCount: 0, options: { max: 1 } },
      tryAcquireBackgroundPermit: () => ({ release }),
      onError,
    });

    await monitor.refresh();

    expect(connect).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('a clock port that throws is a reported failure whose permit still returns', async () => {
    const release = vi.fn();
    const onError = vi.fn();
    const read = vi.fn(async () => pass(presentRow(1, '1')));
    let broken = true;
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      nowMs: () => {
        if (broken) throw new Error('the clock port threw');
        return 7_000;
      },
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read,
      onError,
    });
    await monitor.refresh();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    // The abort handle cleared with it: the next pass on a sane clock runs and
    // lands, and stop() has nothing left to drain.
    broken = false;
    await monitor.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    expect(freeholdReceiptGrowthReadout().observedAtMs).toBe(7_000);
    expect(release).toHaveBeenCalledTimes(2);
    await monitor.stop();
  });

  it('a missing table is a healthy pass, not a monitor failure', async () => {
    const release = vi.fn();
    const onError = vi.fn();
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read: async () =>
        pass({
          table: 'freehold_operation_receipts',
          present: false,
          reltuples: null,
          totalBytes: null,
        }),
      onError,
    });

    await monitor.refresh();

    expect(onError).not.toHaveBeenCalled();
    expect(freeholdReceiptGrowthReadout().tables).toEqual([
      { table: 'freehold_operation_receipts', present: false, rowsEstimate: null, bytes: null },
      CLAIMS_READING,
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('stamps the readout with when the pass STARTED, and drives the default observer', async () => {
    const order: string[] = [];
    let finishRead!: (rows: readonly FreeholdReceiptGrowthRow[]) => void;
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      nowMs: () => {
        order.push('clock');
        return 1_000;
      },
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release: vi.fn() }),
      read: async () => {
        order.push('read');
        return new Promise<readonly FreeholdReceiptGrowthRow[]>((resolve) => {
          finishRead = resolve;
        });
      },
    });
    const refresh = monitor.refresh();
    await vi.waitFor(() => expect(order).toEqual(['clock', 'read']));
    finishRead(pass(presentRow(-1, '8192')));
    await refresh;

    // One clock reading, taken before the read: the age describes the snapshot.
    expect(order).toEqual(['clock', 'read']);
    expect(freeholdReceiptGrowthReadout()).toEqual({
      tables: [
        { table: 'freehold_operation_receipts', present: true, rowsEstimate: null, bytes: 8192 },
        CLAIMS_READING,
      ],
      observedAtMs: 1_000,
    });
  });

  it('the default read rides the deadline port it was given', async () => {
    const armedMs: number[] = [];
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      scheduleDeadline: (_callback, ms) => {
        armedMs.push(ms);
        return () => {};
      },
      pool: { connect: vi.fn(), totalCount: 1, idleCount: 0, waitingCount: 0, options: { max: 1 } },
      tryAcquireBackgroundPermit: () => ({ release: vi.fn() }),
    });
    await monitor.refresh();
    expect(armedMs).toEqual([FREEHOLD_RECEIPT_GROWTH_MONITOR_WALL_TIMEOUT_MS]);
  });

  it('reports a malformed answer once per failure streak and re-arms after success', async () => {
    const release = vi.fn();
    const onError = vi.fn();
    const read = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(pass(presentRow(1, '1')))
      .mockRejectedValueOnce(new Error('next streak'));
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read,
      onError,
    });

    await monitor.refresh();
    await monitor.refresh();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      message: 'freehold receipt growth monitor returned malformed catalog values',
    });

    await monitor.refresh();
    await monitor.refresh();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[1]?.[0]).toMatchObject({ message: 'next streak' });
    expect(release).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
  ])('rejects an invalid %s refresh interval', (_label, intervalMs) => {
    expect(() =>
      createFreeholdReceiptGrowthMonitor({
        ...PORTS,
        pool: availablePool(),
        tryAcquireBackgroundPermit: () => null,
        intervalMs,
      }),
    ).toThrow('freehold receipt growth monitor interval must be a positive safe integer');
  });

  it('start refreshes immediately, coalesces a busy tick, and schedules the next interval', async () => {
    const resolvers: Array<(rows: readonly FreeholdReceiptGrowthRow[]) => void> = [];
    const read = vi.fn(
      async () =>
        new Promise<readonly FreeholdReceiptGrowthRow[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const release = vi.fn();
    let tick: (() => void) | null = null;
    const armedMs: number[] = [];
    const cancelRepeat = vi.fn();
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      scheduleRepeating: (callback, ms) => {
        tick = callback;
        armedMs.push(ms);
        return cancelRepeat;
      },
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read,
      observe: () => true,
      intervalMs: 100,
    });

    monitor.start();
    monitor.start();
    expect(read).toHaveBeenCalledTimes(1);
    expect(armedMs).toEqual([100]);
    const fire = () => (tick as unknown as () => void)();
    // A tick while the first pass is still reading joins it.
    fire();
    expect(read).toHaveBeenCalledTimes(1);

    resolvers[0]?.([]);
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    fire();
    expect(read).toHaveBeenCalledTimes(2);

    resolvers[1]?.([]);
    await monitor.stop();
    expect(release).toHaveBeenCalledTimes(2);
    expect(cancelRepeat).toHaveBeenCalledTimes(1);

    // Stopped is final: no restart, no further reads.
    monitor.start();
    await monitor.refresh();
    fire();
    expect(read).toHaveBeenCalledTimes(2);
    expect(armedMs).toEqual([100]);
  });

  it('stop aborts the in-flight read and does not return until it has drained', async () => {
    const release = vi.fn();
    let readSignal: AbortSignal | null = null;
    let finishRead!: (rows: readonly FreeholdReceiptGrowthRow[]) => void;
    const observe = vi.fn(() => true);
    const monitor = createFreeholdReceiptGrowthMonitor({
      ...PORTS,
      pool: availablePool(),
      tryAcquireBackgroundPermit: () => ({ release }),
      read: async (_pool, signal) =>
        new Promise<readonly FreeholdReceiptGrowthRow[]>((resolve) => {
          readSignal = signal;
          finishRead = resolve;
        }),
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

    finishRead(pass(presentRow(999, '1')));
    await stop;
    await refresh;
    expect(stopReturned).toBe(true);
    // A pass that lands after stop is dropped, and its permit still returns.
    expect(observe).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
