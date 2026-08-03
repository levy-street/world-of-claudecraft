// Shared fail-soft coordinator for the renderer's async shader-compile gates:
// new-view creation (Renderer.gateViewOnCompile) and live material-variant
// swaps on an already-visible entity. KHR_parallel_shader_compile lets a
// program link off the main thread, but the returned work cannot be cancelled.
// A timeout is therefore diagnostic only: revealing the target at that point
// would make its first draw synchronously finish the same link while the async
// compile remains active. The queue also keeps multiple streamed views from
// starting overlapping driver work during an online snapshot burst.

export interface CompileGateScheduler {
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface CompileGateResult {
  failed: boolean;
  timedOut: boolean;
}

export interface CompileGateOptions {
  onTimeout?: () => void;
  priority?: number;
  scheduler?: CompileGateScheduler;
}

export interface CompileGateWorkQueue {
  run<T>(work: () => T | Promise<T>, priority?: number): Promise<T>;
}

const defaultScheduler: CompileGateScheduler = {
  setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Waits for one non-cancellable compile to settle. The timeout records a slow
 * driver and may notify diagnostics, but never resolves the gate early. A
 * rejection or synchronous throw is fail-soft because no compile remains
 * active and the caller can safely fall back to first-draw compilation.
 */
export function awaitCompileGate(
  compile: () => Promise<unknown>,
  timeoutMs: number,
  options: CompileGateOptions = {},
): Promise<CompileGateResult> {
  const scheduler = options.scheduler ?? defaultScheduler;
  return new Promise<CompileGateResult>((resolve) => {
    let timedOut = false;
    let settled = false;
    const guard = scheduler.setTimeout(() => {
      if (settled) return;
      timedOut = true;
      options.onTimeout?.();
    }, timeoutMs);
    const finish = (failed: boolean): void => {
      if (settled) return;
      settled = true;
      scheduler.clearTimeout(guard);
      resolve({ failed, timedOut });
    };
    try {
      compile().then(
        () => finish(false),
        () => finish(true),
      );
    } catch {
      finish(true);
    }
  });
}

/** Serializes live compile gates so online entity bursts cannot overlap them. */
export class CompileGateQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly sharedQueue?: CompileGateWorkQueue) {}

  run(
    compile: () => Promise<unknown>,
    timeoutMs: number,
    options: CompileGateOptions = {},
  ): Promise<CompileGateResult> {
    const work = () => awaitCompileGate(compile, timeoutMs, options);
    if (this.sharedQueue) return this.sharedQueue.run(work, options.priority);
    const result = this.tail.then(work);
    this.tail = result;
    return result;
  }
}
