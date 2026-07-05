<script lang="ts">
  import type { ProviderUsageCache, ProviderUsageSnapshot } from '../types';
  import { t } from '../i18n';
  import { fmtNumber, fmtPercent } from '../format';

  // Provider request counts + cache stats tables (Usage tab, refreshed every 5s).
  // Ported from renderProviderUsage.
  let { usage }: { usage: ProviderUsageSnapshot } = $props();

  const count = (n: number) => fmtNumber(n);

  function cacheEntries(c: ProviderUsageCache): string {
    if (c.maxEntries === null) return fmtNumber(c.entries);
    return t('usage.cacheEntriesOfMax', { entries: fmtNumber(c.entries), max: fmtNumber(c.maxEntries) });
  }

  function cacheHitRate(c: ProviderUsageCache): string {
    const reads = c.hits + c.misses;
    if (reads <= 0) return t('usage.notAvailable');
    return fmtPercent(c.hits / reads);
  }
</script>

<div class="usage-section">
  <h4>{t('usage.requestsTitle')}</h4>
  <div class="table-scroll">
    <table class="usage-table">
      <thead>
        <tr>
          <th>{t('usage.colMetric')}</th>
          {#each usage.windows as w}<th class="num">{t(w.labelKey)}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each usage.metrics as m}
          <tr>
            <td>{t(m.labelKey)}</td>
            {#each usage.windows as w}<td class="num">{count(m.counts[w.key] ?? 0)}</td>{/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
<div class="usage-section">
  <h4>{t('usage.cacheTitle')}</h4>
  <div class="table-scroll">
    <table class="usage-table">
      <thead>
        <tr>
          <th>{t('usage.cacheColCache')}</th>
          <th class="num">{t('usage.cacheColEntries')}</th>
          <th class="num">{t('usage.cacheColHitRate')}</th>
          <th class="num">{t('usage.cacheColHits')}</th>
          <th class="num">{t('usage.cacheColMisses')}</th>
          <th class="num">{t('usage.cacheColStale')}</th>
          <th class="num">{t('usage.cacheColStores')}</th>
          <th class="num">{t('usage.cacheColFailures')}</th>
          <th class="num">{t('usage.cacheColEvictions')}</th>
        </tr>
      </thead>
      <tbody>
        {#each usage.caches as c}
          <tr>
            <td>{t(c.labelKey)}</td>
            <td class="num">{cacheEntries(c)}</td>
            <td class="num">{cacheHitRate(c)}</td>
            <td class="num">{count(c.hits)}</td>
            <td class="num">{count(c.misses)}</td>
            <td class="num">{count(c.staleRefreshes)}</td>
            <td class="num">{count(c.stores)}</td>
            <td class="num">{count(c.failures)}</td>
            <td class="num">{count(c.evictions)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
