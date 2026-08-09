// Shared priority arbiter for work that reaches WebGL. A browser idle callback
// only says when a unit may start; it does not prevent independent zone,
// texture, PMREM, archetype, and live compile lanes from starting together.
//
// Tail policy (the seam decision this file owns): by DEFAULT a unit occupies
// the queue from start until its promise settles, awaited tail included. A
// caller whose tail is dominated by a non-cancellable off-thread wait (a
// compile gate awaiting a KHR_parallel_shader_compile link, which three polls
// with a 10 ms timer and costs the main thread nothing) opts in with
// releaseTail: the queue then holds only for the synchronous prologue and the
// tail keeps settling alongside other units, bounded by the released-tail cap.
// Unconditional occupancy made one slow driver link hold every other lane for
// seconds (measured locally: a 7.5 s hold on a 2.5 ms prologue, with
// higher-priority actionable gates waiting behind it). The cap is what keeps
// the original guarantee (#2753): driver link work stays bounded, never one
// per streamed view during an online snapshot burst. Priority applies when a
// unit STARTS: a higher-priority arrival can still wait on a full cap, but
// that wait is bounded by the shortest in-flight tail instead of the whole
// serial hold, so it is never longer than the pre-release policy's.

export const GPU_WORK_PRIORITY = {
  BOOT_RESUME: 0,
  BACKGROUND: 10,
  VISIBLE_PREWARM: 20,
  LIVE_VIEW: 30,
  ACTIONABLE_VIEW: 40,
} as const;

/** Per-unit scheduling options; see the tail policy in the header. */
export interface GpuWorkRunOptions {
  /** The caller declares that everything after work()'s synchronous return is
   *  DOMINATED by an off-thread wait, so the queue may start other units while
   *  the tail settles (bounded by the released-tail cap). Only for tails the
   *  main thread is NOT doing the bulk of, e.g. a parallel shader link. A
   *  short main-thread continuation inside the tail (the compile gate chains a
   *  second compile prologue after the first link) is tolerated: it interleaves
   *  with other units like any microtask work, but it books in no unit's
   *  syncMs, so keep it small. */
  releaseTail?: boolean;
}

interface PendingGpuWork<T> {
  order: number;
  priority: number;
  label: string;
  releaseTail: boolean;
  work: () => T | Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

/** One completed unit's timing. syncMs is the MAIN-THREAD block (the call up
 *  to its return, i.e. a compileAsync prologue or a whole synchronous upload);
 *  wallMs adds the awaited tail, which for an async link waits off-thread. */
export interface GpuWorkUnitStat {
  label: string;
  priority: number;
  syncMs: number;
  wallMs: number;
  atMs: number;
}

/** The unit the drain loop is awaiting right now. Every pending unit waits
 *  either on this one or, when it is null with pending units and the released
 *  tails at the cap, on a tail slot freeing (see waitingTails). */
export interface GpuWorkActiveUnit {
  label: string;
  priority: number;
  /** Wall time since the unit started, i.e. how long it has been running. */
  ageMs: number;
  atMs: number;
}

/** A unit observed past the stall threshold. `settled: false` is the case a
 *  completed-unit ring can never show: it had still not finished when the
 *  stats were read. */
export interface GpuWorkStallStat {
  label: string;
  priority: number;
  /** Longest unsettled age observed, or the final wall time once it settled. */
  ageMs: number;
  atMs: number;
  settled: boolean;
}

export interface BackgroundGpuQueueStats {
  units: number;
  totalSyncMs: number;
  worstSyncMs: number;
  /** Slowest units by sync slice, worst first, bounded. */
  slowest: GpuWorkUnitStat[];
  /** Units not started yet, waiting on the running unit or on the
   *  released-tail cap: the backlog a wedge accumulates. */
  pending: number;
  /** The unit holding the drain loop, or null when nothing does. A released
   *  tail is NOT active: it appears in waitingTails until it settles. */
  active: GpuWorkActiveUnit | null;
  /** Released tails still settling. When pending grows with active null and
   *  this list full, the released-tail cap is what the queue is waiting on. */
  waitingTails: GpuWorkActiveUnit[];
  /** Every unit seen past the stall threshold, including evicted records. A
   *  non-zero count is not by itself a wedged queue: a long hold that ended
   *  counts too. A wedge is an unsettled stall plus a live unit naming it:
   *  either `active`, or a `waitingTails` entry for a released tail. */
  stallCount: number;
  /** Most recent stalls, bounded. */
  stalls: GpuWorkStallStat[];
}

export interface BackgroundGpuQueue {
  run<T>(
    work: () => T | Promise<T>,
    priority?: number,
    label?: string,
    options?: GpuWorkRunOptions,
  ): Promise<T>;
  /** Per-unit timing plus the running unit: names which lane's units block the
   *  main thread, and which one is currently blocking the whole queue. */
  stats(): BackgroundGpuQueueStats;
  /** Reject queued work, stop accepting more, and await the active unit plus
   *  any released tails still settling. */
  shutdown(reason?: Error): Promise<void>;
}

const DEFAULT_SLOWEST_LIMIT = 20;
// Low on purpose, because a hold this long is worth seeing whether or not it
// ends. A live compile gate waiting out a non-cancellable driver link really
// does occupy the serial queue for seconds (a local run measured 7.5 s on a
// unit that cost 2.5 ms of main-thread time), and every other lane waits behind
// it. Those records settle; a wedge is the record that never does.
const DEFAULT_STALL_MS = 4000;
const DEFAULT_STALL_LIMIT = 8;
// Concurrent released tails, i.e. driver links settling while the queue keeps
// draining. 2 keeps a second gate flowing past one slow link while holding the
// snapshot-burst bound: with the running unit's own prologue, at most 3 units'
// driver work can be in flight at any instant, never one per streamed view.
const DEFAULT_TAIL_LIMIT = 2;

interface RunningGpuWork {
  entry: PendingGpuWork<unknown>;
  startedAt: number;
  stall: GpuWorkStallStat | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function createBackgroundGpuQueue(opts?: {
  now?: () => number;
  slowestLimit?: number;
  stallMs?: number;
  stallLimit?: number;
  tailLimit?: number;
}): BackgroundGpuQueue {
  const now = opts?.now ?? ((): number => performance.now());
  const slowestLimit = Math.max(1, opts?.slowestLimit ?? DEFAULT_SLOWEST_LIMIT);
  const stallMs = Math.max(1, opts?.stallMs ?? DEFAULT_STALL_MS);
  const stallLimit = Math.max(1, opts?.stallLimit ?? DEFAULT_STALL_LIMIT);
  const tailLimit = Math.max(1, opts?.tailLimit ?? DEFAULT_TAIL_LIMIT);
  const pending: PendingGpuWork<unknown>[] = [];
  const slowest: GpuWorkUnitStat[] = [];
  const stalls: GpuWorkStallStat[] = [];
  const waitingTails = new Set<RunningGpuWork>();
  let units = 0;
  let totalSyncMs = 0;
  let worstSyncMs = 0;
  let stallCount = 0;
  let running: RunningGpuWork | null = null;
  let active = false;
  let accepting = true;
  let nextOrder = 0;
  let tailNotify: (() => void) | null = null;
  let shutdownReason: Error | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let resolveShutdown: (() => void) | null = null;

  // A unit that never settles has no completion callback to record it, so the
  // threshold is evaluated wherever the queue is observed instead: at every
  // stats() read while the unit is still running, and once more if it settles.
  const noteStall = (unit: RunningGpuWork, ageMs: number): void => {
    if (ageMs < stallMs) return;
    if (unit.stall) {
      if (ageMs > unit.stall.ageMs) unit.stall.ageMs = ageMs;
      return;
    }
    stallCount++;
    unit.stall = {
      label: unit.entry.label,
      priority: unit.entry.priority,
      ageMs,
      atMs: unit.startedAt,
      settled: false,
    };
    stalls.push(unit.stall);
    if (stalls.length > stallLimit) stalls.shift();
  };

  const recordUnit = (unit: RunningGpuWork, syncMs: number): void => {
    units++;
    totalSyncMs += syncMs;
    if (syncMs > worstSyncMs) worstSyncMs = syncMs;
    const wallMs = now() - unit.startedAt;
    noteStall(unit, wallMs);
    if (unit.stall) unit.stall.settled = true;
    const stat: GpuWorkUnitStat = {
      label: unit.entry.label,
      priority: unit.entry.priority,
      syncMs,
      wallMs,
      atMs: unit.startedAt,
    };
    let index = slowest.length;
    while (index > 0 && slowest[index - 1].syncMs < stat.syncMs) index--;
    slowest.splice(index, 0, stat);
    if (slowest.length > slowestLimit) slowest.length = slowestLimit;
  };

  const settleShutdownIfIdle = (): void => {
    if (accepting || active || pending.length > 0 || waitingTails.size > 0) return;
    resolveShutdown?.();
    resolveShutdown = null;
  };

  // Moves a released unit's settling tail out of the drain loop's way. The
  // unit's promise still resolves only when ITS tail settles (a gated view is
  // revealed no earlier than before); only the queue occupancy changes.
  const detachTail = (unit: RunningGpuWork, syncMs: number, tail: PromiseLike<unknown>): void => {
    waitingTails.add(unit);
    let settled = false;
    const settle = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      waitingTails.delete(unit);
      recordUnit(unit, syncMs);
      complete();
      const notify = tailNotify;
      tailNotify = null;
      notify?.();
      // The drain loop may have exited while this tail was still settling.
      settleShutdownIfIdle();
    };
    // A real Promise's then never throws, but the queue accepts any thenable:
    // a synchronously-throwing then must not leak the unit's cap slot.
    try {
      void tail.then(
        (value) => settle(() => unit.entry.resolve(value)),
        (error) => settle(() => unit.entry.reject(error)),
      );
    } catch (error) {
      settle(() => unit.entry.reject(error));
    }
  };

  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      // The released-tail cap gates STARTING units, so the bound covers the
      // running unit's own driver work too: at most tailLimit + 1 units'
      // driver work can be in flight at any instant.
      while (waitingTails.size >= tailLimit) {
        await new Promise<void>((resolve) => {
          tailNotify = resolve;
        });
      }
      // shutdown() splices pending while the loop is parked on the cap wait
      // above: re-check emptiness before selecting, or the resumed iteration
      // dereferences a unit that no longer exists.
      if (pending.length === 0) break;
      let selectedIndex = 0;
      for (let index = 1; index < pending.length; index++) {
        const candidate = pending[index];
        const selected = pending[selectedIndex];
        if (
          candidate.priority > selected.priority ||
          (candidate.priority === selected.priority && candidate.order < selected.order)
        ) {
          selectedIndex = index;
        }
      }
      const [next] = pending.splice(selectedIndex, 1);
      const unit: RunningGpuWork = { entry: next, startedAt: now(), stall: null };
      running = unit;
      let syncMs = 0;
      let released = false;
      try {
        const returned = next.work();
        syncMs = now() - unit.startedAt;
        if (
          next.releaseTail &&
          returned !== null &&
          typeof returned === 'object' &&
          typeof (returned as PromiseLike<unknown>).then === 'function'
        ) {
          released = true;
          detachTail(unit, syncMs, returned as PromiseLike<unknown>);
        } else {
          next.resolve(await returned);
        }
      } catch (error) {
        if (syncMs === 0) syncMs = now() - unit.startedAt;
        next.reject(error);
      } finally {
        running = null;
        if (!released) recordUnit(unit, syncMs);
      }
    }
    active = false;
    // A run() call can land after the loop observes an empty queue but before
    // this async continuation clears active. Start another drain in that case.
    if (pending.length > 0) scheduleDrain();
    else settleShutdownIfIdle();
  };

  const scheduleDrain = (): void => {
    if (active) return;
    active = true;
    void Promise.resolve().then(drain);
  };

  return {
    run<T>(
      work: () => T | Promise<T>,
      priority = GPU_WORK_PRIORITY.BACKGROUND,
      label = 'unlabeled',
      options?: GpuWorkRunOptions,
    ): Promise<T> {
      if (!accepting) {
        return Promise.reject(shutdownReason ?? new Error('Background GPU queue is shut down'));
      }
      const result = new Promise<T>((resolve, reject) => {
        pending.push({
          order: nextOrder++,
          priority,
          label,
          releaseTail: options?.releaseTail === true,
          work,
          resolve,
          reject,
        } as PendingGpuWork<unknown>);
      });
      scheduleDrain();
      return result;
    },
    stats(): BackgroundGpuQueueStats {
      let activeUnit: GpuWorkActiveUnit | null = null;
      if (running) {
        const ageMs = now() - running.startedAt;
        noteStall(running, ageMs);
        activeUnit = {
          label: running.entry.label,
          priority: running.entry.priority,
          ageMs: round1(ageMs),
          atMs: Math.round(running.startedAt),
        };
      }
      const tailUnits: GpuWorkActiveUnit[] = [];
      for (const tail of waitingTails) {
        const ageMs = now() - tail.startedAt;
        noteStall(tail, ageMs);
        tailUnits.push({
          label: tail.entry.label,
          priority: tail.entry.priority,
          ageMs: round1(ageMs),
          atMs: Math.round(tail.startedAt),
        });
      }
      return {
        units,
        totalSyncMs: round1(totalSyncMs),
        worstSyncMs: round1(worstSyncMs),
        slowest: slowest.map((stat) => ({
          ...stat,
          syncMs: round1(stat.syncMs),
          wallMs: round1(stat.wallMs),
          atMs: Math.round(stat.atMs),
        })),
        pending: pending.length,
        active: activeUnit,
        waitingTails: tailUnits,
        stallCount,
        stalls: stalls.map((stall) => ({
          ...stall,
          ageMs: round1(stall.ageMs),
          atMs: Math.round(stall.atMs),
        })),
      };
    },
    shutdown(reason = new Error('Background GPU queue is shut down')): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      accepting = false;
      shutdownReason = reason;
      for (const entry of pending.splice(0)) entry.reject(reason);
      shutdownPromise = new Promise<void>((resolve) => {
        resolveShutdown = resolve;
      });
      settleShutdownIfIdle();
      return shutdownPromise;
    },
  };
}
