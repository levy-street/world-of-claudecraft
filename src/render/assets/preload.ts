// Boot-time asset preload registry. Render modules kick off their fetches at
// import time and register the promises here; startGame awaits assetsReady()
// before constructing the Renderer so scene build can stay synchronous.
import { assetLoadStarted, recordPreloadWait } from './stats';

const tasks: Promise<unknown>[] = [];

export function registerPreload(task: Promise<unknown>): void {
  // Store a VALUE-ERASED view of the task. A settled promise pins its resolution
  // value forever, and several registrants resolve to the live THREE.Texture they
  // just loaded (terrain splats, water normals, the VFX sprite sheet), so keeping
  // the original here made this append-only array a permanent retainer for ~35
  // decoded textures - which also defeats any consumer-side release, since the
  // registry still reaches the texture the consumer just dropped. Erasing the
  // value keeps every settle state (and rejection reason) that assetsReady needs
  // while retaining nothing: no drain, so repeat and concurrent callers behave
  // exactly as they always did.
  const erased = task.then(() => undefined);
  // Observe the rejection immediately, on BOTH the original and the erased view:
  // in a host that never awaits assetsReady() (a Vitest file importing the render
  // stack in plain Node), an import-time fetch failure must not escalate to an
  // unhandled rejection once the event loop reaches the queued load timers.
  // These handlers create separate derived promises, so `erased` itself still
  // rejects and assetsReady() still receives the reason via Promise.allSettled.
  task.catch(() => undefined);
  erased.catch(() => undefined);
  tasks.push(erased);
}

/** Test-only view of the registry, so a guard can prove no task retains its
 *  resolution value (see tests/ios_entry_memory.test.ts). */
export const preloadInternalsForTest = {
  tasks: (): readonly Promise<unknown>[] => tasks,
};

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
