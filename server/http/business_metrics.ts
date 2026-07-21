// Cached player and business gauges. Separate engagement and funnel refreshes
// read compact indexed lifecycle facts; Prometheus scrapes never query Postgres,
// and the fixed period/segment/day labels bound cardinality.

import { Counter, Gauge, type Registry } from 'prom-client';
import { pool } from '../db';
import {
  DAY_ONE_FUNNEL_STAGES,
  FIRST_DAY_PLAYTIME_BUCKETS,
  type PlayerBusinessDay,
  type PlayerBusinessSnapshot,
  type PlayerFunnelDay,
  type PlayerFunnelSnapshot,
  playerBusinessSnapshot,
  playerFunnelSnapshot,
} from '../player_metrics_db';
import { REALM } from '../realm';
import { PeriodicCollector } from './periodic_collector';

export const WOC_PLAYER_ACCOUNTS_CREATED = 'woc_player_accounts_created';
export const WOC_PLAYER_CHARACTERS_CREATED = 'woc_player_characters_created';
export const WOC_PLAYER_FIRST_CHARACTER_ACCOUNTS = 'woc_player_first_character_accounts';
export const WOC_PLAYER_FIRST_WORLD_ENTRY_RATE = 'woc_player_first_world_entry_rate';
export const WOC_PLAYER_DAILY_ACTIVE_ACCOUNTS = 'woc_player_daily_active_accounts';
export const WOC_PLAYER_DAILY_PLAYTIME_SECONDS = 'woc_player_daily_playtime_seconds';
export const WOC_PLAYER_FIRST_SESSION_MEDIAN_SECONDS = 'woc_player_first_session_median_seconds';
export const WOC_PLAYER_FIRST_SESSION_LEVEL_RATE = 'woc_player_first_session_level_rate';
export const WOC_PLAYER_RETENTION_RATE = 'woc_player_retention_rate';
export const WOC_PLAYER_FIRST_DAY_PLAYTIME_SECONDS = 'woc_player_first_day_playtime_seconds';
export const WOC_PLAYER_FIRST_DAY_SESSIONS = 'woc_player_first_day_sessions';
export const WOC_PLAYER_FIRST_DAY_PLAYTIME_ACCOUNTS = 'woc_player_first_day_playtime_accounts';
export const WOC_PLAYER_FUNNEL_ACCOUNTS = 'woc_player_funnel_accounts';
export const WOC_METRICS_COLLECTOR_REFRESH_FAILURES =
  'woc_metrics_collector_refresh_failures_total';
export const WOC_METRICS_COLLECTOR_SNAPSHOT_AGE_SECONDS =
  'woc_metrics_collector_snapshot_age_seconds';

/** Business data changes slowly; each bounded snapshot refreshes every 15 minutes. */
export const BUSINESS_METRICS_REFRESH_MS = 15 * 60_000;
/** Keep the two bounded snapshots from competing for a pooled client in one process. */
export const FUNNEL_METRICS_INITIAL_DELAY_MS = 5_000;

const PERIODS = ['today', 'yesterday'] as const;
const PLAYTIME_SEGMENTS = ['all', 'new', 'level_20'] as const;
const FIRST_SESSION_LEVELS = [2, 5] as const;
const RETENTION_DAYS = [1, 7, 30] as const;

export interface BusinessMetricQueries {
  business: () => Promise<PlayerBusinessSnapshot>;
  funnel: () => Promise<PlayerFunnelSnapshot>;
}

export interface BusinessMetricsCollector {
  refresh(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

function dayFor(snapshot: PlayerBusinessSnapshot, period: string): PlayerBusinessDay | undefined {
  return snapshot.days.find((day) => day.period === period);
}

function funnelDayFor(snapshot: PlayerFunnelSnapshot, period: string): PlayerFunnelDay | undefined {
  return snapshot.days.find((day) => day.period === period);
}

function setIfPresent(
  gauge: Gauge<string>,
  labels: Record<string, string>,
  value: number | null,
): void {
  if (value !== null) gauge.set(labels, value);
}

export function registerBusinessMetrics(
  registry: Registry,
  queries: BusinessMetricQueries = {
    business: () => playerBusinessSnapshot(pool, REALM),
    funnel: () => playerFunnelSnapshot(pool, REALM),
  },
  intervalMs: number = BUSINESS_METRICS_REFRESH_MS,
  funnelInitialDelayMs: number = FUNNEL_METRICS_INITIAL_DELAY_MS,
): BusinessMetricsCollector {
  const refreshFailures = new Counter({
    name: WOC_METRICS_COLLECTOR_REFRESH_FAILURES,
    help: 'Failed refresh attempts for a cached database-backed metrics collector.',
    labelNames: ['collector'],
    registers: [registry],
  });
  const onError = (collector: 'engagement' | 'funnel') => (err: unknown) => {
    refreshFailures.inc({ collector });
    console.error(`metrics collector refresh failed (${collector}):`, err);
  };
  const engagementCollector = new PeriodicCollector(
    queries.business,
    intervalMs,
    onError('engagement'),
  );
  const funnelCollector = new PeriodicCollector(queries.funnel, intervalMs, onError('funnel'));

  new Gauge({
    name: WOC_METRICS_COLLECTOR_SNAPSHOT_AGE_SECONDS,
    help: 'Age in seconds of the last successful cached database-backed metrics snapshot.',
    labelNames: ['collector'],
    registers: [registry],
    collect() {
      for (const [name, collector] of [
        ['engagement', engagementCollector],
        ['funnel', funnelCollector],
      ] as const) {
        const refreshedAt = collector.lastSuccessfulRefreshAtMs();
        if (refreshedAt !== null) {
          this.set({ collector: name }, Math.max(0, (Date.now() - refreshedAt) / 1_000));
        }
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_ACCOUNTS_CREATED,
    help: 'Accounts created during a UTC calendar period.',
    labelNames: ['period'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = funnelCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = funnelDayFor(snapshot, period);
        if (day) this.set({ period }, day.accountsCreated);
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_CHARACTERS_CREATED,
    help: 'Characters created during a UTC calendar period.',
    labelNames: ['period'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (day) this.set({ period }, day.charactersCreated);
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_FIRST_CHARACTER_ACCOUNTS,
    help: 'Accounts creating their first character during a UTC calendar period.',
    labelNames: ['period'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (day) this.set({ period }, day.firstCharacterAccounts);
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_FIRST_WORLD_ENTRY_RATE,
    help: 'Share of accounts created in a UTC calendar period that first played that day.',
    labelNames: ['period'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = funnelCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = funnelDayFor(snapshot, period);
        if (day) setIfPresent(this, { period }, day.firstWorldEntryRate);
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_DAILY_ACTIVE_ACCOUNTS,
    help: 'Active accounts during a UTC calendar period, split by new or returning.',
    labelNames: ['period', 'segment'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (!day) continue;
        this.set({ period, segment: 'new' }, day.activeNew);
        this.set({ period, segment: 'returning' }, day.activeReturning);
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_DAILY_PLAYTIME_SECONDS,
    help: 'Average daily playtime per active account in seconds, split by lifecycle segment.',
    labelNames: ['period', 'segment'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (!day) continue;
        const values: Record<(typeof PLAYTIME_SEGMENTS)[number], number | null> = {
          all: day.avgPlaytimeSecondsAll,
          new: day.avgPlaytimeSecondsNew,
          level_20: day.avgPlaytimeSecondsLevel20,
        };
        for (const segment of PLAYTIME_SEGMENTS) {
          setIfPresent(this, { period, segment }, values[segment]);
        }
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_FIRST_SESSION_MEDIAN_SECONDS,
    help: 'Median completed first-session duration in seconds for a UTC first-play cohort.',
    labelNames: ['period'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (day) setIfPresent(this, { period }, day.firstSessionMedianSeconds);
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_FIRST_SESSION_LEVEL_RATE,
    help: 'Share of completed first sessions reaching a fixed level threshold.',
    labelNames: ['period', 'level'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (!day) continue;
        const values = {
          2: day.firstSessionLevel2Rate,
          5: day.firstSessionLevel5Rate,
        } as const;
        for (const level of FIRST_SESSION_LEVELS) {
          setIfPresent(this, { period, level: String(level) }, values[level]);
        }
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_RETENTION_RATE,
    help: 'Share of a first-play cohort active again after a fixed number of UTC days.',
    labelNames: ['period', 'day'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        for (const day of RETENTION_DAYS) {
          const retention = snapshot.retention.find(
            (item) => item.period === period && item.day === day,
          );
          if (retention) setIfPresent(this, { period, day: String(day) }, retention.rate);
        }
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_FIRST_DAY_PLAYTIME_SECONDS,
    help: 'First-day playtime percentiles in seconds for accounts that first played in a UTC calendar period.',
    labelNames: ['period', 'stat'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (!day) continue;
        setIfPresent(this, { period, stat: 'p50' }, day.firstDayPlaytimeP50Seconds);
        setIfPresent(this, { period, stat: 'p90' }, day.firstDayPlaytimeP90Seconds);
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_FIRST_DAY_SESSIONS,
    help: 'Median session count on the first day for accounts that first played in a UTC calendar period.',
    labelNames: ['period', 'stat'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (day) setIfPresent(this, { period, stat: 'p50' }, day.firstDaySessionsMedian);
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_FIRST_DAY_PLAYTIME_ACCOUNTS,
    help: 'Accounts that first played in a UTC calendar period, bucketed by first-day playtime.',
    labelNames: ['period', 'bucket'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = engagementCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
        if (!day) continue;
        for (const bucket of FIRST_DAY_PLAYTIME_BUCKETS) {
          this.set({ period, bucket }, day.firstDayPlaytimeAccounts[bucket]);
        }
      }
    },
  });

  new Gauge({
    name: WOC_PLAYER_FUNNEL_ACCOUNTS,
    help: 'Accounts created in a UTC calendar period that completed each stage during that same UTC day.',
    labelNames: ['period', 'stage'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = funnelCollector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = funnelDayFor(snapshot, period);
        if (!day) continue;
        for (const stage of DAY_ONE_FUNNEL_STAGES) {
          this.set({ period, stage }, day.dayOneFunnelAccounts[stage]);
        }
      }
    },
  });

  return {
    async refresh() {
      await engagementCollector.refresh();
      await funnelCollector.refresh();
    },
    start() {
      engagementCollector.start();
      funnelCollector.start(funnelInitialDelayMs);
    },
    async stop() {
      const engagementStop = engagementCollector.stop();
      const funnelStop = funnelCollector.stop();
      await engagementStop;
      await funnelStop;
    },
  };
}
