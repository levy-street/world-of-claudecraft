// A tiny periodic-cache primitive shared by the app-aggregate /metrics collectors
// (business aggregates in server/http/business_metrics.ts, client-perf aggregates
// in server/http/client_perf_metrics.ts). Both follow the same contract: run one
// bounded aggregate query on a fixed interval, cache the result, and let the
// prom-client gauges publish the CACHED snapshot at scrape time. The DB is never
// touched per scrape, so a scrape storm can never turn into a query storm.
//
// This is deliberately NOT the game-state pattern (server/http/game_metrics.ts),
// where every gauge's collect() reads a cheap in-memory source live at scrape time.
// A Postgres aggregate is not a cheap live read, so these collectors sample on an
// interval instead and the gauges read the last sample.
//
// The refresh is fire-and-forget and self-guarded: a failed query keeps the last
// good snapshot (or the null start state) rather than throwing into the timer, so a
// transient DB blip never crashes the process or wedges the interval.

/**
 * A periodic collector: it holds the latest snapshot of a bounded aggregate query,
 * refreshes it on a fixed interval, and exposes the cached value for the gauges to
 * publish. Construct it with the async query and the interval; call start() at boot
 * (main.ts) and stop() on shutdown. Tests drive refresh() directly and never start
 * the timer.
 */
export class PeriodicCollector<T> {
  private snapshot: T | null = null;
  private lastSuccessAtMs: number | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<T | null> | null = null;

  /**
   * @param query the bounded aggregate to run; its result becomes the new snapshot.
   * @param intervalMs how often to refresh, chosen by each collector.
   * @param onError optional sink for a refresh failure (defaults to console.error);
   *   a failure is swallowed after this so it never propagates into the timer.
   */
  constructor(
    private readonly query: () => Promise<T>,
    private readonly intervalMs: number,
    private readonly onError: (err: unknown) => void = (err) =>
      console.error('metrics collector refresh failed:', err),
  ) {}

  /** The latest cached snapshot, or null before the first successful refresh. */
  current(): T | null {
    return this.snapshot;
  }

  /** Wall-clock time of the last successful refresh, or null before the first one. */
  lastSuccessfulRefreshAtMs(): number | null {
    return this.lastSuccessAtMs;
  }

  /**
   * Run the query once and cache the result. Never throws: a failed query is
   * reported via onError and leaves the previous snapshot in place. Returns the
   * snapshot after the attempt (unchanged on failure) so a test can await it.
   */
  async refresh(): Promise<T | null> {
    if (this.inFlight) return this.inFlight;
    const run = (async () => {
      try {
        this.snapshot = await this.query();
        this.lastSuccessAtMs = Date.now();
      } catch (err) {
        this.onError(err);
      }
      return this.snapshot;
    })();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  /**
   * Kick off a refresh after the optional delay and then repeat every intervalMs.
   * The interval is unref()'d so it never keeps the process alive on its own
   * (mirrors the other boot intervals in main.ts). Idempotent: a second start() is
   * a no-op while running.
   */
  start(initialDelayMs = 0): void {
    if (this.initialTimer || this.timer) return;
    const begin = () => {
      this.initialTimer = null;
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), this.intervalMs);
      this.timer.unref();
    };
    if (initialDelayMs <= 0) {
      begin();
      return;
    }
    this.initialTimer = setTimeout(begin, initialDelayMs);
    this.initialTimer.unref();
  }

  /** Stop the interval and wait for any current refresh to settle. */
  async stop(): Promise<void> {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }
}
