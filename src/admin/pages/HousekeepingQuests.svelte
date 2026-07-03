<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import Badge from '../components/Badge.svelte';
  import HkFieldRows from '../components/HkFieldRows.svelte';
  import HkStatusBanner from '../components/HkStatusBanner.svelte';
  import Panel from '../components/Panel.svelte';
  import {
    type FieldInput,
    fieldFilled,
    fieldNumber,
    type FlagChoice,
    matchesSearch,
    numericFormState,
    parseNumericPatch,
    patchOrNull,
  } from '../housekeeping';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkQuestRow, HkQuestsCatalog, HkSaveResponse } from '../types';

  // Quests: rewards, level gates, objective counts, and retirement, with the
  // giver/turn-in context so an operator can see what each quest does.
  let data = $state<HkQuestsCatalog | null>(null);
  let failed = $state(false);
  let search = $state('');
  let selectedId = $state<string | null>(null);
  let values = $state<Record<string, FieldInput>>({});
  let retired = $state<FlagChoice>('');
  let objectiveCounts = $state<FieldInput[]>([]);
  let invalid = $state<string[]>([]);
  let objectivesError = $state(false);
  let saving = $state(false);

  const rows = $derived(
    (data?.rows ?? []).filter((row) =>
      matchesSearch(search, row.id, row.name, row.zone, row.giverNpc),
    ),
  );
  const selected = $derived(data?.rows.find((row) => row.id === selectedId) ?? null);

  function select(row: HkQuestRow): void {
    if (!data) return;
    selectedId = row.id;
    values = numericFormState(data.fields, row.override);
    const overrideRetired = row.override?.retired;
    retired = typeof overrideRetired === 'boolean' ? (overrideRetired ? 'on' : 'off') : '';
    const overrideCounts = row.override?.objectiveCounts;
    objectiveCounts = row.objectives.map((objective, i) =>
      Array.isArray(overrideCounts) && typeof overrideCounts[i] === 'number'
        ? String(overrideCounts[i])
        : '',
    );
    invalid = [];
    objectivesError = false;
  }

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkQuestsCatalog>('/admin/api/housekeeping/quests');
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
    if (retired !== '') patch.retired = retired === 'on';
    objectivesError = false;
    const anyCount = objectiveCounts.some((value) => fieldFilled(value));
    if (anyCount) {
      // The server expects the FULL per-objective list; blanks fall back to the
      // shipped default count for that objective.
      const counts = selected.objectives.map((objective, i) => {
        if (!fieldFilled(objectiveCounts[i])) return objective.countDefault;
        const value = fieldNumber(objectiveCounts[i]);
        return Number.isInteger(value) && value >= 1 ? value : Number.NaN;
      });
      if (counts.some((value) => Number.isNaN(value))) {
        objectivesError = true;
        return;
      }
      patch.objectiveCounts = counts;
    }
    if (numeric.invalid.length > 0) return;
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides', {
        domain: 'quests',
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
        domain: 'quests',
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
  <Panel title={t('nav.hkQuests')}><div class="empty">{t('housekeeping.loadFailed')}</div></Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  {#if selected}
    {#key selected.id}
      <Panel title={t('hkQuests.editorTitle', { name: selected.name, id: selected.id })}>
        <div class="detail-grid">
          <div><strong>{t('hkQuests.giver')}</strong> {selected.giverNpc ?? t('common.emptyValue')}</div>
          <div><strong>{t('hkQuests.turnIn')}</strong> {selected.turnInNpc ?? t('common.emptyValue')}</div>
          <div><strong>{t('hkQuests.zone')}</strong> {selected.zone ?? t('common.emptyValue')}</div>
          <div>
            <strong>{t('hkQuests.requires')}</strong>
            {selected.requiresQuest ?? t('common.emptyValue')}
          </div>
        </div>
        <HkFieldRows
          fields={data.fields}
          defaults={selected.defaults}
          live={selected.live}
          bind:values
          {invalid}
        />
        <label class="hk-retired">
          <span>{t('hkQuests.retired')}</span>
          <select bind:value={retired}>
            <option value="">
              {t('housekeeping.flagDefault', {
                value: selected.retiredDefault ? t('housekeeping.flagOn') : t('housekeeping.flagOff'),
              })}
            </option>
            <option value="on">{t('housekeeping.flagOn')}</option>
            <option value="off">{t('housekeeping.flagOff')}</option>
          </select>
        </label>
        {#if selected.objectives.length > 0}
          <p class="hint">{t('hkQuests.objectivesHint')}</p>
          <div class="hk-objectives">
            {#each selected.objectives as objective, i (objective.label)}
              <label>
                <span>{objective.label} ({objective.type}{objective.target ? `: ${objective.target}` : ''})</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder={String(objective.countDefault)}
                  bind:value={objectiveCounts[i]}
                />
              </label>
            {/each}
          </div>
          {#if objectivesError}<p class="hk-error">{t('housekeeping.invalidFields')}</p>{/if}
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

  <Panel title={t('hkQuests.listTitle')} hint={t('hkQuests.listHint')}>
    <div class="controls">
      <input type="text" placeholder={t('housekeeping.searchPlaceholder')} bind:value={search} />
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('hkQuests.colName')}</th>
            <th>{t('hkQuests.zone')}</th>
            <th>{t('hkQuests.giver')}</th>
            <th class="num">{t('housekeeping.field.xpReward')}</th>
            <th class="num">{t('housekeeping.field.copperReward')}</th>
            <th class="num">{t('hkQuests.colObjectives')}</th>
            <th>{t('housekeeping.colOverridden')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr class="clickable" onclick={() => select(row)}>
              <td>
                {row.name}
                <span class="hk-id">{row.id}</span>
                {#if row.retiredLive}<Badge variant="neutral">{t('hkQuests.retired')}</Badge>{/if}
              </td>
              <td>{row.zone ?? t('common.emptyValue')}</td>
              <td>{row.giverNpc ?? t('common.emptyValue')}</td>
              <td class="num">{row.live.xpReward}</td>
              <td class="num">{row.live.copperReward}</td>
              <td class="num">{row.objectives.length}</td>
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
  .hk-retired {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 260px;
    margin: 10px 0;
    font-size: var(--font-size-small);
    color: var(--text-bright);
  }
  .hk-objectives {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px 16px;
    margin: 6px 0 10px;
  }
  .hk-objectives label {
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
