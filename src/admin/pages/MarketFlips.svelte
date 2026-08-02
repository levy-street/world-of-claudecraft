<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import MarketItemLink from '../components/MarketItemLink.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtCopper, fmtNumber, fmtPercent, fmtRelative } from '../format';
  import { t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { MarketFlipsResponse } from '../types';

  // The flip finder: buy the cheapest listed stack now, resell at the 7d
  // median net of the Merchant's cut. Server-ranked by whole-stack margin;
  // minSales keeps thin markets off the board.
  let data = $state<MarketFlipsResponse | null>(null);
  let failed = $state(false);
  let minSales = $state(3);
  let requestId = 0;

  // fmtCopper clamps negatives to zero, so a losing flip signs explicitly.
  const fmtSigned = (copper: number) => `${copper < 0 ? '-' : ''}${fmtCopper(Math.abs(copper))}`;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<MarketFlipsResponse>(
        `/admin/api/market/flips?minSales=${encodeURIComponent(minSales)}`,
      );
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<Panel>
  <div class="controls">
    <label class="min-sales">
      {t('market.minSales')}
      <input
        type="number"
        min="1"
        max="100"
        bind:value={minSales}
        onchange={() => void refresh()}
      />
    </label>
    {#if data?.capturedAt}
      <span class="text-dim">{t('market.capturedAt', { when: fmtRelative(data.capturedAt) })}</span>
    {/if}
    {#if data}
      <span class="text-dim">{t('market.cutNote', { pct: data.cutPct })}</span>
    {/if}
    <button type="button" onclick={() => void refresh()}>{t('market.refresh')}</button>
  </div>
  {#if failed}
    <div class="empty">{t('market.loadFailed')}</div>
  {:else if data === null}
    <div class="empty">{t('market.loading')}</div>
  {:else if data.rows.length === 0}
    <div class="empty">{t('market.flipsEmpty')}</div>
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('market.colItem')}</th>
            <th>{t('market.colBuyStack')}</th>
            <th>{t('market.colBuyUnit')}</th>
            <th>{t('market.colTypicalUnit')}</th>
            <th>{t('market.colNetUnit')}</th>
            <th>{t('market.colMarginUnit')}</th>
            <th>{t('market.colMarginStack')}</th>
            <th>{t('market.colRoi')}</th>
            <th>{t('market.colSales7d')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.itemId)}
            <tr>
              <td><MarketItemLink itemId={row.itemId} name={row.name} /></td>
              <td>
                {t('market.stackAt', {
                  count: fmtNumber(row.buyQuantity),
                  price: fmtCopper(row.buyTotalCopper),
                })}
              </td>
              <td>{fmtCopper(row.buyUnitCopper)}</td>
              <td>{fmtCopper(row.typicalUnitCopper)}</td>
              <td>{fmtCopper(row.netUnitCopper)}</td>
              <td class={row.marginUnitCopper >= 0 ? 'gain' : 'loss'}>
                {fmtSigned(row.marginUnitCopper)}
              </td>
              <td class={row.marginTotalCopper >= 0 ? 'gain' : 'loss'}>
                {fmtSigned(row.marginTotalCopper)}
              </td>
              <td class={row.roi >= 0 ? 'gain' : 'loss'}>{fmtPercent(row.roi)}</td>
              <td>{fmtNumber(row.sales7d)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Panel>

<style>
  .min-sales {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .min-sales input {
    width: 70px;
  }

  .gain {
    color: var(--positive, #4caf50);
  }

  .loss {
    color: var(--negative, #e57373);
  }
</style>
