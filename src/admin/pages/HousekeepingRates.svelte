<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import HkFieldRows from '../components/HkFieldRows.svelte';
  import HkStatusBanner from '../components/HkStatusBanner.svelte';
  import Panel from '../components/Panel.svelte';
  import {
    type FieldInput,
    numericFormState,
    parseNumericPatch,
    parseXpTable,
    patchOrNull,
  } from '../housekeeping';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkNumericValues, HkRates, HkRatesCatalog, HkSaveResponse } from '../types';

  // Global rates: multipliers over XP/loot/gold/mob stats, the respawn base,
  // the world seed, and the XP curve. Saved values apply on the next restart.
  let data = $state<HkRatesCatalog | null>(null);
  let failed = $state(false);
  let values = $state<Record<string, FieldInput>>({});
  let invalid = $state<string[]>([]);
  let xpTableText = $state('');
  let xpTableError = $state(false);
  let saving = $state(false);

  // HkRates is a concrete interface; the field-rows component takes a keyed
  // record (and no nulls: the unset worldSeed renders as "no default").
  const toValues = (rates: HkRates): HkNumericValues => ({
    ...rates,
    worldSeed: rates.worldSeed ?? undefined,
  });

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkRatesCatalog>('/admin/api/housekeeping/rates');
      values = numericFormState(data.fields, data.saved);
      xpTableText = data.xpTableSaved ? data.xpTableSaved.join(', ') : '';
      invalid = [];
      xpTableError = false;
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function fail(err: unknown): void {
    if (!auth.handleAuthFailure(err)) {
      window.alert(
        err instanceof Error ? localizeAdminError(err.message) : t('alert.saveConfigFailed'),
      );
    }
  }

  async function saveRates(): Promise<void> {
    if (!data) return;
    const parsed = parseNumericPatch(data.fields, values);
    invalid = parsed.invalid;
    if (parsed.invalid.length > 0) return;
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides', {
        domain: 'rates',
        patch: patchOrNull(parsed.patch),
      });
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      saving = false;
    }
  }

  async function saveXpTable(): Promise<void> {
    if (!data) return;
    const parsed = parseXpTable(xpTableText, data.xpTableDefault.length);
    if (parsed.error === 'empty') {
      await clearDomain('xpTable');
      return;
    }
    xpTableError = parsed.error !== null;
    if (parsed.error !== null) return;
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides', {
        domain: 'xpTable',
        patch: parsed.table,
      });
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      saving = false;
    }
  }

  async function clearDomain(domain: 'rates' | 'xpTable'): Promise<void> {
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides/clear', { domain });
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    void refresh();
  });
</script>

{#if failed}
  <Panel title={t('nav.hkRates')}><div class="empty">{t('housekeeping.loadFailed')}</div></Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  <Panel title={t('hkRates.title')} hint={t('hkRates.hint')}>
    <HkFieldRows
      fields={data.fields}
      defaults={toValues(data.defaults)}
      live={toValues(data.applied)}
      bind:values
      {invalid}
    />
    {#if invalid.length > 0}<p class="hk-error">{t('housekeeping.invalidFields')}</p>{/if}
    <div class="controls">
      <button onclick={saveRates} disabled={saving}>{t('housekeeping.save')}</button>
      <button class="btn-sm" onclick={() => clearDomain('rates')} disabled={saving}>
        {t('housekeeping.clearOverrides')}
      </button>
    </div>
  </Panel>

  <Panel title={t('hkRates.xpTableTitle')} hint={t('hkRates.xpTableHint')}>
    <p class="hint">
      {t('hkRates.xpTableDefault', { value: data.xpTableDefault.join(', ') })}
    </p>
    <textarea
      rows="3"
      placeholder={data.xpTableDefault.join(', ')}
      bind:value={xpTableText}
      class:hk-textarea-error={xpTableError}
    ></textarea>
    {#if xpTableError}<p class="hk-error">{t('hkRates.xpTableInvalid')}</p>{/if}
    <div class="controls">
      <button onclick={saveXpTable} disabled={saving}>{t('housekeeping.save')}</button>
      <button class="btn-sm" onclick={() => clearDomain('xpTable')} disabled={saving}>
        {t('housekeeping.clearOverrides')}
      </button>
    </div>
  </Panel>
{/if}

<style>
  textarea {
    width: 100%;
    resize: vertical;
  }
  .hk-textarea-error {
    border-color: var(--color-danger-border);
  }
  .hk-error {
    color: var(--color-danger);
    font-size: var(--font-size-small);
  }
</style>
