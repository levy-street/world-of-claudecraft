export type CompileBatchRunner<Target> = (targets: readonly Target[]) => Promise<unknown>;

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

  flush(run: CompileBatchRunner<Target>): Promise<void> | null {
    if (this.targets.length === 0) return this.pending;
    if (this.pending) return this.pending;

    const activeTargets = this.targets.splice(0);
    const activeWaiters = this.waiters.splice(0);
    this.pending = Promise.resolve()
      .then(() => run(activeTargets))
      .then(() => undefined)
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
