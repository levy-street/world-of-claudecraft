// The daily census exporter: pushes a characters/deeds/playtime-only snapshot
// of this realm through the same spool/shipper pipe as fight telemetry, so the
// service's population views replace woc-scout's dump forensics. PII rule by
// construction: the loader selects from characters and play_sessions durations
// only; nothing from accounts (emails, hashes, IPs) can enter a record.
//
// Scheduling (review): the export runs at a FIXED UTC hour with a day memory,
// never anchored to process boot, so a peak-hour deploy cannot pin the daily
// scan to peak and a restart loop cannot re-run it every boot. A restart
// during the export hour may run it twice; the service upserts census rows
// per (realm, day, characterId), so a double run is idempotent.
import type { CensusRecord } from './contract';
import type { ParseCounters } from './counters';
import type { RecordSink } from './types';

const CENSUS_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Rows enqueued per event-loop turn: a large realm must never fan a whole
 * snapshot into the shipper synchronously on the thread running the world
 * loop (the buffer's overflow path is O(n) per drop). */
const CENSUS_ENQUEUE_CHUNK = 500;

export type CensusLoader = (snapshotDate: string) => Promise<CensusRecord[]>;

export class CensusExporter {
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunDay: string | null = null;

  constructor(
    private readonly load: CensusLoader,
    private readonly sink: RecordSink,
    private readonly counters: ParseCounters,
    /** UTC hour of day the export fires (0 to 23). */
    private readonly censusUtcHour: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    this.checkTimer = setInterval(() => {
      void this.maybeRun();
    }, CENSUS_CHECK_INTERVAL_MS);
    this.checkTimer.unref?.();
  }

  stop(): void {
    if (this.checkTimer !== null) clearInterval(this.checkTimer);
  }

  /** Fires the export when the UTC hour matches and today has not run yet. */
  async maybeRun(): Promise<boolean> {
    const now = this.now();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== this.censusUtcHour || this.lastRunDay === day) return false;
    this.lastRunDay = day;
    await this.runOnce(day);
    return true;
  }

  /** Export one snapshot; errors degrade to a log line, never a throw. */
  async runOnce(snapshotDate?: string): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const day = snapshotDate ?? this.now().toISOString().slice(0, 10);
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
