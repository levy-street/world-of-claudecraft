<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import MarketItemLink from '../components/MarketItemLink.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtCopper, fmtRelative } from '../format';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { MarketAlertsResponse, MarketCatalogResponse } from '../types';

  // Price alerts: standing lowest-ask watches the snapshot tick evaluates
  // every 5 minutes server-side. An alert stays until deleted; Last fired
  // shows the most recent capture whose cheapest ask met the condition.
  let data = $state<MarketAlertsResponse | null>(null);
  let failed = $state(false);
  let saving = $state(false);
  let formError = $state<string | null>(null);
  let itemId = $state('');
  let direction = $state<'below' | 'above'>('below');
  let thresholdCopper = $state(10000);
  // Item ids for the create form's datalist, from the overview catalog.
  let knownItems = $state<{ itemId: string; name: string }[]>([]);
  let requestId = 0;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<MarketAlertsResponse>('/admin/api/market/alerts');
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function loadCatalog(): Promise<void> {
    try {
      const result = await apiGet<MarketCatalogResponse>('/admin/api/market/catalog');
      knownItems = result.items;
    } catch {
      // The datalist is a convenience; the form still accepts a typed id.
    }
  }

  async function createAlert(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    saving = true;
    formError = null;
    try {
      await apiPost('/admin/api/market/alerts', {
        item: itemId.trim(),
        direction,
        thresholdCopper,
      });
      itemId = '';
      await refresh();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        formError =
          err instanceof Error ? localizeAdminError(err.message) : t('market.alertCreateFailed');
      }
    } finally {
      saving = false;
    }
  }

  async function removeAlert(id: number): Promise<void> {
    try {
      await apiPost('/admin/api/market/alerts/delete', { id });
      await refresh();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => {
    void refresh();
    void loadCatalog();
    return () => {
      requestId += 1;
    };
  });
</script>

<Panel>
  <h3>{t('market.alertCreateTitle')}</h3>
  <form class="controls" onsubmit={createAlert}>
    <input
      id="alert-item"
      type="text"
      list="alert-item-options"
      placeholder={t('market.alertItemPlaceholder')}
      bind:value={itemId}
      required
      aria-label={t('market.alertItemLabel')}
    />
    <datalist id="alert-item-options">
      {#each knownItems as option (option.itemId)}
        <option value={option.itemId}>{option.name}</option>
      {/each}
    </datalist>
    <select bind:value={direction} aria-label={t('market.alertDirectionLabel')}>
      <option value="below">{t('market.alertBelow')}</option>
      <option value="above">{t('market.alertAbove')}</option>
    </select>
    <label class="threshold">
      {t('market.alertThreshold')}
      <input type="number" min="1" max="5000000" bind:value={thresholdCopper} required />
    </label>
    <span class="text-dim">{fmtCopper(thresholdCopper || 0)}</span>
    <button type="submit" disabled={saving}>{t('market.alertCreate')}</button>
    {#if formError}
      <span class="form-error">{formError}</span>
    {/if}
  </form>
  <p class="text-dim">{t('market.alertHint')}</p>
</Panel>

<Panel>
  {#if failed}
    <div class="empty">{t('market.loadFailed')}</div>
  {:else if data === null}
    <div class="empty">{t('market.loading')}</div>
  {:else if data.rows.length === 0}
    <div class="empty">{t('market.alertsEmpty')}</div>
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('market.colItem')}</th>
            <th>{t('market.colCondition')}</th>
            <th>{t('market.colLastFired')}</th>
            <th>{t('market.colLastValue')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.id)}
            <tr>
              <td><MarketItemLink itemId={row.itemId} name={row.name} /></td>
              <td>
                {row.direction === 'below'
                  ? t('market.conditionBelow', { price: fmtCopper(row.thresholdCopper) })
                  : t('market.conditionAbove', { price: fmtCopper(row.thresholdCopper) })}
              </td>
              <td>{row.lastTriggeredAt ? fmtRelative(row.lastTriggeredAt) : t('common.never')}</td>
              <td>
                {row.lastValueCopper === null
                  ? t('common.emptyValue')
                  : fmtCopper(row.lastValueCopper)}
              </td>
              <td>
                <button type="button" onclick={() => void removeAlert(row.id)}>
                  {t('market.alertDelete')}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Panel>

<style>
  .threshold {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .threshold input {
    width: 110px;
  }

  .form-error {
    color: var(--negative, #e57373);
  }
</style>
