export const SEEKER_RPC_MAX_ACTIVE = 8;
export const SEEKER_RPC_MAX_QUEUED = 32;
export const SEEKER_RPC_TIMEOUT_MS = 5_000;

interface SeekerRpcExecutorOptions {
  maxActive: number;
  maxQueued: number;
  timeoutMs: number;
  now?: () => number;
}

interface QueuedRpc<T> {
  enqueuedAt: number;
  signal: AbortSignal;
  task(signal: AbortSignal): Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
  abortQueued(): void;
}

export interface SeekerRpcExecutor {
  run<T>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<T>;
  stats(): SeekerRpcExecutorStats;
}

export interface SeekerRpcExecutorStats {
  active: number;
  queued: number;
  coalescedTotal: number;
  queueFullTotal: number;
  timedOutTotal: number;
  completedTotal: number;
  failedTotal: number;
  lastQueueWaitMs: number | null;
  lastTotalDurationMs: number | null;
}

export class SeekerRpcQueueFullError extends Error {
  constructor() {
    super('Seeker RPC queue is full');
    this.name = 'SeekerRpcQueueFullError';
  }
}

export function createSeekerRpcExecutor(
  options: SeekerRpcExecutorOptions = {
    maxActive: SEEKER_RPC_MAX_ACTIVE,
    maxQueued: SEEKER_RPC_MAX_QUEUED,
    timeoutMs: SEEKER_RPC_TIMEOUT_MS,
  },
): SeekerRpcExecutor {
  if (
    !Number.isInteger(options.maxActive) ||
    options.maxActive < 1 ||
    !Number.isInteger(options.maxQueued) ||
    options.maxQueued < 0 ||
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0
  ) {
    throw new RangeError('Seeker RPC executor options must be positive bounded values');
  }

  let active = 0;
  let coalescedTotal = 0;
  let queueFullTotal = 0;
  let timedOutTotal = 0;
  let completedTotal = 0;
  let failedTotal = 0;
  let lastQueueWaitMs: number | null = null;
  let lastTotalDurationMs: number | null = null;
  const now = options.now ?? Date.now;
  const queue: QueuedRpc<unknown>[] = [];
  const flights = new Map<string, Promise<unknown>>();

  function drain(): void {
    while (active < options.maxActive) {
      const next = queue.shift();
      if (!next) return;
      next.signal.removeEventListener('abort', next.abortQueued);
      if (next.signal.aborted) {
        next.reject(next.signal.reason);
        continue;
      }
      start(next);
    }
  }

  function start<T>(entry: QueuedRpc<T>): void {
    active += 1;
    lastQueueWaitMs = Math.max(0, now() - entry.enqueuedAt);
    let callerSettled = false;
    const countActiveTimeout = () => {
      timedOutTotal += 1;
      failedTotal += 1;
      lastTotalDurationMs = Math.max(0, now() - entry.enqueuedAt);
      callerSettled = true;
      entry.reject(entry.signal.reason);
    };
    entry.signal.addEventListener('abort', countActiveTimeout, { once: true });
    void Promise.resolve()
      .then(() => entry.task(entry.signal))
      .then(
        (value) => {
          if (callerSettled) return;
          callerSettled = true;
          completedTotal += 1;
          entry.resolve(value);
        },
        (error) => {
          if (callerSettled) return;
          callerSettled = true;
          failedTotal += 1;
          entry.reject(error);
        },
      )
      .finally(() => {
        entry.signal.removeEventListener('abort', countActiveTimeout);
        lastTotalDurationMs = Math.max(0, now() - entry.enqueuedAt);
        active -= 1;
        drain();
      });
  }

  function schedule<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = AbortSignal.timeout(options.timeoutMs);
    return new Promise<T>((resolve, reject) => {
      const entry: QueuedRpc<T> = {
        enqueuedAt: now(),
        signal,
        task,
        resolve,
        reject,
        abortQueued() {
          const index = queue.indexOf(entry as QueuedRpc<unknown>);
          if (index >= 0) queue.splice(index, 1);
          timedOutTotal += 1;
          failedTotal += 1;
          lastTotalDurationMs = Math.max(0, now() - entry.enqueuedAt);
          reject(signal.reason);
        },
      };

      if (active < options.maxActive) {
        start(entry);
        return;
      }
      if (queue.length >= options.maxQueued) {
        queueFullTotal += 1;
        failedTotal += 1;
        reject(new SeekerRpcQueueFullError());
        return;
      }
      queue.push(entry as QueuedRpc<unknown>);
      signal.addEventListener('abort', entry.abortQueued, { once: true });
    });
  }

  return {
    run<T>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const existing = flights.get(key);
      if (existing) {
        coalescedTotal += 1;
        return existing as Promise<T>;
      }

      const flight = schedule(task);
      flights.set(key, flight);
      void flight.then(
        () => {
          if (flights.get(key) === flight) flights.delete(key);
        },
        () => {
          if (flights.get(key) === flight) flights.delete(key);
        },
      );
      return flight;
    },
    stats() {
      return {
        active,
        queued: queue.length,
        coalescedTotal,
        queueFullTotal,
        timedOutTotal,
        completedTotal,
        failedTotal,
        lastQueueWaitMs,
        lastTotalDurationMs,
      };
    },
  };
}

export const seekerRpcExecutor = createSeekerRpcExecutor();
