<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    antibotDefaultText,
    antibotFieldDirty,
    antibotFieldModified,
    antibotFormState,
    buildAntibotOverrides,
    groupAntibotFields,
    toggleAntibotOption,
    type AntibotFormValue,
  } from '../antibot_config';
  import { antibotHistoryFormState } from '../antibot_config_history';
  import { apiGet, apiPost } from '../api';
  import AntibotConfigHistory from '../components/AntibotConfigHistory.svelte';
  import CollapsiblePanel from '../components/CollapsiblePanel.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import { fmtDate } from '../format';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type {
    AntibotConfigCatalog,
    AntibotConfigField,
    AntibotConfigHistory as AntibotConfigHistoryData,
    AntibotConfigHistoryEntry,
  } from '../types';

  // Schema-driven renderer: field ids, groups, labels, options, and help are
  // server data decided by the detector at runtime (the evidence-detail
  // precedent), so they render as-is; all page chrome goes through t().
  // Saving validates and applies LIVE server-side and persists per realm for
  // the next boot; a field left at its default carries no override.
  let data = $state<AntibotConfigCatalog | null>(null);
  let failed = $state(false);
  let values = $state<Record<string, AntibotFormValue>>({});
  let invalid = $state<string[]>([]);
  let saving = $state(false);
  let savedFlash = $state(false);
  let expandedGroups = $state<Record<string, boolean>>({});
  let changeNote = $state('');
  let historyEntries = $state<AntibotConfigHistoryEntry[]>([]);
  let historyFailed = $state(false);
  let restoredSkippedCount = $state<number | null>(null);
  let actionsElement = $state<HTMLDivElement | null>(null);
  let restoreNoticeTimer: ReturnType<typeof setTimeout> | undefined;

  const modifiedCount = $derived(
    data === null
      ? 0
      : data.fields.filter((field) => antibotFieldModified(field, values[field.id])).length,
  );
  const dirty = $derived(
    data !== null && data.fields.some((field) => antibotFieldDirty(field, values[field.id])),
  );

  function adopt(catalog: AntibotConfigCatalog): void {
    for (const group of groupAntibotFields(catalog.fields)) {
      if (expandedGroups[group.group] === undefined) expandedGroups[group.group] = false;
    }
    data = catalog;
    values = antibotFormState(catalog.fields);
    invalid = [];
  }

  async function refresh(): Promise<void> {
    try {
      adopt(await apiGet<AntibotConfigCatalog>('/admin/api/antibot-config'));
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function refreshHistory(): Promise<void> {
    try {
      const history = await apiGet<AntibotConfigHistoryData>(
        '/admin/api/antibot-config/history',
      );
      historyEntries = history.entries;
      historyFailed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) historyFailed = true;
    }
  }

  async function save(): Promise<void> {
    if (!data) return;
    const parsed = buildAntibotOverrides(data.fields, values);
    invalid = parsed.invalid;
    if (parsed.invalid.length > 0) {
      const invalidIds = new Set(parsed.invalid);
      for (const group of groupAntibotFields(data.fields)) {
        if (group.fields.some((field) => invalidIds.has(field.id))) {
          expandedGroups[group.group] = true;
        }
      }
      return;
    }
    saving = true;
    try {
      adopt(await apiPost<AntibotConfigCatalog>('/admin/api/antibot-config', {
        overrides: parsed.overrides,
        note: changeNote,
      }));
      changeNote = '';
      dismissRestoreNotice();
      await refreshHistory();
      savedFlash = true;
      setTimeout(() => {
        savedFlash = false;
      }, 2500);
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(
          err instanceof Error ? localizeAdminError(err.message) : t('alert.saveConfigFailed'),
        );
      }
    } finally {
      saving = false;
    }
  }

  function resetField(field: AntibotConfigField): void {
    values[field.id] = Array.isArray(field.defaultValue)
      ? [...field.defaultValue]
      : field.defaultValue;
  }

  function resetAll(): void {
    if (!data) return;
    for (const field of data.fields) resetField(field);
    dismissRestoreNotice();
  }

  function restoreApplied(): void {
    if (!data) return;
    values = antibotFormState(data.fields);
    invalid = [];
    savedFlash = false;
    changeNote = '';
    dismissRestoreNotice();
  }

  function dismissRestoreNotice(): void {
    restoredSkippedCount = null;
    if (restoreNoticeTimer !== undefined) {
      clearTimeout(restoreNoticeTimer);
      restoreNoticeTimer = undefined;
    }
  }

  function showRestoreNotice(skippedCount: number): void {
    dismissRestoreNotice();
    restoredSkippedCount = skippedCount;
    restoreNoticeTimer = setTimeout(() => {
      restoredSkippedCount = null;
      restoreNoticeTimer = undefined;
    }, 6000);
  }

  function loadHistoryVersion(entry: AntibotConfigHistoryEntry): void {
    if (!data) return;
    const restored = antibotHistoryFormState(data.fields, entry.afterData);
    values = restored.values;
    invalid = [];
    savedFlash = false;
    showRestoreNotice(restored.skippedCount);

    for (const group of groupAntibotFields(data.fields)) {
      if (group.fields.some((field) => antibotFieldDirty(field, values[field.id]))) {
        expandedGroups[group.group] = true;
      }
    }
    actionsElement?.scrollIntoView?.({ block: 'center' });
  }

  function toggleOption(field: AntibotConfigField, option: string): void {
    values[field.id] = toggleAntibotOption(values[field.id], option);
  }

  function multiSelected(field: AntibotConfigField, option: string): boolean {
    const current = values[field.id];
    return Array.isArray(current) && current.includes(option);
  }

  function multiOptionModified(field: AntibotConfigField, option: string): boolean {
    const defaultSelected =
      Array.isArray(field.defaultValue) && field.defaultValue.includes(option);
    return multiSelected(field, option) !== defaultSelected;
  }

  onMount(() => {
    void refresh();
    void refreshHistory();
  });

  onDestroy(() => {
    if (restoreNoticeTimer !== undefined) clearTimeout(restoreNoticeTimer);
  });
</script>

<PageHeader title={t('antibot.title')} />

<p class="ac-note">
  {t('antibot.applyNote')}
  {#if data}
    {data.updatedAt === null
      ? t('antibot.neverSaved')
      : t('antibot.updatedAt', { value: fmtDate(data.updatedAt) })}
    {#if modifiedCount > 0}
      <span class="ac-modified-count">{t('antibot.modifiedCount', { count: modifiedCount })}</span>
    {/if}
  {/if}
</p>

<div class="ac-editor" oninput={dismissRestoreNotice}>
  {#if invalid.length > 0}
    <p class="ac-error">{t('antibot.invalidFields')}</p>
  {/if}

  {#if failed}
    <p class="ac-error">{t('antibot.loadFailed')}</p>
  {:else if data === null}
    <p class="ac-note">{t('antibot.loading')}</p>
  {:else}
    {#each groupAntibotFields(data.fields) as group (group.group)}
      {@const overrideCount = group.fields.filter((field) =>
        antibotFieldModified(field, values[field.id]),
      ).length}
      <CollapsiblePanel
        title={group.group}
        count={overrideCount}
        bind:open={expandedGroups[group.group]}
      >
        <div class="ac-fields">
          {#each group.fields as field (field.id)}
            <div
              class="ac-field"
              class:ac-invalid={invalid.includes(field.id)}
              class:ac-changed={antibotFieldModified(field, values[field.id])}
            >
              <div class="ac-field-head">
                <span class="ac-field-name">{field.label}</span>
              </div>
              {#if field.type === 'number'}
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 'any'}
                  bind:value={values[field.id]}
                />
              {:else if field.type === 'boolean'}
                <label
                  class="ac-toggle"
                  class:ac-option-changed={antibotFieldModified(field, values[field.id])}
                >
                  <input
                    type="checkbox"
                    checked={values[field.id] === true}
                    onchange={(event) => {
                      values[field.id] = (event.currentTarget as HTMLInputElement).checked;
                    }}
                  />
                  <span>
                    {values[field.id] === true
                      ? t('antibot.valueOn')
                      : t('antibot.valueOff')}
                  </span>
                </label>
              {:else if field.type === 'multi_select'}
                <div class="ac-options">
                  {#each field.options ?? [] as option (option.value)}
                    <label
                      class="ac-toggle"
                      class:ac-option-changed={multiOptionModified(field, option.value)}
                    >
                      <input
                        type="checkbox"
                        checked={multiSelected(field, option.value)}
                        onchange={() => toggleOption(field, option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  {/each}
                </div>
              {:else if field.type === 'select'}
                <select bind:value={values[field.id]}>
                  {#each field.options ?? [] as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              {:else}
                <input type="text" bind:value={values[field.id]} />
              {/if}
              <span class="ac-field-meta">
                {t('antibot.defaultValue', { value: antibotDefaultText(field, t) })}
              </span>
              {#if field.help}<span class="ac-help">{field.help}</span>{/if}
            </div>
          {/each}
        </div>
      </CollapsiblePanel>
    {/each}
  {/if}

  <div class="ac-action-area" bind:this={actionsElement}>
    {#if restoredSkippedCount !== null}
      <p class="ac-restore-notice" aria-live="polite">
        {restoredSkippedCount === 0
          ? t('antibot.historyLoaded')
          : t('antibot.historyLoadedSkipped', { count: restoredSkippedCount })}
      </p>
    {/if}
    <div class="ac-toolbar">
      <div class="ac-save-flow">
        <label class="ac-change-note" class:ac-change-note-dirty={dirty}>
          <span>{t('antibot.changeNoteLabel')}</span>
          <input
            type="text"
            maxlength="500"
            placeholder={t('antibot.changeNotePlaceholder')}
            bind:value={changeNote}
            disabled={!data || saving}
          />
        </label>
        <button
          type="button"
          class="ac-save"
          class:ac-save-dirty={dirty}
          onclick={() => void save()}
          disabled={!data || saving || !dirty}
        >
          {saving ? t('antibot.saving') : t('antibot.save')}
        </button>
        {#if savedFlash}<span class="ac-saved">{t('antibot.saved')}</span>{/if}
      </div>
      <div class="ac-secondary-actions">
        <button
          type="button"
          class="btn-sm ac-restore-applied"
          onclick={restoreApplied}
          disabled={!data || saving || !dirty}
        >
          {t('antibot.restoreApplied')}
        </button>
        <button
          type="button"
          class="btn-sm ac-reset-all"
          onclick={resetAll}
          disabled={!data || saving}
        >
          {t('antibot.resetAll')}
        </button>
      </div>
    </div>
  </div>
</div>

{#if data}
  <AntibotConfigHistory
    entries={historyEntries}
    fields={data.fields}
    failed={historyFailed}
    onloadversion={loadHistoryVersion}
  />
{/if}

<style>
  .ac-note {
    color: var(--text-soft);
    margin: 4px 0 14px;
  }
  .ac-error {
    color: var(--color-danger);
    margin: 4px 0 14px;
  }
  .ac-saved {
    color: var(--text-soft);
    align-self: center;
  }
  .ac-toolbar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    background: var(--surface-inset);
  }
  .ac-action-area {
    margin-top: 18px;
    padding-bottom: 12px;
  }
  .ac-save-flow {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .ac-secondary-actions {
    display: flex;
    gap: 8px;
    flex: none;
  }
  .ac-reset-all,
  .ac-restore-applied {
    background: var(--btn-flat-bg);
    color: var(--text-dim);
    border-color: var(--border-subtle);
  }
  .ac-save.ac-save-dirty {
    background: linear-gradient(#4a3a14, #241c08);
    color: var(--gold);
    border-color: var(--gold-dim);
    font-family: var(--title-font);
    font-weight: 600;
  }
  .ac-save.ac-save-dirty:hover {
    filter: brightness(1.2);
  }
  .ac-modified-count {
    color: var(--text-bright);
    margin-left: 8px;
  }
  .ac-change-note {
    display: grid;
    gap: 4px;
    width: min(520px, 100%);
    min-width: 180px;
    color: var(--text-soft);
    font-size: var(--font-size-small);
  }
  .ac-change-note :is(span, input) {
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }
  .ac-change-note.ac-change-note-dirty span {
    color: var(--gold);
    font-weight: 600;
  }
  .ac-change-note.ac-change-note-dirty input {
    border-color: var(--gold-dim);
  }
  .ac-restore-notice {
    margin: 0 0 14px;
    padding: 8px 10px;
    border-left: 3px solid var(--gold-dim);
    color: var(--text-soft);
    background: var(--surface-inset);
  }
  .ac-fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px 18px;
    margin: 10px 0;
  }
  .ac-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border: 1px solid transparent;
    border-radius: 4px;
  }
  .ac-field.ac-changed {
    border-color: var(--border-soft);
    border-left: 3px solid var(--gold-dim);
    background: var(--surface-inset);
  }
  .ac-field.ac-changed .ac-field-name {
    color: var(--gold);
    font-weight: 700;
  }
  .ac-field.ac-invalid {
    border-color: var(--color-danger-border);
  }
  .ac-field-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .ac-field-name {
    font-weight: 600;
  }
  .ac-field-meta {
    color: var(--text-soft);
    font-size: 12px;
  }
  .ac-help {
    color: var(--text-soft);
    font-size: 12px;
  }
  .ac-options {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow-y: auto;
  }
  .ac-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ac-toggle.ac-option-changed > span {
    color: var(--gold);
    font-weight: 700;
  }
  @media (max-width: 700px) {
    .ac-toolbar,
    .ac-save-flow {
      align-items: stretch;
    }
    .ac-toolbar {
      flex-direction: column;
    }
    .ac-save-flow {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      width: 100%;
    }
    .ac-change-note {
      grid-column: 1 / -1;
      width: 100%;
    }
    .ac-saved {
      align-self: center;
    }
    .ac-reset-all {
      align-self: flex-end;
    }
    .ac-secondary-actions {
      align-self: flex-end;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }
</style>
