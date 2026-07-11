// The business-aggregate half of the /metrics exporter (Phase 3): signups,
// characters, active sessions, average playtime, and peak online, published as
// bounded prom-client gauges on the SAME registry the RED exporter builds
// (server/http/metrics.ts), exactly like the game-state half
// (server/http/game_metrics.ts). Prometheus attaches env / service=game /
// server_name at scrape time, so nothing here emits those.
//
// SAMPLED ON AN INTERVAL, CACHED, PUBLISHED AT SCRAPE TIME. Unlike the game-state
// gauges (cheap in-memory live reads), each value here comes from a Postgres
// aggregate, so a PeriodicCollector (server/http/periodic_collector.ts) runs the
// ONE overviewCounts() batch on a 30-60s interval and caches it; the gauges publish
// the cached snapshot when registry.metrics() runs. A scrape never hits the DB, so a
// scrape storm can never become a query storm. Before the first refresh (or after a
// failed one) the collector holds null and the gauges publish nothing.
//
// SQL IS REUSED, NOT DUPLICATED. Every value comes from overviewCounts() in
// server/admin_db.ts (the admin dashboard's overview query); this module only maps
// its fields onto gauges. No SQL lives here.
//
// CARDINALITY IS BOUNDED BY DESIGN, same contract as server/http/metrics.ts: the
// only label is `window`, drawn from a fixed small set (today/week/month, all_time).
// Nothing per-entity (account id, character id, name) is ever a label.

import { Gauge, type Registry } from 'prom-client';
import type { OverviewCounts } from '../admin_db';
import { overviewCounts } from '../admin_db';
import { PeriodicCollector } from './periodic_collector';

/** Total registered accounts. */
export const WOC_ACCOUNTS_TOTAL = 'woc_accounts_total';

/** New account signups within a fixed window, labeled by `window` (today/week/month). */
export const WOC_SIGNUPS_TOTAL = 'woc_signups_total';

/** Total created characters. */
export const WOC_CHARACTERS_TOTAL = 'woc_characters_total';

/** Distinct accounts with an active play session in a window, labeled by `window` (today/week/month). */
export const WOC_ACTIVE_SESSIONS = 'woc_active_sessions';

/** Average lifetime playtime per account, in SECONDS. */
export const WOC_AVG_PLAYTIME_SECONDS = 'woc_avg_playtime_seconds';

/** Peak concurrent players online in a window, labeled by `window` (today/all_time). */
export const WOC_PEAK_ONLINE = 'woc_peak_online';

/**
 * How often the collector re-runs overviewCounts(). 60s keeps the query cost
 * negligible (one batched read per minute, independent of scrape frequency) while
 * staying fresh enough for a business dashboard, and matches ADMIN_ONLINE_SAMPLE_MS
 * so the peak-online sample it reads is at most one interval stale.
 */
export const BUSINESS_METRICS_REFRESH_MS = 60_000;

/**
 * The fixed signup windows exposed on woc_signups_total, mapped to their
 * OverviewCounts field. This list (not the data) bounds the `window` label set.
 */
const SIGNUP_WINDOWS: ReadonlyArray<{ window: string; field: keyof OverviewCounts }> = [
  { window: 'today', field: 'accountsToday' },
  { window: 'week', field: 'accountsWeek' },
  { window: 'month', field: 'accountsMonth' },
];

/** The fixed active-session windows exposed on woc_active_sessions. */
const ACTIVE_SESSION_WINDOWS: ReadonlyArray<{ window: string; field: keyof OverviewCounts }> = [
  { window: 'today', field: 'activeAccountsToday' },
  { window: 'week', field: 'activeAccountsWeek' },
  { window: 'month', field: 'activeAccountsMonth' },
];

/** The fixed peak-online windows exposed on woc_peak_online. */
const PEAK_ONLINE_WINDOWS: ReadonlyArray<{ window: string; field: keyof OverviewCounts }> = [
  { window: 'today', field: 'peakOnlineToday' },
  { window: 'all_time', field: 'peakOnlineAllTime' },
];

/** The handle main.ts holds to start/stop the interval; tests refresh() it directly. */
export type BusinessMetricsCollector = PeriodicCollector<OverviewCounts>;

/**
 * Register the business-aggregate gauges on `registry` and return the collector
 * that feeds them. The gauges publish the collector's CACHED snapshot at scrape
 * time (nothing if it is still null), so registry.metrics() never queries Postgres.
 * Boot (main.ts) calls collector.start() to begin the interval; a test injects a
 * fake query and calls refresh() by hand.
 *
 * @param registry the shared exporter registry.
 * @param query the aggregate source; defaults to overviewCounts (admin_db.ts). A
 *   test passes a fake so no Postgres is needed.
 * @param intervalMs the refresh cadence; defaults to BUSINESS_METRICS_REFRESH_MS.
 */
export function registerBusinessMetrics(
  registry: Registry,
  query: () => Promise<OverviewCounts> = overviewCounts,
  intervalMs: number = BUSINESS_METRICS_REFRESH_MS,
): BusinessMetricsCollector {
  const collector = new PeriodicCollector(query, intervalMs);

  new Gauge({
    name: WOC_ACCOUNTS_TOTAL,
    help: 'Total registered accounts.',
    registers: [registry],
    collect() {
      const counts = collector.current();
      if (counts) this.set(counts.accounts);
    },
  });

  new Gauge({
    name: WOC_SIGNUPS_TOTAL,
    help: 'New account signups within a fixed window, by window (today/week/month).',
    labelNames: ['window'],
    registers: [registry],
    collect() {
      const counts = collector.current();
      if (!counts) return;
      for (const { window, field } of SIGNUP_WINDOWS) {
        this.set({ window }, counts[field]);
      }
    },
  });

  new Gauge({
    name: WOC_CHARACTERS_TOTAL,
    help: 'Total created characters.',
    registers: [registry],
    collect() {
      const counts = collector.current();
      if (counts) this.set(counts.characters);
    },
  });

  new Gauge({
    name: WOC_ACTIVE_SESSIONS,
    help: 'Distinct accounts with an active play session in a window, by window (today/week/month).',
    labelNames: ['window'],
    registers: [registry],
    collect() {
      const counts = collector.current();
      if (!counts) return;
      for (const { window, field } of ACTIVE_SESSION_WINDOWS) {
        this.set({ window }, counts[field]);
      }
    },
  });

  new Gauge({
    name: WOC_AVG_PLAYTIME_SECONDS,
    help: 'Average lifetime playtime per account, in seconds.',
    registers: [registry],
    collect() {
      const counts = collector.current();
      if (counts) this.set(counts.avgPlaytimeSeconds);
    },
  });

  new Gauge({
    name: WOC_PEAK_ONLINE,
    help: 'Peak concurrent players online in a window, by window (today/all_time).',
    labelNames: ['window'],
    registers: [registry],
    collect() {
      const counts = collector.current();
      if (!counts) return;
      for (const { window, field } of PEAK_ONLINE_WINDOWS) {
        this.set({ window }, counts[field]);
      }
    },
  });

  return collector;
}
