export type CompileBatchRunner<Target> = (targets: readonly Target[]) => Promise<unknown>;
export type CompileBatchErrorHandler = (error: unknown) => void;

export class CompileBatch<Target> {
  private pending: Promise<void> | null = null;
  private targets: Target[] = [];
  private waiters: Array<{ resolve: () => void }> = [];

  request(target: Target): Promise<void> {
    this.targets.push(target);
    return new Promise<void>((resolve) => {
      this.waiters.push({ resolve });
    });
  }

  flush(run: CompileBatchRunner<Target>, onError?: CompileBatchErrorHandler): Promise<void> | null {
    if (this.targets.length === 0) return this.pending;
    if (this.pending) return this.pending;

    const activeTargets = this.targets.splice(0);
    const activeWaiters = this.waiters.splice(0);
    this.pending = Promise.resolve()
      .then(() => run(activeTargets))
      .then(() => undefined)
      .catch((error: unknown) => {
        // The renderer intentionally fire-and-forgets flushes. Keep the internal
        // drain promise fulfilled so a driver compile failure cannot become an
        // unhandled rejection or wedge the next batch. The waiter contract is
        // fail-soft too: views reveal after their bounded gate and retry on use.
        try {
          onError?.(error);
        } catch {}
      })
      .finally(() => {
        for (const waiter of activeWaiters) waiter.resolve();
        this.pending = null;
      });
    return this.pending;
  }

  get isPending(): boolean {
    return this.pending !== null;
  }
}
