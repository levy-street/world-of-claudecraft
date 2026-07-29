// Boot-time asset preload registry. Render modules register their fetches here
// and startGame awaits assetsReady() before constructing the Renderer, so scene
// build can stay synchronous.
//
// There are TWO lanes, and the difference is only WHEN the fetch starts:
//
//   registerPreload(promise)        eager: the fetch is already running. For the
//                                  handful of assets the LAUNCHER itself draws.
//   registerDeferredPreload(thunk)  deferred: nothing runs until startGame calls
//                                  beginDeferredPreloads(), i.e. the player has
//                                  pressed Play. For world content.
//
// Why: every world module used to fetch at module import, so simply reaching the
// home screen decoded the whole asset set. The files are local to the app bundle,
// so there is no network pacing them, and the decode spike (GLB de-interleaving is
// a memory amplifier) crossed WKWebView's per-process ceiling. A 12 GB iPhone 17
// Pro was killed 1.6 s into the LAUNCHER and reloaded forever, because the entry
// crash guard only arms inside startGame and so could not even see it. That
// ceiling does not scale with device RAM, which is why bigger phones were not
// safe either.
//
// This does NOT weaken the tier-independent superset invariant that props.ts and
// characters/manifest.ts document (the v0.16.0 farmCrate P0): assetsReady() still
// awaits every registered task before the Renderer is constructed, so placement
// still cannot outrun a load. Only the start time moved. The ordering that makes
// that true (begin, then await) is pinned by tests/defer_launcher_preloads.test.ts.
import { assetLoadStarted, recordPreloadWait } from './stats';

const tasks: Promise<unknown>[] = [];
const deferredStarters: (() => Promise<unknown>)[] = [];
let deferredBegun = false;

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

/**
 * Register a world-content fetch that must NOT run on the launcher. The thunk is
 * held until beginDeferredPreloads(); it must CREATE the promise when called, not
 * close over one that is already in flight, or nothing is actually deferred.
 *
 * Registering after the lane has already been opened (a module imported lazily
 * mid-session) starts immediately, so a late import can never strand its assets
 * behind a gate that has already been lifted.
 */
export function registerDeferredPreload(start: () => Promise<unknown>): void {
  if (deferredBegun) {
    registerPreload(start());
    return;
  }
  deferredStarters.push(start);
}

/**
 * Open the deferred lane: world entry has begun. Idempotent, and returns how many
 * fetches it started so the caller can log it. MUST run before the assetsReady()
 * that gates the Renderer, because assetsReady captures the task list when called.
 */
export function beginDeferredPreloads(): number {
  if (deferredBegun) return 0;
  deferredBegun = true;
  const started = deferredStarters.length;
  for (const start of deferredStarters) {
    // A thunk that throws synchronously must surface through assetsReady's
    // aggregate rather than escaping into the caller's stack.
    try {
      registerPreload(start());
    } catch (err) {
      registerPreload(Promise.reject(err));
    }
  }
  deferredStarters.length = 0;
  return started;
}

/** Test-only view of the registry, so a guard can prove no task retains its
 *  resolution value (see tests/ios_entry_memory.test.ts) and that the deferred
 *  lane really holds its fetches back. */
export const preloadInternalsForTest = {
  tasks: (): readonly Promise<unknown>[] => tasks,
  pendingDeferred: (): number => deferredStarters.length,
  begun: (): boolean => deferredBegun,
  reset: (): void => {
    tasks.length = 0;
    deferredStarters.length = 0;
    deferredBegun = false;
  },
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
