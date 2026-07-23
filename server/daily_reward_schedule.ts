export interface DailyRewardScheduleCacheOptions {
  ttlMs: number;
  now?: () => number;
}

/**
 * A single-value schedule cache. Ordinary reads may use the last known good
 * value during an outage, while refresh() is strict for money-moving actions.
 */
export class DailyRewardScheduleCache {
  private value: number | null = null;
  private loadedAt = 0;
  private inFlight: Promise<number> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly load: () => Promise<number>,
    private readonly options: DailyRewardScheduleCacheOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  peek(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
    this.loadedAt = 0;
    this.inFlight = null;
  }

  async read(): Promise<number> {
    if (this.value !== null && this.now() - this.loadedAt < this.options.ttlMs) {
      return this.value;
    }
    try {
      return await this.loadOnce();
    } catch (error) {
      if (this.value !== null) return this.value;
      throw error;
    }
  }

  async refresh(): Promise<number> {
    return this.loadOnce();
  }

  private loadOnce(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.load()
      .then((value) => {
        this.value = value;
        this.loadedAt = this.now();
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
