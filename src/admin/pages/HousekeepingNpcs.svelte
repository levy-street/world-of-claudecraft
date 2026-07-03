<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import Badge from '../components/Badge.svelte';
  import HkStatusBanner from '../components/HkStatusBanner.svelte';
  import Panel from '../components/Panel.svelte';
  import { type FieldInput, fieldFilled, fieldNumber, matchesSearch, parseIdList } from '../housekeeping';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkNpcRow, HkNpcsCatalog, HkSaveResponse } from '../types';

  // NPCs: who stands where, which quests they carry, and their vendor stock.
  let data = $state<HkNpcsCatalog | null>(null);
  let failed = $state(false);
  let search = $state('');
  let selectedId = $state<string | null>(null);
  let posX = $state<FieldInput>('');
  let posZ = $state<FieldInput>('');
  let vendorChecked = $state(false);
  let vendorText = $state('');
  let formError = $state(false);
  let saving = $state(false);

  const rows = $derived(
    (data?.rows ?? []).filter((row) => matchesSearch(search, row.id, row.name, row.zone)),
  );
  const selected = $derived(data?.rows.find((row) => row.id === selectedId) ?? null);

  function select(row: HkNpcRow): void {
    selectedId = row.id;
    const pos = (row.override?.pos ?? null) as { x: number; z: number } | null;
    posX = pos ? String(pos.x) : '';
    posZ = pos ? String(pos.z) : '';
    const overrideVendor = row.override?.vendorItems;
    vendorChecked = Array.isArray(overrideVendor);
    const stock = Array.isArray(overrideVendor)
      ? (overrideVendor as string[])
      : (row.vendorLive ?? []).map((entry) => entry.itemId);
    vendorText = stock.join(', ');
    formError = false;
  }

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkNpcsCatalog>('/admin/api/housekeeping/npcs');
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
    if (!selected) return;
    const patch: Record<string, unknown> = {};
    formError = false;
    if (fieldFilled(posX) || fieldFilled(posZ)) {
      const x = fieldNumber(posX);
      const z = fieldNumber(posZ);
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        formError = true;
        return;
      }
      patch.pos = { x, z };
    }
    if (vendorChecked) patch.vendorItems = parseIdList(vendorText);
    saving = true;
    try {
      if (Object.keys(patch).length > 0) {
        await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides', {
          domain: 'npcs',
          id: selected.id,
          patch,
        });
      } else {
        await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides/clear', {
          domain: 'npcs',
          id: selected.id,
        });
      }
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
        domain: 'npcs',
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
  <Panel title={t('nav.hkNpcs')}><div class="empty">{t('housekeeping.loadFailed')}</div></Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  {#if selected}
    {#key selected.id}
      <Panel title={t('hkNpcs.editorTitle', { name: selected.name, id: selected.id })}>
        <div class="detail-grid">
          <div><strong>{t('hkNpcs.colTitle')}</strong> {selected.title || t('common.emptyValue')}</div>
          <div><strong>{t('hkNpcs.colZone')}</strong> {selected.zone}</div>
          <div>
            <strong>{t('hkNpcs.quests')}</strong>
            {selected.questNames.length > 0 ? selected.questNames.join(', ') : t('common.emptyValue')}
          </div>
        </div>
        <div class="hk-pos-form">
          <label>
            <span>{t('hkNpcs.posX')}</span>
            <input type="number" step="any" placeholder={String(selected.posDefault.x)} bind:value={posX} />
          </label>
          <label>
            <span>{t('hkNpcs.posZ')}</span>
            <input type="number" step="any" placeholder={String(selected.posDefault.z)} bind:value={posZ} />
          </label>
        </div>
        <label class="hk-vendor-toggle">
          <input type="checkbox" bind:checked={vendorChecked} />
          {t('hkNpcs.overrideVendor')}
        </label>
        {#if vendorChecked}
          <p class="hint">{t('hkNpcs.vendorHint')}</p>
          <textarea rows="3" bind:value={vendorText}></textarea>
        {/if}
        {#if formError}<p class="hk-error">{t('housekeeping.invalidFields')}</p>{/if}
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

  <Panel title={t('hkNpcs.listTitle')} hint={t('hkNpcs.listHint')}>
    <div class="controls">
      <input type="text" placeholder={t('housekeeping.searchPlaceholder')} bind:value={search} />
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('hkNpcs.colName')}</th>
            <th>{t('hkNpcs.colZone')}</th>
            <th>{t('hkNpcs.colPos')}</th>
            <th class="num">{t('hkNpcs.colQuests')}</th>
            <th class="num">{t('hkNpcs.colVendor')}</th>
            <th>{t('housekeeping.colOverridden')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr class="clickable" onclick={() => select(row)}>
              <td>
                {row.name}
                <span class="hk-id">{row.id}</span>
                {#if row.market}<Badge variant="admin">{t('hkNpcs.market')}</Badge>{/if}
                {#if row.dynamic}<Badge variant="neutral">{t('hkNpcs.dynamic')}</Badge>{/if}
              </td>
              <td>{row.zone}</td>
              <td>{row.posLive.x}, {row.posLive.z}</td>
              <td class="num">{row.questIds.length}</td>
              <td class="num">{row.vendorLive?.length ?? 0}</td>
              <td>{#if row.override}<Badge variant="warn">{t('housekeeping.overridden')}</Badge>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Panel>
{/if}

<style>
  .hk-id {
    margin-left: 6px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }
  .hk-pos-form {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px 16px;
    max-width: 400px;
    margin: 10px 0;
  }
  .hk-pos-form label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--font-size-small);
    color: var(--text-bright);
  }
  .hk-vendor-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 4px;
    color: var(--text-bright);
  }
  textarea {
    width: 100%;
    resize: vertical;
    font-family: monospace;
    font-size: var(--font-size-small);
  }
  .hk-error {
    color: var(--color-danger);
    font-size: var(--font-size-small);
  }
</style>
