// The daily census exporter: pushes a characters/deeds/playtime-only snapshot
// of this realm through the same spool/shipper pipe as fight telemetry, so the
// service's population views replace woc-scout's dump forensics. PII rule by
// construction: the loader selects from characters and play_sessions durations
// only; nothing from accounts (emails, hashes, IPs) can enter a record.
import type { CensusRecord } from './contract';
import type { ParseCounters } from './counters';
import type { RecordSink } from './types';

const CENSUS_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** First run waits out boot load; a restart mid-day still snapshots today. */
const CENSUS_BOOT_DELAY_MS = 10 * 60 * 1000;
/** Rows enqueued per event-loop turn: a large realm must never fan a whole
 * snapshot into the shipper synchronously on the thread running the world
 * loop (the buffer's overflow path is O(n) per drop). */
const CENSUS_ENQUEUE_CHUNK = 500;

export type CensusLoader = (snapshotDate: string) => Promise<CensusRecord[]>;

export class CensusExporter {
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private dailyTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly load: CensusLoader,
    private readonly sink: RecordSink,
    private readonly counters: ParseCounters,
  ) {}

  start(): void {
    this.bootTimer = setTimeout(() => {
      void this.runOnce();
    }, CENSUS_BOOT_DELAY_MS);
    this.bootTimer.unref?.();
    this.dailyTimer = setInterval(() => {
      void this.runOnce();
    }, CENSUS_INTERVAL_MS);
    this.dailyTimer.unref?.();
  }

  stop(): void {
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    if (this.dailyTimer !== null) clearInterval(this.dailyTimer);
  }

  /** Export one snapshot; errors degrade to a log line, never a throw. */
  async runOnce(snapshotDate?: string): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const day = snapshotDate ?? new Date().toISOString().slice(0, 10);
      const rows = await this.load(day);
      for (let i = 0; i < rows.length; i++) {
        this.sink.enqueue(rows[i] as unknown as Record<string, unknown>);
        if ((i + 1) % CENSUS_ENQUEUE_CHUNK === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      this.counters.censusRuns++;
      this.counters.censusRows += rows.length;
      console.log(`[parse] census exported ${rows.length} characters for ${day}`);
      return rows.length;
    } catch (e) {
      this.counters.censusFailures++;
      console.error('[parse] census export failed:', e);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
