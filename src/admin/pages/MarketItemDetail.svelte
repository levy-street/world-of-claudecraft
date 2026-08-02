<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import BarChart from '../components/BarChart.svelte';
  import LineChart from '../components/LineChart.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtChartBucket, fmtCopper, fmtDate, fmtNumber } from '../format';
  import { getAdminNavigation, routeHref } from '../navigation';
  import { t } from '../i18n';
  import { buildPriceChartPoints, buildVolumeChartPoints } from '../market_view';
  import { auth } from '../state/auth.svelte';
  import type { MarketHistoryBucket, MarketItemDetailResponse } from '../types';

  // One item's market history: median sale price vs lowest ask, traded
  // volume, and a recent-sale ticker. Reached from any Market table row.
  let { item }: { item: string } = $props();
  const navigation = getAdminNavigation();

  let data = $state<MarketItemDetailResponse | null>(null);
  let failed = $state(false);
  let notFound = $state(false);
  let bucket = $state<MarketHistoryBucket>('day');
  let days = $state(30);
  let requestId = 0;

  // Week buckets label like days (there is no dedicated week formatter and
  // the bucket start is a date either way).
  let chartBucket = $derived(bucket === 'hour' ? ('hour' as const) : ('day' as const));
  let pricePoints = $derived(
    data === null
      ? []
      : buildPriceChartPoints(
          data.priceHistory,
          data.askHistory,
          (iso) => fmtChartBucket(iso, chartBucket),
          fmtCopper,
        ),
  );
  let volumePoints = $derived(
    data === null
      ? []
      : buildVolumeChartPoints(data.priceHistory, (iso) => fmtChartBucket(iso, chartBucket)),
  );

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<MarketItemDetailResponse>(
        `/admin/api/market/item?item=${encodeURIComponent(item)}&bucket=${bucket}&days=${days}`,
      );
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
      notFound = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (auth.handleAuthFailure(err)) return;
      notFound = (err as { status?: number }).status === 404;
      failed = !notFound;
    }
  }

  function setRange(nextBucket: MarketHistoryBucket, nextDays: number): void {
    bucket = nextBucket;
    days = nextDays;
    void refresh();
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<a
  class="back-link"
  href={routeHref({ page: 'market' })}
  onclick={(event) => navigation?.navigate(event, { page: 'market' })}
>
  {t('market.back')}
</a>

{#if failed}
  <Panel><div class="empty">{t('market.loadFailed')}</div></Panel>
{:else if notFound}
  <Panel><div class="empty">{t('market.unknownItem')}</div></Panel>
{:else if data === null}
  <Panel><div class="empty">{t('market.loading')}</div></Panel>
{:else}
  <PageHeader title={data.item.name} />
  <Panel>
    <div class="item-facts">
      <span class="text-dim">{data.item.quality} {data.item.kind}</span>
      <span class="text-dim">
        {t('market.vendorSell', { price: fmtCopper(data.item.vendorSellCopper) })}
      </span>
      {#if data.item.vendorBuyCopper !== null}
        <span class="text-dim">
          {t('market.vendorBuy', { price: fmtCopper(data.item.vendorBuyCopper) })}
        </span>
      {/if}
      <span class="text-dim">{t('market.cutNote', { pct: data.cutPct })}</span>
    </div>
    <div class="controls">
      <div class="window-toggle" role="group" aria-label={t('market.rangeLabel')}>
        <button
          type="button"
          class:active={bucket === 'hour' && days === 2}
          onclick={() => setRange('hour', 2)}
        >
          {t('market.range48h')}
        </button>
        <button
          type="button"
          class:active={bucket === 'day' && days === 30}
          onclick={() => setRange('day', 30)}
        >
          {t('market.range30d')}
        </button>
        <button
          type="button"
          class:active={bucket === 'day' && days === 90}
          onclick={() => setRange('day', 90)}
        >
          {t('market.range90d')}
        </button>
        <button
          type="button"
          class:active={bucket === 'week' && days === 365}
          onclick={() => setRange('week', 365)}
        >
          {t('market.range1y')}
        </button>
      </div>
      <button type="button" onclick={() => void refresh()}>{t('market.refresh')}</button>
    </div>
    <h3>{t('market.priceChartTitle')}</h3>
    <p class="text-dim">{t('market.priceChartLegend')}</p>
    <LineChart points={pricePoints} />
    <h3>{t('market.volumeChartTitle')}</h3>
    <BarChart points={volumePoints} />
  </Panel>
  <Panel>
    <h3>{t('market.recentSalesTitle')}</h3>
    {#if data.recentSales.length === 0}
      <div class="empty">{t('market.recentSalesEmpty')}</div>
    {:else}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('market.colSoldAt')}</th>
              <th>{t('market.colQuantity')}</th>
              <th>{t('market.colTotal')}</th>
              <th>{t('market.colUnit')}</th>
              <th>{t('market.colSource')}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.recentSales as sale, index (index)}
              <tr>
                <td>{fmtDate(sale.soldAt)}</td>
                <td>{fmtNumber(sale.quantity)}</td>
                <td>{fmtCopper(sale.totalPriceCopper)}</td>
                <td>{fmtCopper(sale.totalPriceCopper / sale.quantity)}</td>
                <td>
                  {sale.house
                    ? t('market.sourceHouse')
                    : sale.instanced
                      ? t('market.sourceInstanced')
                      : t('market.sourcePlayer')}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Panel>
{/if}

<style>
  .back-link {
    display: inline-block;
    margin-bottom: 12px;
  }

  .item-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 12px;
  }

  .window-toggle {
    display: inline-flex;
    gap: 4px;
  }

  .window-toggle .active {
    outline: 2px solid var(--gold);
  }
</style>
