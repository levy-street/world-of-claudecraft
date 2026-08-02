<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import MarketItemLink from '../components/MarketItemLink.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtCopper, fmtNumber, fmtRelative } from '../format';
  import { adminLanguageTag, t } from '../i18n';
  import {
    buildMarketOverviewView,
    type MarketSortColumn,
    type MarketSortDirection,
  } from '../market_view';
  import { auth } from '../state/auth.svelte';
  import type { MarketOverviewResponse } from '../types';

  // The World Market catalog: every tracked item's current book (cheapest ask,
  // depth) beside its 24h/7d sale stats. Rows link into the item detail page.
  let data = $state<MarketOverviewResponse | null>(null);
  let failed = $state(false);
  let search = $state('');
  let kind = $state('all');
  let listedOnly = $state(false);
  let sort = $state<MarketSortColumn>('sales7d');
  let dir = $state<MarketSortDirection>('desc');
  let page = $state(1);
  let requestId = 0;

  let view = $derived(
    buildMarketOverviewView(data?.items ?? [], {
      query: search,
      kind,
      listedOnly,
      sort,
      dir,
      page,
      locale: adminLanguageTag(),
    }),
  );

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<MarketOverviewResponse>('/admin/api/market/overview');
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function onSort(column: MarketSortColumn): void {
    dir = sort === column && dir === 'desc' ? 'asc' : 'desc';
    sort = column;
    page = 1;
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

{#snippet sortHeader(column: MarketSortColumn, label: string)}
  <th>
    <button type="button" class="sort" onclick={() => onSort(column)}>
      {label}{sort === column ? (dir === 'asc' ? ' ▴' : ' ▾') : ''}
    </button>
  </th>
{/snippet}

<Panel>
  <div class="controls">
    <input
      id="market-search"
      type="search"
      placeholder={t('market.searchPlaceholder')}
      bind:value={search}
      oninput={() => {
        page = 1;
      }}
      aria-label={t('market.searchLabel')}
    />
    <select
      bind:value={kind}
      aria-label={t('market.kindLabel')}
      onchange={() => {
        page = 1;
      }}
    >
      <option value="all">{t('market.kindAll')}</option>
      {#each view.kinds as option}
        <option value={option}>{option}</option>
      {/each}
    </select>
    <label class="listed-only">
      <input
        type="checkbox"
        bind:checked={listedOnly}
        onchange={() => {
          page = 1;
        }}
      />
      {t('market.listedOnly')}
    </label>
    <span class="text-dim">
      {t('market.count', { count: fmtNumber(view.total) })}
    </span>
    {#if data?.capturedAt}
      <span class="text-dim">
        {t('market.capturedAt', { when: fmtRelative(data.capturedAt) })}
      </span>
    {/if}
    {#if data}
      <span class="text-dim">{t('market.cutNote', { pct: data.cutPct })}</span>
    {/if}
    <button type="button" onclick={() => void refresh()}>{t('market.refresh')}</button>
    <div class="pager">
      <Pager
        total={view.total}
        page={view.page}
        limit={view.limit}
        onPage={(nextPage) => {
          page = nextPage;
        }}
      />
    </div>
  </div>
  {#if failed}
    <div class="empty">{t('market.loadFailed')}</div>
  {:else if data === null}
    <div class="empty">{t('market.loading')}</div>
  {:else if view.total === 0}
    <div class="empty">{t('market.empty')}</div>
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            {@render sortHeader('name', t('market.colItem'))}
            <th>{t('market.colKind')}</th>
            {@render sortHeader('ask', t('market.colLowestAsk'))}
            {@render sortHeader('listings', t('market.colListings'))}
            {@render sortHeader('quantity', t('market.colListedQty'))}
            {@render sortHeader('median7d', t('market.colMedian7d'))}
            {@render sortHeader('sales7d', t('market.colSales7d'))}
            <th>{t('market.colHouseAsk')}</th>
          </tr>
        </thead>
        <tbody>
          {#each view.rows as row (row.itemId)}
            <tr>
              <td>
                <MarketItemLink itemId={row.itemId} name={row.name} />
                <span class="quality q-{row.quality}">{row.quality}</span>
              </td>
              <td>{row.kind}</td>
              <td>
                {row.lowestAskUnitCopper === null
                  ? t('common.emptyValue')
                  : fmtCopper(row.lowestAskUnitCopper)}
              </td>
              <td>{fmtNumber(row.listingCount)}</td>
              <td>{fmtNumber(row.listedQuantity)}</td>
              <td>
                {row.sales7d === null
                  ? t('common.emptyValue')
                  : fmtCopper(row.sales7d.medianUnitPriceCopper)}
              </td>
              <td>{row.sales7d === null ? t('common.emptyValue') : fmtNumber(row.sales7d.sales)}</td>
              <td>
                {row.houseUnitAskCopper === null
                  ? t('common.emptyValue')
                  : fmtCopper(row.houseUnitAskCopper)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Panel>

<style>
  .sort {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .listed-only {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .quality {
    margin-left: 8px;
    font-size: 0.85em;
    color: var(--text-soft);
  }
</style>
