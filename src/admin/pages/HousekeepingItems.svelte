<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import Badge from '../components/Badge.svelte';
  import HkFieldRows from '../components/HkFieldRows.svelte';
  import HkStatusBanner from '../components/HkStatusBanner.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';
  import {
    type FieldInput,
    fieldFilled,
    fieldNumber,
    matchesSearch,
    numericFormState,
    parseNumericPatch,
    patchOrNull,
  } from '../housekeeping';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkItemRow, HkItemsCatalog, HkSaveResponse } from '../types';

  const PAGE_SIZE = 50;
  const STAT_KEYS = ['str', 'agi', 'sta', 'int', 'spi', 'armor'];

  // Items: vendor prices, level requirements, and stat blocks for every item.
  let data = $state<HkItemsCatalog | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let selectedId = $state<string | null>(null);
  let values = $state<Record<string, FieldInput>>({});
  let statValues = $state<Record<string, FieldInput>>({});
  let statsChecked = $state(false);
  let invalid = $state<string[]>([]);
  let statsError = $state(false);
  let saving = $state(false);

  const filtered = $derived(
    (data?.rows ?? []).filter((row) => matchesSearch(search, row.id, row.name, row.kind)),
  );
  const pageRows = $derived(filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
  const selected = $derived(data?.rows.find((row) => row.id === selectedId) ?? null);

  function select(row: HkItemRow): void {
    if (!data) return;
    selectedId = row.id;
    values = numericFormState(data.fields, row.override);
    const overrideStats = (row.override?.stats ?? null) as Record<string, number> | null;
    statsChecked = overrideStats !== null;
    const source = overrideStats ?? row.statsDefault ?? {};
    statValues = Object.fromEntries(
      STAT_KEYS.map((key) => [key, typeof source[key] === 'number' ? String(source[key]) : '']),
    );
    invalid = [];
    statsError = false;
  }

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkItemsCatalog>('/admin/api/housekeeping/items');
      failed = false;
      const row = data.rows.find((r) => r.id === selectedId);
      if (row) select(row);
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

  async function save(): Promise<void> {
    if (!data || !selected) return;
    const numeric = parseNumericPatch(data.fields, values);
    invalid = numeric.invalid;
    const patch: Record<string, unknown> = { ...numeric.patch };
    statsError = false;
    if (statsChecked) {
      const stats: Record<string, number> = {};
      for (const key of STAT_KEYS) {
        if (!fieldFilled(statValues[key])) continue;
        const value = fieldNumber(statValues[key]);
        if (!Number.isInteger(value)) {
          statsError = true;
          return;
        }
        stats[key] = value;
      }
      patch.stats = stats;
    }
    if (numeric.invalid.length > 0) return;
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides', {
        domain: 'items',
        id: selected.id,
        patch: patchOrNull(patch),
      });
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      saving = false;
    }
  }

  async function clearOverride(): Promise<void> {
    if (!selected) return;
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides/clear', {
        domain: 'items',
        id: selected.id,
      });
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
  <Panel title={t('nav.hkItems')}><div class="empty">{t('housekeeping.loadFailed')}</div></Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  {#if selected}
    {#key selected.id}
      <Panel title={t('hkItems.editorTitle', { name: selected.name, id: selected.id })}>
        <div class="detail-grid">
          <div><strong>{t('hkItems.colKind')}</strong> {selected.kind}</div>
          <div><strong>{t('hkItems.colSlot')}</strong> {selected.slot ?? t('common.emptyValue')}</div>
          <div>
            <strong>{t('hkItems.colQuality')}</strong>
            {selected.quality ?? t('common.emptyValue')}
          </div>
        </div>
        <HkFieldRows
          fields={data.fields}
          defaults={selected.defaults}
          live={selected.live}
          bind:values
          {invalid}
        />
        <label class="hk-stats-toggle">
          <input type="checkbox" bind:checked={statsChecked} />
          {t('hkItems.overrideStats')}
        </label>
        {#if statsChecked}
          <div class="hk-stats">
            {#each STAT_KEYS as key (key)}
              <label>
                <span>{t(`housekeeping.stat.${key}`)}</span>
                <input
                  type="number"
                  step="1"
                  placeholder={String(selected.statsDefault?.[key] ?? 0)}
                  bind:value={statValues[key]}
                />
              </label>
            {/each}
          </div>
          {#if statsError}<p class="hk-error">{t('housekeeping.invalidFields')}</p>{/if}
        {/if}
        {#if invalid.length > 0}<p class="hk-error">{t('housekeeping.invalidFields')}</p>{/if}
        <div class="controls">
          <button onclick={save} disabled={saving}>{t('housekeeping.save')}</button>
          <button class="btn-sm" onclick={clearOverride} disabled={saving}>
            {t('housekeeping.clearOverrides')}
          </button>
          <button class="btn-sm" onclick={() => (selectedId = null)}>{t('housekeeping.close')}</button>
        </div>
      </Panel>
    {/key}
  {/if}

  <Panel title={t('hkItems.listTitle')} hint={t('hkItems.listHint')}>
    <div class="controls">
      <input
        type="text"
        placeholder={t('housekeeping.searchPlaceholder')}
        bind:value={search}
        oninput={() => (page = 1)}
      />
      <Pager total={filtered.length} {page} limit={PAGE_SIZE} layout="inline" onPage={(p) => (page = p)} />
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('hkItems.colName')}</th>
            <th>{t('hkItems.colKind')}</th>
            <th>{t('hkItems.colSlot')}</th>
            <th>{t('hkItems.colQuality')}</th>
            <th class="num">{t('housekeeping.field.sellValue')}</th>
            <th class="num">{t('housekeeping.field.buyValue')}</th>
            <th>{t('housekeeping.colOverridden')}</th>
          </tr>
        </thead>
        <tbody>
          {#each pageRows as row (row.id)}
            <tr class="clickable" onclick={() => select(row)}>
              <td>{row.name} <span class="hk-id">{row.id}</span></td>
              <td>{row.kind}</td>
              <td>{row.slot ?? t('common.emptyValue')}</td>
              <td>{row.quality ?? t('common.emptyValue')}</td>
              <td class="num">{row.live.sellValue}</td>
              <td class="num">{row.live.buyValue ?? t('common.emptyValue')}</td>
              <td>{#if row.override}<Badge variant="warn">{t('housekeeping.overridden')}</Badge>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager total={filtered.length} {page} limit={PAGE_SIZE} layout="footer" onPage={(p) => (page = p)} />
  </Panel>
{/if}

<style>
  .hk-id {
    margin-left: 6px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }
  .hk-stats-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 4px;
    color: var(--text-bright);
  }
  .hk-stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px 16px;
    margin: 6px 0 10px;
  }
  .hk-stats label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--font-size-small);
    color: var(--text-bright);
  }
  .hk-error {
    color: var(--color-danger);
    font-size: var(--font-size-small);
  }
</style>
