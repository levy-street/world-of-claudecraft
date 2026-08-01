// Shared fail-soft race for the renderer's async shader-compile gates: new-view
// creation (Renderer.gateViewOnCompile) AND live material-variant swaps on an
// already-visible entity (Renderer.gateSwapOnCompile/gateSwapFlagOnCompile),
// see issue #2571. KHR_parallel_shader_compile lets a program link off the
// main thread; this races that against a bounded timeout so a driver that
// never reports completion can't strand a caller hidden forever. Pure: the
// caller supplies the actual compile call and the timer, so this stays
// Three/DOM-free and Vitest-driven.

export interface CompileGateScheduler {
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

const defaultScheduler: CompileGateScheduler = {
  setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Resolves once `compile()` settles, success or failure, or `timeoutMs`
 * elapses, whichever comes first. A rejection is swallowed the same as a
 * resolution: the caller only needs to know the gate is DONE, not why (the
 * synchronous first-draw compile is the fallback either way). A `compile()`
 * that throws synchronously (rather than returning a rejected promise, which
 * some driver/extension edge cases do) is caught the same way.
 */
export function raceCompileGate(
  compile: () => Promise<unknown>,
  timeoutMs: number,
  scheduler: CompileGateScheduler = defaultScheduler,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const clear = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const guard = scheduler.setTimeout(clear, timeoutMs);
    try {
      compile()
        .then(clear, clear)
        .finally(() => scheduler.clearTimeout(guard));
    } catch {
      scheduler.clearTimeout(guard);
      clear();
    }
  });
}
