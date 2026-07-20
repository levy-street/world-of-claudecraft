// Self-clocked retention sweep for the unbounded history tables. A cheap poll
// watches the clock; once the configured off-peak UTC hour arrives, the sweep
// fires exactly once for that UTC day and prunes each registered table in small
// LIMIT-bounded batches under a per-table row budget. The budget caps one night's
// deletion work, so a large backlog never turns into one giant delete: each run
// removes the oldest rows first and the remainder drains across successive
// nightly runs (that ordering is the forward-progress guarantee, and it is why a
// failed run loses nothing: the next run re-attempts the same oldest rows).
//
// Exactly one process sweeps per UTC day. The run takes a session-scoped
// pg_try_advisory_lock before touching any table, and a process that loses the
// try-lock marks its own day as done, because the peer holding the lock IS
// today's sweep. The once-per-day memory is process-local (lastFiredUtcDay)
// plus, when the optional loadLastSweepDay/saveLastSweepDay deps are wired, a
// persisted marker consulted under the lock; without the marker a process
// restart after the target hour re-runs one bounded, idempotent sweep at
// whatever time the deploy lands. db.ts owns the sibling schema advisory key
// 0x57_4f_43_01 for boot DDL serialization; that constant is module-private
// and cannot be imported, so this comment is the cross-reference that keeps
// the keys distinct.
//
// Observability contract: every process emits exactly one run-end line per
// UTC day through onInfo (the pruned-N summary, 0 rows included, the
// peer-holds-lock line, or the marker-already-ran line), plus any budget-cap
// lines. This sweep is the only bound on the history tables' growth, so a
// silent day IS the signal that something is wedged (a stuck lock, a dead
// peer, a zero-budget misconfiguration), never a quiet night.
//
// The advisory lock/unlock pair is the only raw SQL in this module. Every DELETE
// arrives through the injected RetentionTable / RetentionOnlineSamples
// primitives, whose SQL lives in the owning *_db.ts modules.

// Session advisory lock key for the nightly sweep. db.ts's boot-DDL lock is the
// sibling "WOC\x01"; the two keys must never collide.
export const RETENTION_SWEEP_ADVISORY_LOCK_KEY = 0x57_4f_43_02; // "WOC\x02"

// One bounded DELETE per query keeps each statement's lock footprint and WAL
// burst small enough that the sweep never contends with live gameplay writes.
export const RETENTION_SWEEP_BATCH_SIZE = 1000;

// The poll reads only the clock, so a tight cadence costs nothing; one minute
// bounds how far past the target hour the sweep can start.
export const RETENTION_SWEEP_POLL_MS = 60_000;

export type RetentionBatchVerdict = 'continue' | 'stop-budget' | 'stop-caught-up';

export interface RetentionBatchState {
  rowsThisRun: number;
  maxRowsPerRun: number;
  lastBatchRows: number;
  batchSize: number;
}

// The UTC calendar day of a timestamp as 'YYYY-MM-DD' (the ISO date prefix).
// The sweep's once-per-day memory is this string, so day comparisons are exact
// and timezone-free.
export function utcDayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// True when the sweep should fire: the target UTC hour has been reached and the
// sweep has not already fired during the current UTC day. That verdict is only
// sound because it compares whole UTC days, never timestamps or poll gaps: a
// process that wakes after its target hour already passed (a stall, a late boot)
// still fires once for the current day, a fired day never fires twice, and the
// next UTC day re-arms it. Any poll cadence produces the same answers.
export function retentionSweepDue(
  now: Date,
  utcHour: number,
  lastFiredUtcDay: string | null,
): boolean {
  return now.getUTCHours() >= utcHour && utcDayOf(now) !== lastFiredUtcDay;
}

// The per-batch verdict for one prune loop. Caught-up is checked FIRST: a short
// batch proves the table has no more aged rows, and that reading must win even
// when the run's budget is also spent, because the caller treats the two stops
// differently (the online-samples group moves to the next realm on caught-up but
// ends the whole group on budget). Otherwise the budget caps the run.
export function retentionBatchVerdict(state: RetentionBatchState): RetentionBatchVerdict {
  if (state.lastBatchRows < state.batchSize) return 'stop-caught-up';
  if (state.rowsThisRun >= state.maxRowsPerRun) return 'stop-budget';
  return 'continue';
}

export interface RetentionTable {
  name: string;
  // Rows deleted by ONE batch. Must resolve to a FINITE count: the budget
  // verdict compares it, and the shell reads a non-finite value as caught-up.
  pruneBatch(batchSize: number): Promise<number>;
}

export interface RetentionOnlineSamples {
  listRealms(): Promise<string[]>;
  foldPeak(realm: string): Promise<void>;
  pruneBatch(realm: string, batchSize: number): Promise<number>;
}

export interface RetentionSweepLockClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  // pg's PoolClient.release(err?) satisfies this structurally: a truthy
  // argument destroys the connection instead of returning it to the pool,
  // which is how a possibly poisoned lock holder is kept out of the pool.
  release(destroy?: boolean): void;
}

export interface RetentionSweepDeps {
  connect(): Promise<RetentionSweepLockClient>; // pool.connect in production
  utcHour: number; // 0..23, the off-peak UTC hour gate
  maxRowsPerRun: number; // PER-TABLE row budget per run; 0 means a zero budget (no batches)
  batchSize: number;
  tables: RetentionTable[]; // swept in array order, before the online-samples group
  onlineSamples?: RetentionOnlineSamples;
  now?(): Date;
  pollIntervalMs?: number; // default RETENTION_SWEEP_POLL_MS
  onError?(scope: string, err: unknown): void; // default console.error
  onInfo?(message: string): void; // default console.log
  // Optional persisted once-per-day marker, consulted only after this process
  // wins the advisory lock. Without it the day marker is process memory only,
  // so every restart after the target hour re-runs one bounded sweep at deploy
  // time; with it, a lock winner that finds today already marked skips. Both
  // calls are best-effort because the sweep is idempotent: a read failure
  // proceeds as if unmarked and a write failure costs at most one re-sweep.
  loadLastSweepDay?(): Promise<string | null>;
  saveLastSweepDay?(day: string): Promise<void>;
}

export interface RetentionSweep {
  start(): void;
  stop(): Promise<void>;
}

export function createRetentionSweep(deps: RetentionSweepDeps): RetentionSweep {
  const onError =
    deps.onError ?? ((scope, err) => console.error(`retention sweep ${scope} failed:`, err));
  const onInfo = deps.onInfo ?? ((message) => console.log(message));
  // A LIMIT 0 batch would delete zero rows forever and every verdict would read
  // 'continue' (zero rows is never short of a zero batch size), so this
  // normalization is the infinite-loop guard. Applied once, up front.
  const batchSize = Math.max(1, Math.floor(deps.batchSize));

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let lastFiredUtcDay: string | null = null;
  // Raised by stop(): every batch loop consults it, so an in-flight run ends at
  // the next batch boundary instead of draining its whole budget. Shutdown must
  // never wait behind a catch-up run long enough for the supervisor's kill
  // grace to preempt the character saves that follow; the sweep loses nothing
  // by stopping early (the next scheduled run re-attempts the same oldest rows).
  let stopping = false;

  // One table's prune loop. Batch failures are contained here so a sibling table
  // still sweeps, and the rows already deleted still count toward the summary.
  // lastBatchRows seeds at the full batch size as a "no batch yet" sentinel, so
  // the verdict runs BEFORE the first batch and tests only the budget there: a
  // zero-budget run issues zero batches.
  async function pruneWithBudget(
    scope: string,
    prune: (size: number) => Promise<number>,
    rowsAlreadyUsed: number,
  ): Promise<number> {
    let rowsThisRun = rowsAlreadyUsed;
    let lastBatchRows = batchSize;
    const verdict = () =>
      retentionBatchVerdict({
        rowsThisRun,
        maxRowsPerRun: deps.maxRowsPerRun,
        lastBatchRows,
        batchSize,
      });
    while (!stopping && verdict() === 'continue') {
      try {
        const rows = await prune(batchSize);
        // A non-finite batch count would make every verdict read 'continue'
        // (NaN comparisons are false on both arms) and loop until the table
        // drains or errors; read it as caught-up instead, the safe stop.
        lastBatchRows = Number.isFinite(rows) ? rows : 0;
      } catch (err) {
        // Stop only THIS loop for the run. Nothing partial was committed beyond
        // whole batches, so the next scheduled run re-attempts the same oldest
        // rows and forward progress is preserved. The state is untouched by the
        // failed batch, so the verdict below still reads 'continue' and an
        // error stop is never mistaken for a budget stop.
        onError(scope, err);
        break;
      }
      rowsThisRun += lastBatchRows;
    }
    // A capped run must be visible: without this line a table that hit the
    // budget with expired rows still waiting is indistinguishable from a
    // caught-up one, and a stalled retention window on personal-data tables is
    // a privacy signal, not a cosmetic detail.
    if (verdict() === 'stop-budget') {
      onInfo(
        `retention sweep: ${scope} hit the ${deps.maxRowsPerRun} row budget with expired rows remaining`,
      );
    }
    return rowsThisRun - rowsAlreadyUsed;
  }

  // The online-samples group behaves as one logical table partitioned by realm:
  // the per-table budget is shared across every realm, so rowsThisRun accumulates
  // over the whole group.
  async function sweepOnlineSamples(samples: RetentionOnlineSamples): Promise<number> {
    let realms: string[];
    try {
      realms = await samples.listRealms();
    } catch (err) {
      // Without the realm list nothing in the group can run safely; skip the
      // whole group this run and let the next scheduled run retry.
      onError('online-samples', err);
      return 0;
    }
    let rowsThisRun = 0;
    for (let i = 0; i < realms.length; i++) {
      if (stopping) break;
      const realm = realms[i];
      // A spent budget stops the group before folding: the fold exists only to
      // make the prune safe, and no prune will follow it.
      const verdict = retentionBatchVerdict({
        rowsThisRun,
        maxRowsPerRun: deps.maxRowsPerRun,
        lastBatchRows: batchSize,
        batchSize,
      });
      if (verdict === 'stop-budget') {
        // None of the remaining realms folded, so no prune loop exists to
        // announce the cap for them; this group line speaks instead, naming
        // every skipped realm without claiming expired rows it never measured.
        // A capped run must be visible because a stalled retention window on
        // personal-data tables is a privacy signal.
        onInfo(
          `retention sweep: the online-samples group hit the ${deps.maxRowsPerRun} row budget before ${realms.slice(i).join(', ')}`,
        );
      }
      if (verdict !== 'continue') break;
      try {
        // The fold is the precondition that makes pruning this realm safe, so it
        // always runs first and a failure skips this realm's prunes entirely for
        // the run; the next scheduled run retries. Sibling realms still sweep.
        await samples.foldPeak(realm);
      } catch (err) {
        onError(`online-samples:${realm}`, err);
        continue;
      }
      rowsThisRun += await pruneWithBudget(
        `online-samples:${realm}`,
        (size) => samples.pruneBatch(realm, size),
        rowsThisRun,
      );
    }
    return rowsThisRun;
  }

  async function sweep(): Promise<number> {
    let totalRows = 0;
    for (const table of deps.tables) {
      if (stopping) break;
      totalRows += await pruneWithBudget(table.name, (size) => table.pruneBatch(size), 0);
    }
    if (deps.onlineSamples && !stopping) {
      totalRows += await sweepOnlineSamples(deps.onlineSamples);
    }
    return totalRows;
  }

  async function runOnce(now: Date): Promise<void> {
    let client: RetentionSweepLockClient;
    try {
      client = await deps.connect();
    } catch (err) {
      // A down database must not consume the day: leave lastFiredUtcDay unset so
      // the next poll retries the whole run.
      onError('connect', err);
      return;
    }
    // Poisoned-lock hazard: a client whose lock or unlock query failed may
    // still hold (or be in an unknown state around) the session advisory lock,
    // and a pooled connection can live for hours. While that connection sits
    // in the pool the lock stays taken, so every future sweep loses the
    // try-lock and retention silently stops until the connection dies. Those
    // two arms therefore destroy the connection instead of pooling it: ending
    // the backend session drops its locks.
    let destroyClient = false;
    try {
      let acquired = false;
      try {
        const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
          RETENTION_SWEEP_ADVISORY_LOCK_KEY,
        ]);
        acquired = result.rows[0]?.acquired === true;
      } catch (err) {
        // Same reasoning as a connect failure: the day is not consumed, the next
        // poll retries. The lock state on this connection is unknown, so it is
        // destroyed, never pooled.
        onError('lock', err);
        destroyClient = true;
        return;
      }
      // Either way the day is now settled for this process: the lock exists so
      // exactly ONE process sweeps per UTC day, and losing the try-lock means
      // today's sweep is owned by a peer, not deferred.
      lastFiredUtcDay = utcDayOf(now);
      if (!acquired) {
        // The miss consumed the day just above, so this fires at most once per
        // process per UTC day, and it keeps the run-end contract (see the
        // module header): without it a wedged peer, or an advisory lock leaked
        // on a pooled connection, reads exactly like a healthy night.
        onInfo("retention sweep: a peer holds today's sweep lock");
        return;
      }
      try {
        // The persisted marker (when wired) survives restarts: without it a
        // process that boots after the target hour re-runs a full budgeted
        // sweep at whatever time the deploy lands. Consulted under the lock so
        // the read cannot race a peer's in-progress sweep and marker write.
        if (deps.loadLastSweepDay) {
          let persistedDay: string | null = null;
          try {
            persistedDay = await deps.loadLastSweepDay();
          } catch (err) {
            // A read failure must not stop retention: the sweep is idempotent,
            // so proceed as if no marker exists (worst case one bounded
            // re-sweep).
            onError('last-run-read', err);
          }
          // A peer, or an earlier life of this process, already swept today.
          // Returning here still travels through the finally blocks below, so
          // the lock is released and the client goes back to the pool. The
          // line keeps the run-end contract: a skipped day must still speak.
          if (persistedDay === utcDayOf(now)) {
            onInfo("retention sweep: today's sweep already ran (persisted marker)");
            return;
          }
        }
        const totalRows = await sweep();
        // Unconditional, 0 rows included: this is the run-end line of the
        // one-line-per-process-per-day contract (see the module header). A
        // dead sweep must be distinguishable from a caught-up one, because
        // this sweep is the only bound on the history tables' growth.
        onInfo(`retention sweep pruned ${totalRows} rows`);
        if (deps.saveLastSweepDay) {
          try {
            await deps.saveLastSweepDay(utcDayOf(now));
          } catch (err) {
            // Best-effort: a lost write costs at most one bounded re-sweep on
            // the next restart, so the run still counts as complete.
            onError('last-run-write', err);
          }
        }
      } finally {
        // Session advisory locks belong to one backend connection, so the unlock
        // must ride the SAME client that locked; releasing first could hand the
        // lock's connection back to the pool still holding it.
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [RETENTION_SWEEP_ADVISORY_LOCK_KEY]);
        } catch (err) {
          // The lock may still be held on this connection; destroy it (see the
          // poisoned-lock note above).
          onError('unlock', err);
          destroyClient = true;
        }
      }
    } finally {
      client.release(destroyClient || undefined);
    }
  }

  function poll(): void {
    // In-flight guard: a poll landing while a run is still sweeping coalesces
    // into it rather than stacking a second run on the same connection budget.
    if (inFlight) return;
    const now = deps.now?.() ?? new Date();
    if (!retentionSweepDue(now, deps.utcHour, lastFiredUtcDay)) return;
    inFlight = runOnce(now)
      .catch((err) => onError('run', err))
      .finally(() => {
        inFlight = null;
      });
  }

  return {
    start(): void {
      // Idempotent, and deliberately without an immediate fire: the first poll
      // decides, so boot never front-runs schema setup or a peer's sweep. The
      // interval is unref()'d like the other boot intervals in main.ts, so it
      // never keeps the process alive on its own.
      if (timer) return;
      stopping = false;
      timer = setInterval(poll, deps.pollIntervalMs ?? RETENTION_SWEEP_POLL_MS);
      timer.unref();
    },
    async stop(): Promise<void> {
      // Raise the flag FIRST so an in-flight run ends at its next batch
      // boundary; without it a catch-up run could hold shutdown past the
      // supervisor's kill grace and the character saves behind this stop
      // would be lost to SIGKILL. The run's unlock/release path still runs.
      stopping = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Wait out the (now batch-bounded) in-flight run so no prune query races
      // pool.end() during shutdown, mirroring the async stop of the
      // business-metrics collector. The run reports its own failures via
      // onError; stop only waits.
      try {
        await inFlight;
      } catch {
        // Swallowed by design: shutdown must proceed.
      }
    },
  };
}
