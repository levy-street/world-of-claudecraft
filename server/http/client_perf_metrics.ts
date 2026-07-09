// The client-perf half of the /metrics exporter (Phase 4): real-user FPS, frame
// p95, and long-frame rate aggregated from client_perf_reports, published as
// BOUNDED prom-client gauges on the SAME registry the RED exporter builds
// (server/http/metrics.ts), like the game-state and business halves. Prometheus
// attaches env / service=game / server_name at scrape time, so nothing here emits
// those.
//
// SAMPLED ON AN INTERVAL, CACHED, PUBLISHED AT SCRAPE TIME. Each value is a Postgres
// aggregate over the last hour, so a PeriodicCollector (periodic_collector.ts) runs
// the ONE capped query (client_perf_metrics_db.ts) on a 60s interval and caches the
// rows; the gauges publish the cached snapshot when registry.metrics() runs. A
// scrape never hits the DB. Before the first refresh the snapshot is null and the
// gauges publish nothing.
//
// CARDINALITY IS BOUNDED IN THE QUERY, NOT HERE. clientPerfMetricRows enforces the
// cap (at most current + previous release, top-N gl_renderer_bucket + 'other', last
// 1h), so the label set is bounded by 2 * (N + 1) series per gauge no matter how
// many releases or GPUs exist. This module trusts that cap: it reset()s each gauge
// per publish and re-sets only the capped rows, so a bucket that drops out of the
// top-N in a later window does not leave a stale series behind. Nothing per-session
// (session id, account id, character id, ip) is ever a label.

import { Gauge, type Registry } from 'prom-client';
import type { ClientPerfRow } from '../client_perf_metrics_db';
import { clientPerfMetricRows } from '../client_perf_metrics_db';
import { PeriodicCollector } from './periodic_collector';

/** Median real-user FPS, labeled by release_version and gl_renderer_bucket. */
export const WOC_CLIENT_FPS = 'woc_client_fps';

/** Median real-user frame p95 in SECONDS, labeled by release_version and gl_renderer_bucket. */
export const WOC_CLIENT_FRAME_P95_SECONDS = 'woc_client_frame_p95_seconds';

/** Long frames per reported frame, labeled by release_version and gl_renderer_bucket. */
export const WOC_CLIENT_LONG_FRAMES_RATE = 'woc_client_long_frames_rate';

/** The bounded label set shared by all three gauges. */
const CLIENT_PERF_LABELS = ['release_version', 'gl_renderer_bucket'] as const;

/**
 * How often the collector re-runs the capped aggregate. 60s keeps the query cost
 * negligible (one batched read per minute, independent of scrape frequency) while
 * tracking "now" closely enough for a real-user perf dashboard.
 */
export const CLIENT_PERF_METRICS_REFRESH_MS = 60_000;

/** The handle main.ts holds to start/stop the interval; tests refresh() it directly. */
export type ClientPerfMetricsCollector = PeriodicCollector<ClientPerfRow[]>;

/**
 * Register the client-perf gauges on `registry` and return the collector that feeds
 * them. The gauges publish the collector's CACHED rows at scrape time (nothing while
 * null), so registry.metrics() never queries Postgres. Each publish reset()s the
 * gauge and re-sets only the capped rows, so a series never lingers past the window
 * in which its bucket was in the top-N. Boot (main.ts) calls collector.start(); a
 * test injects a fake query and calls refresh() by hand.
 *
 * @param registry the shared exporter registry.
 * @param query the aggregate source; defaults to clientPerfMetricRows
 *   (client_perf_metrics_db.ts). A test passes a fake so no Postgres is needed.
 * @param intervalMs the refresh cadence; defaults to CLIENT_PERF_METRICS_REFRESH_MS.
 */
export function registerClientPerfMetrics(
  registry: Registry,
  query: () => Promise<ClientPerfRow[]> = () => clientPerfMetricRows(),
  intervalMs: number = CLIENT_PERF_METRICS_REFRESH_MS,
): ClientPerfMetricsCollector {
  const collector = new PeriodicCollector(query, intervalMs);

  // Each gauge registers itself on `registry` at construction (registers: [registry])
  // and is driven only by its own collect(), so nothing needs to hold the instance.
  new Gauge({
    name: WOC_CLIENT_FPS,
    help: 'Median real-user FPS, by release_version and gl_renderer_bucket (current + previous release, top GPU buckets + other, last hour).',
    labelNames: CLIENT_PERF_LABELS,
    registers: [registry],
    collect() {
      publish(this, collector.current(), (row) => row.medianFps);
    },
  });

  new Gauge({
    name: WOC_CLIENT_FRAME_P95_SECONDS,
    help: 'Median real-user frame p95 in seconds, by release_version and gl_renderer_bucket.',
    labelNames: CLIENT_PERF_LABELS,
    registers: [registry],
    collect() {
      publish(this, collector.current(), (row) => row.frameP95Seconds);
    },
  });

  new Gauge({
    name: WOC_CLIENT_LONG_FRAMES_RATE,
    help: 'Long frames per reported frame, by release_version and gl_renderer_bucket.',
    labelNames: CLIENT_PERF_LABELS,
    registers: [registry],
    collect() {
      publish(this, collector.current(), (row) => row.longFramesRate);
    },
  });

  return collector;
}

/**
 * Publish one gauge from the cached rows: clear the previous label combinations,
 * then set the given value for each current row. Skips entirely while the snapshot
 * is null (before the first refresh), leaving the gauge empty rather than zeroed.
 */
function publish(
  gauge: Gauge<(typeof CLIENT_PERF_LABELS)[number]>,
  rows: ClientPerfRow[] | null,
  value: (row: ClientPerfRow) => number,
): void {
  if (!rows) return;
  gauge.reset();
  for (const row of rows) {
    gauge.set(
      { release_version: row.releaseVersion, gl_renderer_bucket: row.glRendererBucket },
      value(row),
    );
  }
}
