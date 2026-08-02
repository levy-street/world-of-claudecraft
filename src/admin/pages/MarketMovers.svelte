<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import MarketItemLink from '../components/MarketItemLink.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtCopper, fmtNumber, fmtPercent } from '../format';
  import { t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { MarketMoverRow, MarketMoversResponse } from '../types';

  // Top movers: the current window's median sale price against the window
  // before it (24h vs the previous 24h, or 7d vs the previous 7d).
  let data = $state<MarketMoversResponse | null>(null);
  let failed = $state(false);
  let windowHours = $state(24);
  let minSales = $state(3);
  let requestId = 0;

  const fmtSigned = (copper: number) => `${copper < 0 ? '-' : ''}${fmtCopper(Math.abs(copper))}`;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<MarketMoversResponse>(
        `/admin/api/market/movers?windowHours=${windowHours}&minSales=${encodeURIComponent(minSales)}`,
      );
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function setWindow(hours: number): void {
    windowHours = hours;
    void refresh();
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

{#snippet moversTable(rows: MarketMoverRow[], emptyKey: string)}
  {#if rows.length === 0}
    <div class="empty">{t(emptyKey)}</div>
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('market.colItem')}</th>
            <th>{t('market.colMedianNow')}</th>
            <th>{t('market.colMedianBefore')}</th>
            <th>{t('market.colChange')}</th>
            <th>{t('market.colSalesWindows')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.itemId)}
            <tr>
              <td><MarketItemLink itemId={row.itemId} name={row.name} /></td>
              <td>{fmtCopper(row.currentMedianUnitCopper)}</td>
              <td>{fmtCopper(row.previousMedianUnitCopper)}</td>
              <td class={row.changePct >= 0 ? 'gain' : 'loss'}>
                {fmtSigned(row.changeUnitCopper)} ({fmtPercent(row.changePct)})
              </td>
              <td>
                {t('market.salesWindows', {
                  current: fmtNumber(row.salesCurrent),
                  previous: fmtNumber(row.salesPrevious),
                })}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/snippet}

<Panel>
  <div class="controls">
    <div class="window-toggle" role="group" aria-label={t('market.windowLabel')}>
      <button
        type="button"
        class:active={windowHours === 24}
        onclick={() => setWindow(24)}
      >
        {t('market.window24h')}
      </button>
      <button
        type="button"
        class:active={windowHours === 168}
        onclick={() => setWindow(168)}
      >
        {t('market.window7d')}
      </button>
    </div>
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
    <button type="button" onclick={() => void refresh()}>{t('market.refresh')}</button>
  </div>
  {#if failed}
    <div class="empty">{t('market.loadFailed')}</div>
  {:else if data === null}
    <div class="empty">{t('market.loading')}</div>
  {:else}
    <h3>{t('market.risers')}</h3>
    {@render moversTable(data.risers, 'market.risersEmpty')}
    <h3>{t('market.fallers')}</h3>
    {@render moversTable(data.fallers, 'market.fallersEmpty')}
  {/if}
</Panel>

<style>
  .window-toggle {
    display: inline-flex;
    gap: 4px;
  }

  .window-toggle .active {
    outline: 2px solid var(--gold);
  }

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
