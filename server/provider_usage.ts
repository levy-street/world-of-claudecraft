// Process-local usage telemetry for provider-backed or deliberately throttled
// flows. The admin dashboard reads this as a lightweight operational view; it is
// not persisted, billed, or tied to individual accounts.

export const USAGE_WINDOWS = [
  { key: 'm1', labelKey: 'usage.window.1m', milliseconds: 60_000 },
  { key: 'm5', labelKey: 'usage.window.5m', milliseconds: 5 * 60_000 },
  { key: 'h1', labelKey: 'usage.window.1h', milliseconds: 60 * 60_000 },
  { key: 'h24', labelKey: 'usage.window.24h', milliseconds: 24 * 60 * 60_000 },
] as const;

const USAGE_METRICS = [
  { key: 'woc.balance.api', labelKey: 'usage.metric.wocBalanceApi' },
  { key: 'woc.balance.rate_limited', labelKey: 'usage.metric.wocBalanceRateLimited' },
  { key: 'woc.balance.rpc', labelKey: 'usage.metric.wocBalanceRpc' },
  { key: 'woc.balance.rpc.failure', labelKey: 'usage.metric.wocBalanceRpcFailure' },
  { key: 'turnstile.verify', labelKey: 'usage.metric.turnstileVerify' },
  { key: 'turnstile.verify.failure', labelKey: 'usage.metric.turnstileVerifyFailure' },
  { key: 'github.releases.api', labelKey: 'usage.metric.githubReleasesApi' },
  { key: 'github.releases.fetch', labelKey: 'usage.metric.githubReleasesFetch' },
  { key: 'github.releases.fetch.failure', labelKey: 'usage.metric.githubReleasesFetchFailure' },
  { key: 'github.contributors.fetch', labelKey: 'usage.metric.githubContributorsFetch' },
  {
    key: 'github.contributors.fetch.failure',
    labelKey: 'usage.metric.githubContributorsFetchFailure',
  },
  { key: 'github.link.request', labelKey: 'usage.metric.githubLinkRequest' },
  { key: 'github.link.failure', labelKey: 'usage.metric.githubLinkFailure' },
  { key: 'github.link.rate_limited', labelKey: 'usage.metric.githubLinkRateLimited' },
  { key: 'wallet.challenge.request', labelKey: 'usage.metric.walletChallengeRequest' },
  { key: 'wallet.challenge.rate_limited', labelKey: 'usage.metric.walletChallengeRateLimited' },
  { key: 'wallet.link.request', labelKey: 'usage.metric.walletLinkRequest' },
  { key: 'wallet.link.failure', labelKey: 'usage.metric.walletLinkFailure' },
  { key: 'wallet.link.rate_limited', labelKey: 'usage.metric.walletLinkRateLimited' },
  { key: 'card.publish.request', labelKey: 'usage.metric.cardPublishRequest' },
  { key: 'card.publish.rejected', labelKey: 'usage.metric.cardPublishRejected' },
  { key: 'card.publish.rate_limited', labelKey: 'usage.metric.cardPublishRateLimited' },
] as const;

const USAGE_CACHES = [
  { key: 'woc.balance', labelKey: 'usage.cache.wocBalance' },
  { key: 'github.releases', labelKey: 'usage.cache.githubReleases' },
  { key: 'github.contributors', labelKey: 'usage.cache.githubContributors' },
] as const;

export type UsageWindowKey = (typeof USAGE_WINDOWS)[number]['key'];
export type UsageMetricKey = (typeof USAGE_METRICS)[number]['key'];
export type UsageCacheKey = (typeof USAGE_CACHES)[number]['key'];
export type UsageCacheEvent = 'hit' | 'miss' | 'stale' | 'store' | 'failure' | 'eviction';

export interface UsageWindowSnapshot {
  key: UsageWindowKey;
  labelKey: string;
  milliseconds: number;
}

export interface UsageMetricSnapshot {
  key: UsageMetricKey;
  labelKey: string;
  counts: Record<UsageWindowKey, number>;
}

export interface UsageCacheSnapshot {
  key: UsageCacheKey;
  labelKey: string;
  entries: number;
  maxEntries: number | null;
  hits: number;
  misses: number;
  staleRefreshes: number;
  stores: number;
  failures: number;
  evictions: number;
  updatedAt: string | null;
}

export interface ProviderUsageSnapshot {
  generatedAt: string;
  windows: UsageWindowSnapshot[];
  metrics: UsageMetricSnapshot[];
  caches: UsageCacheSnapshot[];
}

interface UsageCacheCounters {
  entries: number;
  maxEntries: number | null;
  hits: number;
  misses: number;
  staleRefreshes: number;
  stores: number;
  failures: number;
  evictions: number;
  updatedAtMs: number | null;
}

interface MetricWindowCounter {
  bucketMs: number;
  bucketStarts: number[];
  counts: number[];
}

interface MetricCounters {
  windows: Record<UsageWindowKey, MetricWindowCounter>;
}

const WINDOW_BUCKETS: Record<UsageWindowKey, { bucketMs: number; slots: number }> = {
  m1: { bucketMs: 1_000, slots: 60 },
  m5: { bucketMs: 5_000, slots: 60 },
  h1: { bucketMs: 60_000, slots: 60 },
  h24: { bucketMs: 60 * 60_000, slots: 24 },
};

const metricCounters = new Map<UsageMetricKey, MetricCounters>();
const cacheCounters = new Map<UsageCacheKey, UsageCacheCounters>();

function newCacheCounters(): UsageCacheCounters {
  return {
    entries: 0,
    maxEntries: null,
    hits: 0,
    misses: 0,
    staleRefreshes: 0,
    stores: 0,
    failures: 0,
    evictions: 0,
    updatedAtMs: null,
  };
}

function cacheStatsFor(key: UsageCacheKey): UsageCacheCounters {
  const existing = cacheCounters.get(key);
  if (existing) return existing;
  const created = newCacheCounters();
  cacheCounters.set(key, created);
  return created;
}

function newWindowCounter(window: UsageWindowKey): MetricWindowCounter {
  const spec = WINDOW_BUCKETS[window];
  return {
    bucketMs: spec.bucketMs,
    bucketStarts: Array.from({ length: spec.slots }, () => Number.NEGATIVE_INFINITY),
    counts: Array.from({ length: spec.slots }, () => 0),
  };
}

function newMetricCounters(): MetricCounters {
  const windows = {} as Record<UsageWindowKey, MetricWindowCounter>;
  for (const window of USAGE_WINDOWS) windows[window.key] = newWindowCounter(window.key);
  return { windows };
}

function metricStatsFor(key: UsageMetricKey): MetricCounters {
  const existing = metricCounters.get(key);
  if (existing) return existing;
  const created = newMetricCounters();
  metricCounters.set(key, created);
  return created;
}

function bucketIndex(bucketStart: number, bucketMs: number, slots: number): number {
  const raw = Math.floor(bucketStart / bucketMs) % slots;
  return raw < 0 ? raw + slots : raw;
}

function recordWindowCounter(counter: MetricWindowCounter, at: number): void {
  const bucketStart = Math.floor(at / counter.bucketMs) * counter.bucketMs;
  const index = bucketIndex(bucketStart, counter.bucketMs, counter.counts.length);
  if (counter.bucketStarts[index] !== bucketStart) {
    counter.bucketStarts[index] = bucketStart;
    counter.counts[index] = 0;
  }
  counter.counts[index] += 1;
}

function countWindow(counter: MetricWindowCounter, now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  let total = 0;
  for (let i = 0; i < counter.counts.length; i++) {
    const bucketStart = counter.bucketStarts[i];
    if (bucketStart > now) continue;
    if (bucketStart + counter.bucketMs <= cutoff) continue;
    total += counter.counts[i];
  }
  return total;
}

function windowCounts(counters: MetricCounters, now: number): Record<UsageWindowKey, number> {
  const counts = {} as Record<UsageWindowKey, number>;
  for (const window of USAGE_WINDOWS) {
    counts[window.key] = countWindow(counters.windows[window.key], now, window.milliseconds);
  }
  return counts;
}

export function recordUsageMetric(key: UsageMetricKey, at = Date.now()): void {
  const counters = metricStatsFor(key);
  for (const window of USAGE_WINDOWS) recordWindowCounter(counters.windows[window.key], at);
}

export function recordUsageCacheEvent(
  key: UsageCacheKey,
  event: UsageCacheEvent,
  at = Date.now(),
): void {
  const stats = cacheStatsFor(key);
  if (event === 'hit') stats.hits += 1;
  else if (event === 'miss') stats.misses += 1;
  else if (event === 'stale') stats.staleRefreshes += 1;
  else if (event === 'store') stats.stores += 1;
  else if (event === 'failure') stats.failures += 1;
  else stats.evictions += 1;
  stats.updatedAtMs = at;
}

export function setUsageCacheSize(
  key: UsageCacheKey,
  entries: number,
  maxEntries: number | null = null,
  at = Date.now(),
): void {
  const stats = cacheStatsFor(key);
  stats.entries = Math.max(0, Math.floor(entries));
  stats.maxEntries = maxEntries === null ? null : Math.max(0, Math.floor(maxEntries));
  stats.updatedAtMs = at;
}

export function providerUsageSnapshot(now = Date.now()): ProviderUsageSnapshot {
  return {
    generatedAt: new Date(now).toISOString(),
    windows: USAGE_WINDOWS.map((window) => ({ ...window })),
    metrics: USAGE_METRICS.map((definition) => {
      const counters = metricStatsFor(definition.key);
      return { ...definition, counts: windowCounts(counters, now) };
    }),
    caches: USAGE_CACHES.map((definition) => {
      const stats = cacheStatsFor(definition.key);
      return {
        ...definition,
        entries: stats.entries,
        maxEntries: stats.maxEntries,
        hits: stats.hits,
        misses: stats.misses,
        staleRefreshes: stats.staleRefreshes,
        stores: stats.stores,
        failures: stats.failures,
        evictions: stats.evictions,
        updatedAt: stats.updatedAtMs === null ? null : new Date(stats.updatedAtMs).toISOString(),
      };
    }),
  };
}

export function resetProviderUsageForTests(): void {
  metricCounters.clear();
  cacheCounters.clear();
}

export function resetUsageCacheForTests(key: UsageCacheKey): void {
  cacheCounters.delete(key);
}
