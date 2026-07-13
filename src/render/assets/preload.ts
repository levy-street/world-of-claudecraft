// Boot-time asset preload registry. Render modules register lazy factories at
// import time; startGame starts them by awaiting assetsReady() before it builds
// the Renderer. This keeps game-only assets off the public landing page while
// preserving the synchronous scene-build contract once world entry begins.
import { assetLoadStarted, recordPreloadWait } from './stats';

type PreloadFactory = () => Promise<unknown>;
type PreloadRegistration = Promise<unknown> | PreloadFactory;

const registrations: PreloadRegistration[] = [];
const readyListeners = new Set<() => void>();
let tasks: Promise<unknown>[] | null = null;
let readyPromise: Promise<void> | null = null;
let ready = false;

export function registerPreload(task: PreloadRegistration): void {
  registrations.push(task);
}

function startedTasks(): Promise<unknown>[] {
  if (!tasks) {
    tasks = registrations.map((task) =>
      typeof task === 'function' ? Promise.resolve().then(task) : task,
    );
  }
  return tasks;
}

export async function assetsReady(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const activeTasks = startedTasks();
  if (onProgress) {
    const total = activeTasks.length;
    let done = 0;
    for (const task of activeTasks) {
      void task.finally(() => onProgress(++done, total)).catch(() => undefined);
    }
  }

  if (!readyPromise) {
    const startedAt = assetLoadStarted();
    readyPromise = Promise.allSettled(activeTasks).then((results) => {
      const failed = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      recordPreloadWait(activeTasks.length, startedAt, failed.length === 0);
      if (failed.length) {
        throw new Error(
          `asset preload failed (${failed.length}): ${failed.map((failure) => String(failure.reason)).join('; ')}`,
        );
      }
      ready = true;
      for (const listener of readyListeners) {
        try {
          listener();
        } catch {
          // Readiness observers are optional UI upgrades and cannot fail world boot.
        }
      }
      readyListeners.clear();
    });
  }

  return readyPromise;
}

/** Observe successful preload completion without starting the downloads. */
export function onAssetsReady(listener: () => void): () => void {
  if (ready) {
    try {
      listener();
    } catch {
      // Readiness observers are optional UI upgrades and cannot fail world boot.
    }
    return () => undefined;
  }
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}
