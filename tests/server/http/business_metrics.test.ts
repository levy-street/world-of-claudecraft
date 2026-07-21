import { Registry } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_METRICS_REFRESH_MS,
  FUNNEL_METRICS_INITIAL_DELAY_MS,
  registerBusinessMetrics,
  WOC_METRICS_COLLECTOR_REFRESH_FAILURES,
  WOC_METRICS_COLLECTOR_SNAPSHOT_AGE_SECONDS,
  WOC_PLAYER_ACCOUNTS_CREATED,
  WOC_PLAYER_CHARACTERS_CREATED,
  WOC_PLAYER_DAILY_ACTIVE_ACCOUNTS,
  WOC_PLAYER_DAILY_PLAYTIME_SECONDS,
  WOC_PLAYER_FIRST_CHARACTER_ACCOUNTS,
  WOC_PLAYER_FIRST_DAY_PLAYTIME_ACCOUNTS,
  WOC_PLAYER_FIRST_DAY_PLAYTIME_SECONDS,
  WOC_PLAYER_FIRST_DAY_SESSIONS,
  WOC_PLAYER_FIRST_SESSION_LEVEL_RATE,
  WOC_PLAYER_FIRST_SESSION_MEDIAN_SECONDS,
  WOC_PLAYER_FIRST_WORLD_ENTRY_RATE,
  WOC_PLAYER_FUNNEL_ACCOUNTS,
  WOC_PLAYER_RETENTION_RATE,
} from '../../../server/http/business_metrics';
import type {
  PlayerBusinessSnapshot,
  PlayerFunnelSnapshot,
} from '../../../server/player_metrics_db';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function snapshot(): PlayerBusinessSnapshot {
  return {
    days: [
      {
        period: 'today',
        charactersCreated: 18,
        firstCharacterAccounts: 9,
        activeNew: 8,
        activeReturning: 21,
        avgPlaytimeSecondsAll: 1800,
        avgPlaytimeSecondsNew: 900,
        avgPlaytimeSecondsLevel20: 3600,
        firstSessionMedianSeconds: 720,
        firstSessionLevel2Rate: 0.6,
        firstSessionLevel5Rate: 0.25,
        firstDayPlaytimeP50Seconds: 480,
        firstDayPlaytimeP90Seconds: 5400,
        firstDaySessionsMedian: 1,
        firstDayPlaytimeAccounts: {
          lt_10m: 5,
          '10m_30m': 1,
          '30m_1h': 1,
          '1h_3h': 1,
          gte_3h: 0,
        },
      },
      {
        period: 'yesterday',
        charactersCreated: 14,
        firstCharacterAccounts: 7,
        activeNew: 6,
        activeReturning: 20,
        avgPlaytimeSecondsAll: 1700,
        avgPlaytimeSecondsNew: 800,
        avgPlaytimeSecondsLevel20: 3500,
        firstSessionMedianSeconds: 700,
        firstSessionLevel2Rate: 0.5,
        firstSessionLevel5Rate: 0.2,
        firstDayPlaytimeP50Seconds: null,
        firstDayPlaytimeP90Seconds: null,
        firstDaySessionsMedian: null,
        firstDayPlaytimeAccounts: {
          lt_10m: 4,
          '10m_30m': 1,
          '30m_1h': 0,
          '1h_3h': 0,
          gte_3h: 1,
        },
      },
    ],
    retention: [
      { period: 'today', day: 1, rate: 0.4 },
      { period: 'today', day: 7, rate: 0.2 },
      { period: 'today', day: 30, rate: null },
      { period: 'yesterday', day: 1, rate: 0.35 },
      { period: 'yesterday', day: 7, rate: 0.15 },
      { period: 'yesterday', day: 30, rate: 0.05 },
    ],
  };
}

function funnelSnapshot(createdToday = 12): PlayerFunnelSnapshot {
  return {
    days: [
      {
        period: 'today',
        accountsCreated: createdToday,
        firstWorldEntryRate: 0.75,
        dayOneFunnelAccounts: {
          created: createdToday,
          first_character: 9,
          entered_world: 8,
          played_10m: 3,
          reached_level_2: 2,
          reached_level_5: 1,
        },
      },
      {
        period: 'yesterday',
        accountsCreated: 10,
        firstWorldEntryRate: 0.7,
        dayOneFunnelAccounts: {
          created: 10,
          first_character: 7,
          entered_world: 6,
          played_10m: 2,
          reached_level_2: 1,
          reached_level_5: 0,
        },
      },
    ],
  };
}

function sample(text: string, metric: string, labels: string): string | undefined {
  return text.match(new RegExp(`^${metric}\\{${labels}\\} ([^\\n]+)$`, 'm'))?.[1];
}

describe('registerBusinessMetrics', () => {
  it('refreshes the database snapshot no more often than every 15 minutes by default', () => {
    expect(BUSINESS_METRICS_REFRESH_MS).toBe(15 * 60_000);
    expect(FUNNEL_METRICS_INITIAL_DELAY_MS).toBe(5_000);
  });

  it('publishes fixed engagement and funnel gauges from independent cached snapshots', async () => {
    const registry = new Registry();
    const business = vi.fn(async () => snapshot());
    const funnel = vi.fn(async () => funnelSnapshot());
    const collector = registerBusinessMetrics(registry, { business, funnel });
    await collector.refresh();
    expect(business).toHaveBeenCalledTimes(1);
    expect(funnel).toHaveBeenCalledTimes(1);
    const text = await registry.metrics();

    expect(WOC_PLAYER_ACCOUNTS_CREATED).toBe('woc_player_accounts_created');
    expect(WOC_PLAYER_CHARACTERS_CREATED).toBe('woc_player_characters_created');
    expect(WOC_PLAYER_FIRST_CHARACTER_ACCOUNTS).toBe('woc_player_first_character_accounts');
    expect(WOC_PLAYER_FIRST_WORLD_ENTRY_RATE).toBe('woc_player_first_world_entry_rate');
    expect(WOC_PLAYER_DAILY_ACTIVE_ACCOUNTS).toBe('woc_player_daily_active_accounts');
    expect(WOC_PLAYER_DAILY_PLAYTIME_SECONDS).toBe('woc_player_daily_playtime_seconds');
    expect(WOC_PLAYER_FIRST_SESSION_MEDIAN_SECONDS).toBe('woc_player_first_session_median_seconds');
    expect(WOC_PLAYER_FIRST_SESSION_LEVEL_RATE).toBe('woc_player_first_session_level_rate');
    expect(WOC_PLAYER_RETENTION_RATE).toBe('woc_player_retention_rate');

    expect(sample(text, WOC_PLAYER_ACCOUNTS_CREATED, 'period="today"')).toBe('12');
    expect(sample(text, WOC_PLAYER_CHARACTERS_CREATED, 'period="today"')).toBe('18');
    expect(sample(text, WOC_PLAYER_FIRST_CHARACTER_ACCOUNTS, 'period="today"')).toBe('9');
    expect(sample(text, WOC_PLAYER_FIRST_WORLD_ENTRY_RATE, 'period="today"')).toBe('0.75');
    expect(sample(text, WOC_PLAYER_DAILY_ACTIVE_ACCOUNTS, 'period="today",segment="new"')).toBe(
      '8',
    );
    expect(
      sample(text, WOC_PLAYER_DAILY_ACTIVE_ACCOUNTS, 'period="today",segment="returning"'),
    ).toBe('21');
    expect(
      sample(text, WOC_PLAYER_DAILY_PLAYTIME_SECONDS, 'period="today",segment="level_20"'),
    ).toBe('3600');
    expect(sample(text, WOC_PLAYER_FIRST_SESSION_MEDIAN_SECONDS, 'period="today"')).toBe('720');
    expect(sample(text, WOC_PLAYER_FIRST_SESSION_LEVEL_RATE, 'period="today",level="5"')).toBe(
      '0.25',
    );
    expect(sample(text, WOC_PLAYER_RETENTION_RATE, 'period="today",day="7"')).toBe('0.2');
    expect(sample(text, WOC_PLAYER_RETENTION_RATE, 'period="yesterday",day="30"')).toBe('0.05');
    expect(text).not.toContain('woc_player_retention_rate{period="today",day="30"}');

    expect(WOC_PLAYER_FIRST_DAY_PLAYTIME_SECONDS).toBe('woc_player_first_day_playtime_seconds');
    expect(WOC_PLAYER_FIRST_DAY_SESSIONS).toBe('woc_player_first_day_sessions');
    expect(WOC_PLAYER_FIRST_DAY_PLAYTIME_ACCOUNTS).toBe('woc_player_first_day_playtime_accounts');
    expect(WOC_PLAYER_FUNNEL_ACCOUNTS).toBe('woc_player_funnel_accounts');

    expect(sample(text, WOC_PLAYER_FIRST_DAY_PLAYTIME_SECONDS, 'period="today",stat="p50"')).toBe(
      '480',
    );
    expect(sample(text, WOC_PLAYER_FIRST_DAY_PLAYTIME_SECONDS, 'period="today",stat="p90"')).toBe(
      '5400',
    );
    expect(text).not.toContain(
      'woc_player_first_day_playtime_seconds{period="yesterday",stat="p50"}',
    );
    expect(sample(text, WOC_PLAYER_FIRST_DAY_SESSIONS, 'period="today",stat="p50"')).toBe('1');
    expect(text).not.toContain('woc_player_first_day_sessions{period="yesterday",stat="p50"}');
    expect(
      sample(text, WOC_PLAYER_FIRST_DAY_PLAYTIME_ACCOUNTS, 'period="today",bucket="lt_10m"'),
    ).toBe('5');
    expect(
      sample(text, WOC_PLAYER_FIRST_DAY_PLAYTIME_ACCOUNTS, 'period="yesterday",bucket="gte_3h"'),
    ).toBe('1');
    expect(sample(text, WOC_PLAYER_FUNNEL_ACCOUNTS, 'period="today",stage="created"')).toBe('12');
    expect(sample(text, WOC_PLAYER_FUNNEL_ACCOUNTS, 'period="today",stage="first_character"')).toBe(
      '9',
    );
    expect(sample(text, WOC_PLAYER_FUNNEL_ACCOUNTS, 'period="today",stage="entered_world"')).toBe(
      '8',
    );
    expect(sample(text, WOC_PLAYER_FUNNEL_ACCOUNTS, 'period="today",stage="played_10m"')).toBe('3');
    expect(sample(text, WOC_PLAYER_FUNNEL_ACCOUNTS, 'period="today",stage="reached_level_2"')).toBe(
      '2',
    );
    expect(
      sample(text, WOC_PLAYER_FUNNEL_ACCOUNTS, 'period="yesterday",stage="reached_level_5"'),
    ).toBe('0');
  });

  it('never queries on scrape and bounds every label value', async () => {
    const registry = new Registry();
    const business = vi.fn(async () => snapshot());
    const funnel = vi.fn(async () => funnelSnapshot());
    const collector = registerBusinessMetrics(registry, { business, funnel });
    await collector.refresh();

    for (let i = 0; i < 20; i++) await registry.metrics();
    expect(business).toHaveBeenCalledTimes(1);
    expect(funnel).toHaveBeenCalledTimes(1);

    const text = await registry.metrics();
    const labelValues = (label: string) =>
      new Set([...text.matchAll(new RegExp(`${label}="([^"]+)"`, 'g'))].map((match) => match[1]));
    expect(labelValues('period')).toEqual(new Set(['today', 'yesterday']));
    expect(labelValues('segment')).toEqual(new Set(['new', 'returning', 'all', 'level_20']));
    expect(labelValues('level')).toEqual(new Set(['2', '5']));
    expect(labelValues('day')).toEqual(new Set(['1', '7', '30']));
    expect(labelValues('stat')).toEqual(new Set(['p50', 'p90']));
    expect(labelValues('bucket')).toEqual(
      new Set(['lt_10m', '10m_30m', '30m_1h', '1h_3h', 'gte_3h']),
    );
    expect(labelValues('stage')).toEqual(
      new Set([
        'created',
        'first_character',
        'entered_world',
        'played_10m',
        'reached_level_2',
        'reached_level_5',
      ]),
    );
    for (const forbidden of ['account_id', 'character_id', 'player', 'name', 'ip']) {
      expect(labelValues(forbidden).size).toBe(0);
    }
  });

  it('keeps engagement fresh when the isolated funnel refresh fails and later recovers', async () => {
    const registry = new Registry();
    let charactersCreated = 18;
    let createdToday = 12;
    let failFunnel = false;
    const business = vi.fn(async () => {
      const value = snapshot();
      const today = value.days.find((day) => day.period === 'today');
      if (today) today.charactersCreated = charactersCreated;
      return value;
    });
    const funnel = vi.fn(async () => {
      if (failFunnel) throw new Error('funnel timeout');
      return funnelSnapshot(createdToday);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const collector = registerBusinessMetrics(registry, { business, funnel });

    await collector.refresh();
    charactersCreated = 24;
    createdToday = 15;
    failFunnel = true;
    await collector.refresh();

    let text = await registry.metrics();
    expect(sample(text, WOC_PLAYER_CHARACTERS_CREATED, 'period="today"')).toBe('24');
    expect(sample(text, WOC_PLAYER_ACCOUNTS_CREATED, 'period="today"')).toBe('12');
    expect(sample(text, WOC_METRICS_COLLECTOR_REFRESH_FAILURES, 'collector="funnel"')).toBe('1');
    expect(error).toHaveBeenCalledTimes(1);

    failFunnel = false;
    await collector.refresh();
    text = await registry.metrics();
    expect(sample(text, WOC_PLAYER_ACCOUNTS_CREATED, 'period="today"')).toBe('15');
    expect(business).toHaveBeenCalledTimes(3);
    expect(funnel).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });

  it('publishes snapshot age and phases the funnel refresh after engagement', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    const registry = new Registry();
    const calls: string[] = [];
    const collector = registerBusinessMetrics(
      registry,
      {
        business: vi.fn(async () => {
          calls.push(`engagement:${Date.now()}`);
          return snapshot();
        }),
        funnel: vi.fn(async () => {
          calls.push(`funnel:${Date.now()}`);
          return funnelSnapshot();
        }),
      },
      60_000,
      5_000,
    );

    collector.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['engagement:1784246400000']);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['engagement:1784246400000', 'funnel:1784246405000']);

    await vi.advanceTimersByTimeAsync(10_000);
    const text = await registry.metrics();
    expect(
      Number(sample(text, WOC_METRICS_COLLECTOR_SNAPSHOT_AGE_SECONDS, 'collector="engagement"')),
    ).toBe(15);
    expect(
      Number(sample(text, WOC_METRICS_COLLECTOR_SNAPSHOT_AGE_SECONDS, 'collector="funnel"')),
    ).toBe(10);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(calls).toEqual([
      'engagement:1784246400000',
      'funnel:1784246405000',
      'engagement:1784246460000',
    ]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([
      'engagement:1784246400000',
      'funnel:1784246405000',
      'engagement:1784246460000',
      'funnel:1784246465000',
    ]);

    await collector.stop();
    vi.useRealTimers();
  });

  it('keeps snapshot age anchored to the last successful refresh after a failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    const registry = new Registry();
    let failFunnel = false;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const collector = registerBusinessMetrics(registry, {
      business: vi.fn(async () => snapshot()),
      funnel: vi.fn(async () => {
        if (failFunnel) throw new Error('funnel timeout');
        return funnelSnapshot();
      }),
    });

    await collector.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    failFunnel = true;
    await collector.refresh();

    const text = await registry.metrics();
    expect(
      Number(sample(text, WOC_METRICS_COLLECTOR_SNAPSHOT_AGE_SECONDS, 'collector="engagement"')),
    ).toBe(0);
    expect(
      Number(sample(text, WOC_METRICS_COLLECTOR_SNAPSHOT_AGE_SECONDS, 'collector="funnel"')),
    ).toBe(15);
    expect(sample(text, WOC_METRICS_COLLECTOR_REFRESH_FAILURES, 'collector="funnel"')).toBe('1');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('publishes no labeled samples before the first successful refresh', async () => {
    const registry = new Registry();
    registerBusinessMetrics(registry, {
      business: vi.fn(async () => snapshot()),
      funnel: vi.fn(async () => funnelSnapshot()),
    });
    const text = await registry.metrics();
    expect(text).not.toMatch(/^woc_player_.*\{/m);
  });
});
