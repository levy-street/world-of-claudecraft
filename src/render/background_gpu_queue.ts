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
  work: () => T | Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export interface BackgroundGpuQueue {
  run<T>(work: () => T | Promise<T>, priority?: number): Promise<T>;
  /** Reject queued work, stop accepting more, and await the active unit. */
  shutdown(reason?: Error): Promise<void>;
}

export function createBackgroundGpuQueue(): BackgroundGpuQueue {
  const pending: PendingGpuWork<unknown>[] = [];
  let active = false;
  let accepting = true;
  let nextOrder = 0;
  let shutdownReason: Error | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let resolveShutdown: (() => void) | null = null;

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
      try {
        next.resolve(await next.work());
      } catch (error) {
        next.reject(error);
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
    run<T>(work: () => T | Promise<T>, priority = GPU_WORK_PRIORITY.BACKGROUND): Promise<T> {
      if (!accepting) {
        return Promise.reject(shutdownReason ?? new Error('Background GPU queue is shut down'));
      }
      const result = new Promise<T>((resolve, reject) => {
        pending.push({
          order: nextOrder++,
          priority,
          work,
          resolve,
          reject,
        } as PendingGpuWork<unknown>);
      });
      scheduleDrain();
      return result;
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
