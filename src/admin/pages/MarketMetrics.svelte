<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import {
    readAutoRefreshPreference,
    writeAutoRefreshPreference,
  } from '../auto_refresh_preference';
  import AutoRefreshToggle from '../components/AutoRefreshToggle.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtCopper, fmtNumber } from '../format';
  import { t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { AdminMarketMetrics, MarketMetricsBucketId } from '../types';

  // Live World Market listing metrics over the tracked supply buckets: what is
  // on the book right now, never sold volume (there is no durable sales
  // ledger by design). The server caches the readout for ~15s, so polling
  // faster only re-reads its cache.
  const AUTO_REFRESH_STORAGE_KEY = 'claudecraft_admin_market_metrics_auto_refresh';
  const AUTO_REFRESH_MS = 30_000;

  // Bucket titles are chrome, so they are t() keys; item names inside the
  // rows are server data (the AntibotConfig convention).
  const BUCKET_TITLE_KEYS: Record<MarketMetricsBucketId, string> = {
    cores: 'marketMetrics.bucketCores',
    essence: 'marketMetrics.bucketEssence',
    patterns: 'marketMetrics.bucketPatterns',
    produce: 'marketMetrics.bucketProduce',
    seeds: 'marketMetrics.bucketSeeds',
    compost: 'marketMetrics.bucketCompost',
  };

  let metrics = $state<AdminMarketMetrics | null>(null);
  let failed = $state(false);
  let autoRefresh = $state(true);
  let mounted = $state(false);
  let requestId = 0;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<AdminMarketMetrics>('/admin/api/market/metrics');
      if (currentRequest !== requestId) return;
      metrics = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function changeAutoRefresh(enabled: boolean): void {
    autoRefresh = enabled;
    writeAutoRefreshPreference(AUTO_REFRESH_STORAGE_KEY, enabled);
    if (enabled) void refresh();
  }

  $effect(() => {
    if (!mounted || !autoRefresh) return;
    const id = setInterval(() => void refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  });

  onMount(() => {
    autoRefresh = readAutoRefreshPreference(AUTO_REFRESH_STORAGE_KEY);
    mounted = true;
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<Panel title={t('marketMetrics.title')}>
  <div class="page-controls">
    <p class="hint">{t('marketMetrics.hint')}</p>
    <AutoRefreshToggle
      checked={autoRefresh}
      label={t('marketMetrics.autoRefresh', { seconds: AUTO_REFRESH_MS / 1000 })}
      onChange={changeAutoRefresh}
    />
  </div>
  {#if failed}
    <div class="empty">{t('marketMetrics.loadFailed')}</div>
  {:else if metrics === null}
    <div class="empty">{t('marketMetrics.loading')}</div>
  {:else}
    <p class="realm">{t('marketMetrics.realm', { realm: metrics.realm })}</p>
    {#if metrics.buckets.every((bucket) => bucket.listingCount === 0)}
      <div class="empty">{t('marketMetrics.empty')}</div>
    {/if}
    {#each metrics.buckets as bucket (bucket.bucket)}
      <section class="bucket">
        <h3 id={`market-bucket-${bucket.bucket}`}>{t(BUCKET_TITLE_KEYS[bucket.bucket])}</h3>
        <p class="bucket-summary">
          {t('marketMetrics.bucketSummary', {
            listings: fmtNumber(bucket.listingCount),
            quantity: fmtNumber(bucket.totalQuantity),
            listed: fmtNumber(bucket.listedItemCount),
            tracked: fmtNumber(bucket.trackedItemCount),
          })}
        </p>
        {#if bucket.bucket === 'essence'}
          <p class="essence-note">{t('marketMetrics.essenceNote')}</p>
        {/if}
        {#if bucket.items.length === 0}
          <div class="empty">{t('marketMetrics.bucketEmpty')}</div>
        {:else}
          <div class="table-scroll">
            <table aria-labelledby={`market-bucket-${bucket.bucket}`}>
              <thead>
                <tr>
                  <th>{t('marketMetrics.colItem')}</th>
                  <th class="num">{t('marketMetrics.colListings')}</th>
                  <th class="num">{t('marketMetrics.colQuantity')}</th>
                  <th class="num">{t('marketMetrics.colLowest')}</th>
                  <th class="num">{t('marketMetrics.colMedian')}</th>
                </tr>
              </thead>
              <tbody>
                {#each bucket.items as item (item.itemId)}
                  <tr>
                    <td>{item.name}</td>
                    <td class="num">{fmtNumber(item.listingCount)}</td>
                    <td class="num">{fmtNumber(item.totalQuantity)}</td>
                    <td class="num">{fmtCopper(item.lowestPerUnit)}</td>
                    <td class="num">{fmtCopper(item.medianPerUnit)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</Panel>

<style>
  .page-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    margin-bottom: 14px;
  }

  .realm {
    margin: 0 0 12px;
    color: var(--text-soft);
  }

  .bucket {
    margin-bottom: 20px;
  }

  .bucket h3 {
    margin: 0 0 4px;
  }

  .bucket-summary {
    margin: 0 0 8px;
    color: var(--text-soft);
  }

  .essence-note {
    margin: 0 0 8px;
    color: var(--badge-warn-text);
  }

  @media (max-width: 700px) {
    .page-controls {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
    }
  }
</style>
