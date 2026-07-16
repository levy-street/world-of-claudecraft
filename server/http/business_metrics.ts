// Cached player and business gauges. The refresh reads only compact indexed
// lifecycle facts through playerBusinessSnapshot(); Prometheus scrapes never
// query Postgres, and the fixed period/segment/day labels bound cardinality.

import { Gauge, type Registry } from 'prom-client';
import { pool } from '../db';
import {
  type PlayerBusinessDay,
  type PlayerBusinessSnapshot,
  playerBusinessSnapshot,
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

/** Business data changes slowly; one bounded database sample every 15 minutes is enough. */
export const BUSINESS_METRICS_REFRESH_MS = 15 * 60_000;

const PERIODS = ['today', 'yesterday'] as const;
const PLAYTIME_SEGMENTS = ['all', 'new', 'level_20'] as const;
const FIRST_SESSION_LEVELS = [2, 5] as const;
const RETENTION_DAYS = [1, 7, 30] as const;

export type BusinessMetricsCollector = PeriodicCollector<PlayerBusinessSnapshot>;

function dayFor(snapshot: PlayerBusinessSnapshot, period: string): PlayerBusinessDay | undefined {
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
  query: () => Promise<PlayerBusinessSnapshot> = () => playerBusinessSnapshot(pool, REALM),
  intervalMs: number = BUSINESS_METRICS_REFRESH_MS,
): BusinessMetricsCollector {
  const collector = new PeriodicCollector(query, intervalMs);

  new Gauge({
    name: WOC_PLAYER_ACCOUNTS_CREATED,
    help: 'Accounts created during a UTC calendar period.',
    labelNames: ['period'],
    registers: [registry],
    collect() {
      this.reset();
      const snapshot = collector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
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
      const snapshot = collector.current();
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
      const snapshot = collector.current();
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
      const snapshot = collector.current();
      if (!snapshot) return;
      for (const period of PERIODS) {
        const day = dayFor(snapshot, period);
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
      const snapshot = collector.current();
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
      const snapshot = collector.current();
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
      const snapshot = collector.current();
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
      const snapshot = collector.current();
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
      const snapshot = collector.current();
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

  return collector;
}
