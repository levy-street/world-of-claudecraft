// Shared priority arbiter for work that reaches WebGL. A browser idle callback
// only says when a unit may start; it does not prevent independent zone,
// texture, PMREM, archetype, and live compile lanes from starting together.

export const GPU_WORK_PRIORITY = {
  BOOT_RESUME: 0,
  BACKGROUND: 10,
  VISIBLE_PREWARM: 20,
  LIVE_VIEW: 30,
  ACTIONABLE_VIEW: 40,
} as const;

interface PendingGpuWork<T> {
  order: number;
  priority: number;
  label: string;
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

export interface BackgroundGpuQueueStats {
  units: number;
  totalSyncMs: number;
  worstSyncMs: number;
  /** Slowest units by sync slice, worst first, bounded. */
  slowest: GpuWorkUnitStat[];
}

export interface BackgroundGpuQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
  /** Per-unit timing: names which lane's units block the main thread. */
  stats(): BackgroundGpuQueueStats;
  /** Reject queued work, stop accepting more, and await the active unit. */
  shutdown(reason?: Error): Promise<void>;
}

const DEFAULT_SLOWEST_LIMIT = 20;

export function createBackgroundGpuQueue(opts?: {
  now?: () => number;
  slowestLimit?: number;
}): BackgroundGpuQueue {
  const now = opts?.now ?? ((): number => performance.now());
  const slowestLimit = Math.max(1, opts?.slowestLimit ?? DEFAULT_SLOWEST_LIMIT);
  const pending: PendingGpuWork<unknown>[] = [];
  const slowest: GpuWorkUnitStat[] = [];
  let units = 0;
  let totalSyncMs = 0;
  let worstSyncMs = 0;
  let active = false;
  let accepting = true;
  let nextOrder = 0;
  let shutdownReason: Error | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let resolveShutdown: (() => void) | null = null;

  const recordUnit = (entry: PendingGpuWork<unknown>, startedAt: number, syncMs: number): void => {
    units++;
    totalSyncMs += syncMs;
    if (syncMs > worstSyncMs) worstSyncMs = syncMs;
    const stat: GpuWorkUnitStat = {
      label: entry.label,
      priority: entry.priority,
      syncMs,
      wallMs: now() - startedAt,
      atMs: startedAt,
    };
    let index = slowest.length;
    while (index > 0 && slowest[index - 1].syncMs < stat.syncMs) index--;
    slowest.splice(index, 0, stat);
    if (slowest.length > slowestLimit) slowest.length = slowestLimit;
  };

  const settleShutdownIfIdle = (): void => {
    if (accepting || active || pending.length > 0) return;
    resolveShutdown?.();
    resolveShutdown = null;
  };

  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
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
      const startedAt = now();
      let syncMs = 0;
      try {
        const returned = next.work();
        syncMs = now() - startedAt;
        next.resolve(await returned);
      } catch (error) {
        if (syncMs === 0) syncMs = now() - startedAt;
        next.reject(error);
      } finally {
        recordUnit(next, startedAt, syncMs);
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
    ): Promise<T> {
      if (!accepting) {
        return Promise.reject(shutdownReason ?? new Error('Background GPU queue is shut down'));
      }
      const result = new Promise<T>((resolve, reject) => {
        pending.push({
          order: nextOrder++,
          priority,
          label,
          work,
          resolve,
          reject,
        } as PendingGpuWork<unknown>);
      });
      scheduleDrain();
      return result;
    },
    stats(): BackgroundGpuQueueStats {
      return {
        units,
        totalSyncMs: Math.round(totalSyncMs * 10) / 10,
        worstSyncMs: Math.round(worstSyncMs * 10) / 10,
        slowest: slowest.map((stat) => ({
          ...stat,
          syncMs: Math.round(stat.syncMs * 10) / 10,
          wallMs: Math.round(stat.wallMs * 10) / 10,
          atMs: Math.round(stat.atMs),
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
