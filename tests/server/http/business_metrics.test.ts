// Unit tests for the business-aggregate half of the /metrics exporter
// (server/http/business_metrics.ts): the woc_* business gauges publish the CACHED
// overviewCounts() snapshot at scrape time, sampled on an interval (NOT per scrape),
// with only the fixed `window` label. These pin the exposed metric NAMES as literals
// (a rename fails the test), prove the values match the injected aggregate, prove
// the collector caches (many scrapes drive zero extra queries), and prove the
// `window` label stays bounded with no per-entity label anywhere.

import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import type { OverviewCounts } from '../../../server/admin_db';
import {
  registerBusinessMetrics,
  WOC_ACCOUNTS_TOTAL,
  WOC_ACTIVE_SESSIONS,
  WOC_AVG_PLAYTIME_SECONDS,
  WOC_CHARACTERS_TOTAL,
  WOC_PEAK_ONLINE,
  WOC_SIGNUPS_TOTAL,
} from '../../../server/http/business_metrics';

/** A fully populated OverviewCounts; override any field per test. */
function counts(overrides: Partial<OverviewCounts> = {}): OverviewCounts {
  return {
    accounts: 1000,
    characters: 2500,
    accountsToday: 12,
    accountsWeek: 80,
    accountsMonth: 300,
    sessionsToday: 40,
    activeAccountsToday: 25,
    activeAccountsWeek: 150,
    activeAccountsMonth: 600,
    returningAccountsToday: 10,
    avgPlaytimeSeconds: 3600,
    peakOnlineToday: 55,
    peakOnlineAllTime: 210,
    siteUsersNow: 7,
    ...overrides,
  };
}

function sampleValue(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1];
}

function labelValues(text: string, label: string): Set<string> {
  const values = new Set<string>();
  const re = new RegExp(`${label}="([^"]*)"`, 'g');
  for (const m of text.matchAll(re)) values.add(m[1]);
  return values;
}

describe('registerBusinessMetrics: gauges publish the cached aggregate at scrape time', () => {
  it('exposes every gauge under its exact exported name with the seeded values', async () => {
    const registry = new Registry();
    const query = vi.fn(async () => counts());
    const collector = registerBusinessMetrics(registry, query, 60_000);
    await collector.refresh();
    const text = await registry.metrics();

    // Literal name pins: a rename of any gauge must fail this test.
    expect(WOC_ACCOUNTS_TOTAL).toBe('woc_accounts_total');
    expect(WOC_SIGNUPS_TOTAL).toBe('woc_signups_total');
    expect(WOC_CHARACTERS_TOTAL).toBe('woc_characters_total');
    expect(WOC_ACTIVE_SESSIONS).toBe('woc_active_sessions');
    expect(WOC_AVG_PLAYTIME_SECONDS).toBe('woc_avg_playtime_seconds');
    expect(WOC_PEAK_ONLINE).toBe('woc_peak_online');

    expect(sampleValue(text, /^woc_accounts_total (\d+)$/m)).toBe('1000');
    expect(sampleValue(text, /^woc_characters_total (\d+)$/m)).toBe('2500');
    expect(sampleValue(text, /^woc_avg_playtime_seconds (\d+)$/m)).toBe('3600');

    expect(sampleValue(text, /^woc_signups_total\{window="today"\} (\d+)$/m)).toBe('12');
    expect(sampleValue(text, /^woc_signups_total\{window="week"\} (\d+)$/m)).toBe('80');
    expect(sampleValue(text, /^woc_signups_total\{window="month"\} (\d+)$/m)).toBe('300');

    expect(sampleValue(text, /^woc_active_sessions\{window="today"\} (\d+)$/m)).toBe('25');
    expect(sampleValue(text, /^woc_active_sessions\{window="week"\} (\d+)$/m)).toBe('150');
    expect(sampleValue(text, /^woc_active_sessions\{window="month"\} (\d+)$/m)).toBe('600');

    expect(sampleValue(text, /^woc_peak_online\{window="today"\} (\d+)$/m)).toBe('55');
    expect(sampleValue(text, /^woc_peak_online\{window="all_time"\} (\d+)$/m)).toBe('210');
  });

  it('publishes no labeled series before the first successful refresh', async () => {
    const registry = new Registry();
    registerBusinessMetrics(
      registry,
      vi.fn(async () => counts()),
      60_000,
    );
    // No refresh yet: the snapshot is null, so the WINDOWED gauges set nothing and
    // emit no sample lines. (A bare unlabeled prom-client gauge defaults to 0 until
    // set, so those are not a meaningful "nothing" signal; the labeled ones are.)
    const text = await registry.metrics();
    expect(text).not.toMatch(/^woc_signups_total\{/m);
    expect(text).not.toMatch(/^woc_active_sessions\{/m);
    expect(text).not.toMatch(/^woc_peak_online\{/m);
  });

  it('caches: many scrapes after one refresh drive zero extra queries', async () => {
    const registry = new Registry();
    const query = vi.fn(async () => counts());
    const collector = registerBusinessMetrics(registry, query, 60_000);

    await collector.refresh();
    expect(query).toHaveBeenCalledTimes(1);

    // A scrape storm: the gauges read the cached snapshot, never the DB.
    for (let i = 0; i < 20; i++) await registry.metrics();
    expect(query).toHaveBeenCalledTimes(1);

    // Only an interval refresh re-queries.
    await collector.refresh();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('bounds the window label to the fixed set and emits no per-entity label', async () => {
    const registry = new Registry();
    const collector = registerBusinessMetrics(
      registry,
      vi.fn(async () => counts()),
      60_000,
    );
    await collector.refresh();
    const text = await registry.metrics();

    expect(labelValues(text, 'window')).toEqual(new Set(['today', 'week', 'month', 'all_time']));
    for (const forbidden of [
      'account',
      'account_id',
      'character',
      'character_id',
      'player',
      'name',
      'ip',
    ]) {
      expect(labelValues(text, forbidden).size).toBe(0);
    }
  });
});
