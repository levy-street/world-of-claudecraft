<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import Badge from '../components/Badge.svelte';
  import HkFieldRows from '../components/HkFieldRows.svelte';
  import HkStatusBanner from '../components/HkStatusBanner.svelte';
  import Panel from '../components/Panel.svelte';
  import {
    type FieldInput,
    type FlagChoice,
    flagFormState,
    matchesSearch,
    numericFormState,
    parseFlagPatch,
    parseJsonArray,
    parseNumericPatch,
    patchOrNull,
  } from '../housekeeping';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkMobRow, HkMobsCatalog, HkSaveResponse } from '../types';

  // Mob templates: every stat/flag/loot table in the game, with the shipped
  // default, the live value, and an editable override per mob.
  let data = $state<HkMobsCatalog | null>(null);
  let failed = $state(false);
  let search = $state('');
  let selectedId = $state<string | null>(null);
  let values = $state<Record<string, FieldInput>>({});
  let flags = $state<Record<string, FlagChoice>>({});
  let lootChecked = $state(false);
  let lootText = $state('');
  let lootError = $state(false);
  let invalid = $state<string[]>([]);
  let saving = $state(false);

  const rows = $derived(
    (data?.rows ?? []).filter((row) => matchesSearch(search, row.id, row.name, row.family)),
  );
  const selected = $derived(data?.rows.find((row) => row.id === selectedId) ?? null);

  function select(row: HkMobRow): void {
    if (!data) return;
    selectedId = row.id;
    values = numericFormState(data.fields, row.override);
    flags = flagFormState(data.flagFields, row.override);
    const overrideLoot = row.override?.loot;
    lootChecked = Array.isArray(overrideLoot);
    const source = Array.isArray(overrideLoot) ? overrideLoot : row.lootDefault;
    lootText = JSON.stringify(
      (source as HkMobRow['lootDefault']).map(({ itemName, ...entry }) => entry),
      null,
      1,
    );
    lootError = false;
    invalid = [];
  }

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkMobsCatalog>('/admin/api/housekeeping/mobs');
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
    const patch: Record<string, unknown> = { ...numeric.patch, ...parseFlagPatch(flags) };
    if (lootChecked) {
      const loot = parseJsonArray(lootText);
      lootError = loot.error || loot.value === null;
      if (lootError) return;
      patch.loot = loot.value;
    } else {
      lootError = false;
    }
    if (numeric.invalid.length > 0) return;
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides', {
        domain: 'mobs',
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
        domain: 'mobs',
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
  <Panel title={t('nav.hkMobs')}><div class="empty">{t('housekeeping.loadFailed')}</div></Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  {#if selected}
    {#key selected.id}
      <Panel title={t('hkMobs.editorTitle', { name: selected.name, id: selected.id })}>
        <HkFieldRows
          fields={data.fields}
          defaults={selected.defaults}
          live={selected.live}
          bind:values
          {invalid}
        />
        <div class="hk-flags">
          {#each data.flagFields as flag (flag)}
            <label>
              <span>{t(`housekeeping.field.${flag}`)}</span>
              <select bind:value={flags[flag]}>
                <option value="">
                  {t('housekeeping.flagDefault', {
                    value: selected.defaultFlags[flag]
                      ? t('housekeeping.flagOn')
                      : t('housekeeping.flagOff'),
                  })}
                </option>
                <option value="on">{t('housekeeping.flagOn')}</option>
                <option value="off">{t('housekeeping.flagOff')}</option>
              </select>
            </label>
          {/each}
        </div>
        <label class="hk-loot-toggle">
          <input type="checkbox" bind:checked={lootChecked} />
          {t('hkMobs.overrideLoot')}
        </label>
        {#if lootChecked}
          <p class="hint">{t('hkMobs.lootHint')}</p>
          <textarea rows="8" bind:value={lootText} class:hk-textarea-error={lootError}></textarea>
          {#if lootError}<p class="hk-error">{t('hkMobs.lootInvalid')}</p>{/if}
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

  <Panel title={t('hkMobs.listTitle')} hint={t('hkMobs.listHint')}>
    <div class="controls">
      <input type="text" placeholder={t('housekeeping.searchPlaceholder')} bind:value={search} />
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('hkMobs.colName')}</th>
            <th>{t('hkMobs.colFamily')}</th>
            <th class="num">{t('hkMobs.colLevel')}</th>
            <th class="num">{t('hkMobs.colHp')}</th>
            <th class="num">{t('hkMobs.colDmg')}</th>
            <th>{t('hkMobs.colSpawns')}</th>
            <th>{t('housekeeping.colOverridden')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr class="clickable" onclick={() => select(row)}>
              <td>
                {row.name}
                <span class="hk-id">{row.id}</span>
                {#if row.liveFlags.boss}<Badge variant="bad">{t('hkMobs.boss')}</Badge>{/if}
                {#if row.liveFlags.elite}<Badge variant="warn">{t('hkMobs.elite')}</Badge>{/if}
                {#if row.liveFlags.rare}<Badge variant="admin">{t('hkMobs.rare')}</Badge>{/if}
              </td>
              <td>{row.family}</td>
              <td class="num">{row.live.minLevel}..{row.live.maxLevel}</td>
              <td class="num">{row.live.hpBase}</td>
              <td class="num">{row.live.dmgBase}</td>
              <td>
                {#if row.spawns.campCount > 0}
                  {t('hkMobs.spawnSummary', {
                    total: String(row.spawns.totalSpawns),
                    camps: String(row.spawns.campCount),
                    zones: row.spawns.zones.join(', '),
                  })}
                {:else if row.spawns.dungeons.length > 0}
                  {row.spawns.dungeons.join(', ')}
                {:else}
                  {t('common.emptyValue')}
                {/if}
              </td>
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
  .hk-flags {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px 16px;
    margin: 10px 0;
  }
  .hk-flags label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--font-size-small);
    color: var(--text-bright);
  }
  .hk-loot-toggle {
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
  .hk-textarea-error {
    border-color: var(--color-danger-border);
  }
  .hk-error {
    color: var(--color-danger);
    font-size: var(--font-size-small);
  }
</style>
