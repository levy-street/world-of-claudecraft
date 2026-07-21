import { beforeEach, describe, expect, it } from 'vitest';
import {
  providerUsageSnapshot,
  recordUsageCacheEvent,
  recordUsageMetric,
  resetProviderUsageForTests,
  setUsageCacheSize,
} from '../server/provider_usage';

function metricCounts(key: string, now: number) {
  const metric = providerUsageSnapshot(now).metrics.find((row) => row.key === key);
  if (!metric) throw new Error(`missing metric ${key}`);
  return metric.counts;
}

describe('provider usage metrics', () => {
  beforeEach(() => {
    resetProviderUsageForTests();
  });

  it('reports rolling counts across the admin dashboard windows', () => {
    const now = 1_000_000_000;
    recordUsageMetric('woc.balance.rpc', now - 25 * 60 * 60_000);
    recordUsageMetric('woc.balance.rpc', now - 2 * 60 * 60_000);
    recordUsageMetric('woc.balance.rpc', now - 2 * 60_000);
    recordUsageMetric('woc.balance.rpc', now - 30_000);

    expect(metricCounts('woc.balance.rpc', now)).toEqual({
      m1: 1,
      m5: 2,
      h1: 2,
      h24: 3,
    });
  });

  it('keeps fixed-size bucketed counts under repeated events', () => {
    const now = 1_500_000_000;
    for (let i = 0; i < 25_000; i++) recordUsageMetric('github.releases.api', now);

    expect(metricCounts('github.releases.api', now)).toEqual({
      m1: 25_000,
      m5: 25_000,
      h1: 25_000,
      h24: 25_000,
    });
  });

  it('reuses old ring slots without leaking stale 24h counts', () => {
    const start = 2_000_000_000;
    for (let i = 0; i < 100; i++) recordUsageMetric('turnstile.verify', start);
    expect(metricCounts('turnstile.verify', start).h24).toBe(100);

    const later = start + 24 * 60 * 60_000 + 60_000;
    recordUsageMetric('turnstile.verify', later);

    expect(metricCounts('turnstile.verify', later)).toEqual({
      m1: 1,
      m5: 1,
      h1: 1,
      h24: 1,
    });
  });

  it('reports cache counters and current cache size', () => {
    const now = 2_000_000_000;
    setUsageCacheSize('woc.balance', 3, 1024, now);
    recordUsageCacheEvent('woc.balance', 'hit', now);
    recordUsageCacheEvent('woc.balance', 'miss', now);
    recordUsageCacheEvent('woc.balance', 'stale', now);
    recordUsageCacheEvent('woc.balance', 'store', now);
    recordUsageCacheEvent('woc.balance', 'failure', now);
    recordUsageCacheEvent('woc.balance', 'eviction', now);

    const cache = providerUsageSnapshot(now).caches.find((row) => row.key === 'woc.balance');
    expect(cache).toEqual(expect.objectContaining({
      entries: 3,
      maxEntries: 1024,
      hits: 1,
      misses: 1,
      staleRefreshes: 1,
      stores: 1,
      failures: 1,
      evictions: 1,
    }));
  });
});
