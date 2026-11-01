/** Tracks the whole departure, not just the database FIFO slot. Retry sleeps
 * and settlements must finish before shutdown can release process ownership. */
export class CharacterDepartures {
  private readonly runs = new WeakMap<object, Promise<void>>();
  private readonly pending = new Set<Promise<void>>();
  private failure: Error | null = null;
  sealed = false;

  recordFailure(error: unknown): void {
    this.failure ??= new Error('character departure did not finish durably', { cause: error });
  }

  run(session: object, depart: () => Promise<void>): Promise<void> {
    const existing = this.runs.get(session);
    if (existing) return existing;
    if (this.sealed) return Promise.resolve();
    // Register before invoking depart: its synchronous prefix removes the session
    // and can re-enter through a socket callback. Keep that prefix synchronous.
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const run = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.runs.set(session, run);
    this.pending.add(run);
    void run.then(
      () => this.pending.delete(run),
      (error: unknown) => {
        this.recordFailure(error);
        this.pending.delete(run);
      },
    );
    try {
      void depart().then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return run;
  }

  /** One budget shared by all drain calls in a shutdown. Only departure waiting
   * consumes it; timeout does NOT cancel a running transaction or retry. */
  shutdownDrain(budgetMs: number): (seal?: boolean) => Promise<void> {
    let remainingMs = budgetMs;
    return async (seal = false) => {
      const started = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('character departure drain timed out')),
          Math.max(0, remainingMs),
        );
      });
      try {
        while (this.pending.size > 0) {
          if (remainingMs <= 0) throw new Error('character departure drain timed out');
          await Promise.race([Promise.allSettled([...this.pending]), timeout]);
        }
        if (this.failure) throw this.failure;
        // No await between the last pending check and sealing. A disconnect in
        // the caller's next microtask must not start another departure.
        if (seal) this.sealed = true;
      } finally {
        clearTimeout(timer);
        remainingMs -= performance.now() - started;
      }
    };
  }
}
