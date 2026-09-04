<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import AutoRefreshToggle from '../components/AutoRefreshToggle.svelte';
  import Panel from '../components/Panel.svelte';
  import PermissionDenied from '../components/PermissionDenied.svelte';
  import { fmtCopper, fmtNumber } from '../format';
  import { t } from '../i18n';
  import { createAutoRefresh } from '../state/auto_refresh.svelte';
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

  const surface = createAutoRefresh<AdminMarketMetrics>({
    storageKey: AUTO_REFRESH_STORAGE_KEY,
    intervalMs: AUTO_REFRESH_MS,
    load: () => apiGet<AdminMarketMetrics>('/admin/api/market/metrics'),
  });
  let metrics = $derived(surface.data);

  onMount(() => surface.start());
</script>

<Panel>
  <div class="page-controls">
    <p class="hint">{t('marketMetrics.hint')}</p>
    <AutoRefreshToggle
      checked={surface.enabled}
      label={t('marketMetrics.autoRefresh', { seconds: AUTO_REFRESH_MS / 1000 })}
      onChange={(enabled) => surface.setEnabled(enabled)}
    />
  </div>
  {#if surface.failure === 'forbidden'}
    <PermissionDenied />
  {:else if surface.failure === 'error'}
    <div class="empty">{t('marketMetrics.loadFailed')}</div>
  {:else if metrics === null}
    <div class="empty">{t('marketMetrics.loading')}</div>
  {:else}
    <p class="realm">{t('marketMetrics.realm', { realm: metrics.realm })}</p>
    {#if !metrics.soldAvailable}
      <p class="sold-unavailable">{t('marketMetrics.soldUnavailable')}</p>
    {/if}
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
        {#if metrics.soldAvailable}
          <p class="bucket-sold">
            {bucket.sold.saleCount === 0
              ? t('marketMetrics.soldNone', { days: fmtNumber(metrics.soldWindowDays) })
              : t('marketMetrics.bucketSold', {
                  days: fmtNumber(metrics.soldWindowDays),
                  sales: fmtNumber(bucket.sold.saleCount),
                  quantity: fmtNumber(bucket.sold.quantity),
                  copper: fmtCopper(bucket.sold.copper),
                })}
          </p>
        {/if}
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

  .bucket-sold {
    margin: 0 0 8px;
    color: var(--text-soft);
  }

  .essence-note {
    margin: 0 0 8px;
    color: var(--badge-warn-text);
  }

  .sold-unavailable {
    margin: 0 0 12px;
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
