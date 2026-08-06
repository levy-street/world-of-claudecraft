// Recorder observability: plain mutable counters on the hot path (an object
// field bump, never a prom call per event), exported to prom-client at scrape
// time via collect() gauges, the game_metrics convention. Bounded labels only.
import { Gauge, type Registry } from 'prom-client';

export interface ParseCounters {
  recordsBuffered: number;
  recordsEmitted: number;
  recordsDroppedOverflow: number;
  batchesShipped: number;
  batchesShipFailed: number;
  batchesSpooled: number;
  batchesSpoolDropped: number;
  batchesReplayed: number;
  spoolBytes: number;
  fightsOpen: number;
  fightsClosed: number;
  fightsTruncated: number;
  observeMsLast: number;
  observeMsMax: number;
  /** Set once when the budget breaker disables capture; requires a restart. */
  captureDisabled: number;
  censusRuns: number;
  censusRows: number;
  censusFailures: number;
}

export function createParseCounters(): ParseCounters {
  return {
    recordsBuffered: 0,
    recordsEmitted: 0,
    recordsDroppedOverflow: 0,
    batchesShipped: 0,
    batchesShipFailed: 0,
    batchesSpooled: 0,
    batchesSpoolDropped: 0,
    batchesReplayed: 0,
    spoolBytes: 0,
    fightsOpen: 0,
    fightsClosed: 0,
    fightsTruncated: 0,
    observeMsLast: 0,
    observeMsMax: 0,
    captureDisabled: 0,
    censusRuns: 0,
    censusRows: 0,
    censusFailures: 0,
  };
}

export function registerParseMetrics(registry: Registry, counters: ParseCounters): void {
  const gauge = (name: string, help: string, read: () => number): void => {
    new Gauge({
      name,
      help,
      registers: [registry],
      collect() {
        this.set(read());
      },
    });
  };
  gauge(
    'woc_parse_records_buffered',
    'Parse records awaiting ship',
    () => counters.recordsBuffered,
  );
  gauge(
    'woc_parse_records_emitted_total',
    'Parse records emitted since boot',
    () => counters.recordsEmitted,
  );
  gauge(
    'woc_parse_records_dropped_total',
    'Parse records dropped to buffer overflow',
    () => counters.recordsDroppedOverflow,
  );
  gauge(
    'woc_parse_batches_shipped_total',
    'Parse batches shipped ok',
    () => counters.batchesShipped,
  );
  gauge(
    'woc_parse_batches_failed_total',
    'Parse batch ship failures',
    () => counters.batchesShipFailed,
  );
  gauge(
    'woc_parse_batches_spooled_total',
    'Parse batches written to the disk spool',
    () => counters.batchesSpooled,
  );
  gauge(
    'woc_parse_batches_spool_dropped_total',
    'Spooled batches evicted unsent',
    () => counters.batchesSpoolDropped,
  );
  gauge(
    'woc_parse_batches_replayed_total',
    'Spooled batches replayed to the service',
    () => counters.batchesReplayed,
  );
  gauge('woc_parse_spool_bytes', 'Bytes currently in the disk spool', () => counters.spoolBytes);
  gauge(
    'woc_parse_fights_open',
    'Fights currently open in the recorder',
    () => counters.fightsOpen,
  );
  gauge('woc_parse_fights_closed_total', 'Fights closed since boot', () => counters.fightsClosed);
  gauge(
    'woc_parse_fights_truncated_total',
    'Fights that hit the raw event cap',
    () => counters.fightsTruncated,
  );
  gauge(
    'woc_parse_observe_ms_max',
    'Worst single-tick recorder cost in ms',
    () => counters.observeMsMax,
  );
  gauge(
    'woc_parse_capture_disabled',
    'Budget breaker tripped (1 = capture off)',
    () => counters.captureDisabled,
  );
  gauge('woc_parse_census_runs_total', 'Census exports since boot', () => counters.censusRuns);
  gauge(
    'woc_parse_census_rows_total',
    'Census character rows exported since boot',
    () => counters.censusRows,
  );
  gauge(
    'woc_parse_census_failures_total',
    'Census export failures since boot',
    () => counters.censusFailures,
  );
}
