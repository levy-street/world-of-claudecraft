// Boot-time asset preload registry. Render modules kick off their fetches at
// import time and register the promises here; startGame awaits assetsReady()
// before constructing the Renderer so scene build can stay synchronous.
import { assetLoadStarted, recordPreloadWait } from './stats';

const tasks: Promise<unknown>[] = [];

export function registerPreload(task: Promise<unknown>): void {
  // Observe the rejection immediately: in a host that never awaits assetsReady()
  // (a Vitest file importing the render stack in plain Node), an import-time
  // fetch failure must not escalate to an unhandled rejection once the event
  // loop reaches the queued load timers. assetsReady() still receives the
  // original rejection through Promise.allSettled on the stored task.
  task.catch(() => undefined);
  tasks.push(task);
}

export async function assetsReady(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const startedAt = assetLoadStarted();
  // Settled sequentially is fine: fetches already run concurrently. Collect
  // every failure so one bad file reports clearly instead of dying first.
  if (onProgress) {
    const total = tasks.length;
    let done = 0;
    for (const t of tasks) void t.finally(() => onProgress(++done, total)).catch(() => undefined);
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  recordPreloadWait(tasks.length, startedAt, failed.length === 0);
  if (failed.length) {
    throw new Error(
      `asset preload failed (${failed.length}): ${failed.map((f) => String(f.reason)).join('; ')}`,
    );
  }
}
