<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import Badge from '../components/Badge.svelte';
  import HkStatusBanner from '../components/HkStatusBanner.svelte';
  import Panel from '../components/Panel.svelte';
  import { type FieldInput, fieldFilled, fieldNumber, matchesSearch } from '../housekeeping';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkCampRow, HkSaveResponse, HkSpawnsCatalog } from '../types';

  // Spawn camps: every overworld camp (mob, center, radius, count), editable
  // per camp. Count 0 disables a camp on the next restart.
  let data = $state<HkSpawnsCatalog | null>(null);
  let failed = $state(false);
  let search = $state('');
  let selectedIndex = $state<number | null>(null);
  let count = $state<FieldInput>('');
  let radius = $state<FieldInput>('');
  let centerX = $state<FieldInput>('');
  let centerZ = $state<FieldInput>('');
  let formError = $state(false);
  let saving = $state(false);

  const rows = $derived(
    (data?.rows ?? []).filter((row) => matchesSearch(search, row.mobId, row.mobName, row.zone)),
  );
  const selected = $derived(data?.rows.find((row) => row.index === selectedIndex) ?? null);

  function select(row: HkCampRow): void {
    selectedIndex = row.index;
    const ov = row.override ?? {};
    count = typeof ov.count === 'number' ? String(ov.count) : '';
    radius = typeof ov.radius === 'number' ? String(ov.radius) : '';
    const center = (ov.center ?? null) as { x: number; z: number } | null;
    centerX = center ? String(center.x) : '';
    centerZ = center ? String(center.z) : '';
    formError = false;
  }

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkSpawnsCatalog>('/admin/api/housekeeping/spawns');
      failed = false;
      const row = data.rows.find((r) => r.index === selectedIndex);
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
    const patch: Record<string, unknown> = { mobId: selected.mobId };
    formError = false;
    if (fieldFilled(count)) {
      const n = fieldNumber(count);
      if (!Number.isInteger(n) || n < 0) formError = true;
      else patch.count = n;
    }
    if (fieldFilled(radius)) {
      const n = fieldNumber(radius);
      if (!Number.isFinite(n) || n < 1) formError = true;
      else patch.radius = n;
    }
    if (fieldFilled(centerX) || fieldFilled(centerZ)) {
      const x = fieldNumber(centerX);
      const z = fieldNumber(centerZ);
      if (!Number.isFinite(x) || !Number.isFinite(z)) formError = true;
      else patch.center = { x, z };
    }
    if (formError) return;
    const hasEdits = Object.keys(patch).length > 1;
    saving = true;
    try {
      if (hasEdits) {
        await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides', {
          domain: 'camps',
          id: String(selected.index),
          patch,
        });
      } else {
        await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides/clear', {
          domain: 'camps',
          id: String(selected.index),
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
        domain: 'camps',
        id: String(selected.index),
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
  <Panel title={t('nav.hkSpawns')}><div class="empty">{t('housekeeping.loadFailed')}</div></Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  {#if selected}
    {#key selected.index}
      <Panel title={t('hkSpawns.editorTitle', { name: selected.mobName, index: String(selected.index) })}>
        <div class="hk-camp-form">
          <label>
            <span>{t('housekeeping.field.count')}</span>
            <input type="number" min="0" step="1" placeholder={String(selected.defaults.count)} bind:value={count} />
          </label>
          <label>
            <span>{t('housekeeping.field.radius')}</span>
            <input type="number" min="1" step="any" placeholder={String(selected.defaults.radius)} bind:value={radius} />
          </label>
          <label>
            <span>{t('hkSpawns.centerX')}</span>
            <input type="number" step="any" placeholder={String(selected.defaults.center.x)} bind:value={centerX} />
          </label>
          <label>
            <span>{t('hkSpawns.centerZ')}</span>
            <input type="number" step="any" placeholder={String(selected.defaults.center.z)} bind:value={centerZ} />
          </label>
        </div>
        <p class="hint">{t('hkSpawns.editorHint')}</p>
        {#if formError}<p class="hk-error">{t('housekeeping.invalidFields')}</p>{/if}
        <div class="controls">
          <button onclick={save} disabled={saving}>{t('housekeeping.save')}</button>
          <button class="btn-sm" onclick={clearOverride} disabled={saving}>
            {t('housekeeping.clearOverrides')}
          </button>
          <button class="btn-sm" onclick={() => (selectedIndex = null)}>{t('housekeeping.close')}</button>
        </div>
      </Panel>
    {/key}
  {/if}

  <Panel title={t('hkSpawns.listTitle')} hint={t('hkSpawns.listHint')}>
    <div class="controls">
      <input type="text" placeholder={t('housekeeping.searchPlaceholder')} bind:value={search} />
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th class="num">{t('hkSpawns.colIndex')}</th>
            <th>{t('hkSpawns.colMob')}</th>
            <th>{t('hkSpawns.colZone')}</th>
            <th class="num">{t('housekeeping.field.count')}</th>
            <th class="num">{t('housekeeping.field.radius')}</th>
            <th>{t('hkSpawns.colCenter')}</th>
            <th>{t('housekeeping.colOverridden')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.index)}
            <tr class="clickable" onclick={() => select(row)}>
              <td class="num">{row.index}</td>
              <td>{row.mobName} <span class="hk-id">{row.mobId}</span></td>
              <td>{row.zone}</td>
              <td class="num">{row.live.count}</td>
              <td class="num">{row.live.radius}</td>
              <td>{row.live.center.x}, {row.live.center.z}</td>
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
  .hk-camp-form {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px 16px;
    margin: 10px 0;
  }
  .hk-camp-form label {
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
