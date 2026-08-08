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
  /** Names this gate's unit in the shared queue's per-unit timing stats. */
  label?: string;
  scheduler?: CompileGateScheduler;
}

export interface CompileGateWorkQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
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
    if (this.sharedQueue) return this.sharedQueue.run(work, options.priority, options.label);
    const result = this.tail.then(work);
    this.tail = result;
    return result;
  }
}

/**
 * Clears a shared "which target is this pending swap for" token, but only if it
 * still names `owner`. Some renderer.ts call sites reuse ONE EntityView field
 * across a family of mutually exclusive gated swaps instead of one pending flag
 * per swap target (e.g. shapeshift-form creation: sheep/bear/cat/travel share a
 * single formCompilePending token because at most one of them is ever active or
 * newly built per entity per frame). The shared CompileGateQueue runs gates one
 * at a time, but a NEWER swap can still be registered while an OLDER one is
 * still in flight (a fast form-to-form reswap before the first compile settles).
 * Without this guard, the older gate's onSettled would clear the token as soon
 * as it resolves, revealing the newer target before its own compile is done:
 * exactly the freeze this gate exists to prevent. Passing the raw setter
 * (`current => null`) instead of this guard is only safe when the field is
 * dedicated to a single target, as mountCompilePending/visualCompilePending are.
 */
export function settlePendingSwap<T>(current: T | null, owner: T): T | null {
  return current === owner ? null : current;
}
