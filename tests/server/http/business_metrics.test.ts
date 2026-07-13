import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_METRICS_REFRESH_MS,
  registerBusinessMetrics,
  WOC_PLAYER_ACCOUNTS_CREATED,
  WOC_PLAYER_CHARACTERS_CREATED,
  WOC_PLAYER_DAILY_ACTIVE_ACCOUNTS,
  WOC_PLAYER_DAILY_PLAYTIME_SECONDS,
  WOC_PLAYER_FIRST_CHARACTER_ACCOUNTS,
  WOC_PLAYER_FIRST_SESSION_LEVEL_RATE,
  WOC_PLAYER_FIRST_SESSION_MEDIAN_SECONDS,
  WOC_PLAYER_FIRST_WORLD_ENTRY_RATE,
  WOC_PLAYER_RETENTION_RATE,
} from '../../../server/http/business_metrics';
import type { PlayerBusinessSnapshot } from '../../../server/player_metrics_db';

function snapshot(): PlayerBusinessSnapshot {
  return {
    days: [
      {
        period: 'today',
        accountsCreated: 12,
        charactersCreated: 18,
        firstCharacterAccounts: 9,
        firstWorldEntryRate: 0.75,
        activeNew: 8,
        activeReturning: 21,
        avgPlaytimeSecondsAll: 1800,
        avgPlaytimeSecondsNew: 900,
        avgPlaytimeSecondsLevel20: 3600,
        firstSessionMedianSeconds: 720,
        firstSessionLevel2Rate: 0.6,
        firstSessionLevel5Rate: 0.25,
      },
      {
        period: 'yesterday',
        accountsCreated: 10,
        charactersCreated: 14,
        firstCharacterAccounts: 7,
        firstWorldEntryRate: 0.7,
        activeNew: 6,
        activeReturning: 20,
        avgPlaytimeSecondsAll: 1700,
        avgPlaytimeSecondsNew: 800,
        avgPlaytimeSecondsLevel20: 3500,
        firstSessionMedianSeconds: 700,
        firstSessionLevel2Rate: 0.5,
        firstSessionLevel5Rate: 0.2,
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

function sample(text: string, metric: string, labels: string): string | undefined {
  return text.match(new RegExp(`^${metric}\\{${labels}\\} ([^\\n]+)$`, 'm'))?.[1];
}

describe('registerBusinessMetrics', () => {
  it('refreshes the database snapshot no more often than every 15 minutes by default', () => {
    expect(BUSINESS_METRICS_REFRESH_MS).toBe(15 * 60_000);
  });

  it('publishes the fixed player-business gauges from one cached snapshot', async () => {
    const registry = new Registry();
    const query = vi.fn(async () => snapshot());
    const collector = registerBusinessMetrics(registry, query);
    await collector.refresh();
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
  });

  it('never queries on scrape and bounds every label value', async () => {
    const registry = new Registry();
    const query = vi.fn(async () => snapshot());
    const collector = registerBusinessMetrics(registry, query);
    await collector.refresh();

    for (let i = 0; i < 20; i++) await registry.metrics();
    expect(query).toHaveBeenCalledTimes(1);

    const text = await registry.metrics();
    const labelValues = (label: string) =>
      new Set([...text.matchAll(new RegExp(`${label}="([^"]+)"`, 'g'))].map((match) => match[1]));
    expect(labelValues('period')).toEqual(new Set(['today', 'yesterday']));
    expect(labelValues('segment')).toEqual(new Set(['new', 'returning', 'all', 'level_20']));
    expect(labelValues('level')).toEqual(new Set(['2', '5']));
    expect(labelValues('day')).toEqual(new Set(['1', '7', '30']));
    for (const forbidden of ['account_id', 'character_id', 'player', 'name', 'ip']) {
      expect(labelValues(forbidden).size).toBe(0);
    }
  });

  it('publishes no labeled samples before the first successful refresh', async () => {
    const registry = new Registry();
    registerBusinessMetrics(
      registry,
      vi.fn(async () => snapshot()),
    );
    const text = await registry.metrics();
    expect(text).not.toMatch(/^woc_player_.*\{/m);
  });
});
