<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate } from '../format';
  import Panel from '../components/Panel.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import {
    describeRealmBuilderMonth,
    nextRealmBuilderMonth,
    REALM_BUILDER_MAX_NAME_LENGTH,
    REALM_BUILDER_MAX_NOTE_LENGTH,
    validateRealmBuilderEntry,
  } from '../realm_builders';

  // Realm Builder of the Month: the honour roll the Eastbrook Vale monument
  // reads. The newest entry is what the statue projects in gold; the rest are
  // what its inspect card lists. Saving here republishes to the live world, so
  // a player standing at the plaque sees the new name without a reload.
  interface RealmBuilderRow {
    year: number;
    month: number;
    name: string;
    note: string;
    updatedAt: string;
  }

  let rows = $state<RealmBuilderRow[]>([]);
  let failed = $state(false);
  let loaded = $state(false);
  let saving = $state(false);
  let formYear = $state(new Date().getFullYear());
  let formMonth = $state(new Date().getMonth() + 1);
  let formName = $state('');
  let formNote = $state('');
  let pendingDelete = $state<RealmBuilderRow | null>(null);

  const canManage = $derived(auth.can('content.moderate'));
  const current = $derived(rows[0] ?? null);
  const past = $derived(rows.slice(1));
  const editing = $derived(
    rows.some((row) => row.year === formYear && row.month === formMonth),
  );
  const problem = $derived(
    validateRealmBuilderEntry({ year: formYear, month: formMonth, name: formName, note: formNote }),
  );

  async function refresh(): Promise<void> {
    try {
      const data = await apiGet<{ rows: RealmBuilderRow[] }>('/admin/api/realm-builders');
      rows = data.rows;
      failed = false;
      loaded = true;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function fail(err: unknown, fallbackKey: string): void {
    if (!auth.handleAuthFailure(err)) {
      window.alert(err instanceof Error ? localizeAdminError(err.message) : t(fallbackKey));
    }
  }

  async function save(): Promise<void> {
    if (problem || saving) return;
    saving = true;
    try {
      await apiPost('/admin/api/realm-builders', {
        year: formYear,
        month: formMonth,
        name: formName.trim(),
        note: formNote.trim(),
      });
      formName = '';
      formNote = '';
      await refresh();
    } catch (err) {
      fail(err, 'realmBuilders.saveFailed');
    } finally {
      saving = false;
    }
  }

  async function confirmDelete(): Promise<void> {
    const row = pendingDelete;
    if (!row) return;
    try {
      await apiPost('/admin/api/realm-builders/delete', { year: row.year, month: row.month });
      pendingDelete = null;
      await refresh();
    } catch (err) {
      fail(err, 'realmBuilders.deleteFailed');
    }
  }

  /** Load a row back into the form so an operator can correct a spelling. */
  function edit(row: RealmBuilderRow): void {
    formYear = row.year;
    formMonth = row.month;
    formName = row.name;
    formNote = row.note;
  }

  /** Jump the form to the month after the newest entry: the common next act. */
  function useNextMonth(): void {
    const next = nextRealmBuilderMonth(rows[0] ?? null);
    formYear = next.year;
    formMonth = next.month;
  }

  onMount(() => {
    void refresh();
  });
</script>

{#if failed}
  <Panel title={t('nav.realmBuilders')}>
    <div class="empty">{t('realmBuilders.loadFailed')}</div>
  </Panel>
{:else}
  <Panel title={t('realmBuilders.currentTitle')} hint={t('realmBuilders.currentHint')}>
    {#if !loaded}
      <div class="empty">{t('realmBuilders.loading')}</div>
    {:else if current}
      <div class="rb-current">
        <div class="rb-current-name">{current.name}</div>
        <div class="rb-current-month">{describeRealmBuilderMonth(current.year, current.month)}</div>
        {#if current.note}<div class="hint">{current.note}</div>{/if}
      </div>
    {:else}
      <div class="empty">{t('realmBuilders.noneYet')}</div>
    {/if}
  </Panel>

  {#if canManage}
    <Panel
      title={editing ? t('realmBuilders.editTitle') : t('realmBuilders.addTitle')}
      hint={t('realmBuilders.addHint')}
    >
      <div class="rb-form">
        <label for="rb-year">{t('realmBuilders.yearLabel')}</label>
        <input id="rb-year" type="number" min="2000" max="4000" bind:value={formYear} />

        <label for="rb-month">{t('realmBuilders.monthLabel')}</label>
        <input id="rb-month" type="number" min="1" max="12" bind:value={formMonth} />

        <label for="rb-name">{t('realmBuilders.nameLabel')}</label>
        <input
          id="rb-name"
          type="text"
          maxlength={REALM_BUILDER_MAX_NAME_LENGTH}
          placeholder={t('realmBuilders.namePlaceholder')}
          bind:value={formName}
        />

        <label for="rb-note">{t('realmBuilders.noteLabel')}</label>
        <input
          id="rb-note"
          type="text"
          maxlength={REALM_BUILDER_MAX_NOTE_LENGTH}
          placeholder={t('realmBuilders.notePlaceholder')}
          bind:value={formNote}
        />
      </div>
      <div class="rb-actions">
        <button onclick={useNextMonth}>{t('realmBuilders.useNextMonth')}</button>
        <button class="primary" disabled={problem !== null || saving} onclick={save}>
          {editing ? t('realmBuilders.saveEdit') : t('realmBuilders.saveNew')}
        </button>
      </div>
      {#if problem}
        <div class="hint rb-problem">{t(problem)}</div>
      {:else}
        <div class="hint">{t('realmBuilders.publishHint')}</div>
      {/if}
    </Panel>
  {/if}

  <Panel title={t('realmBuilders.rollTitle')} hint={t('realmBuilders.rollHint')}>
    {#if past.length === 0}
      <div class="empty">{t('realmBuilders.rollEmpty')}</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>{t('realmBuilders.colMonth')}</th>
            <th>{t('realmBuilders.colName')}</th>
            <th>{t('realmBuilders.colNote')}</th>
            <th>{t('realmBuilders.colUpdated')}</th>
            {#if canManage}<th>{t('detail.colActions')}</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each past as row (`${row.year}-${row.month}`)}
            <tr>
              <td>{describeRealmBuilderMonth(row.year, row.month)}</td>
              <td>{row.name}</td>
              <td>{row.note || t('common.emptyValue')}</td>
              <td>{fmtDate(row.updatedAt)}</td>
              {#if canManage}
                <td>
                  <button onclick={() => edit(row)}>{t('realmBuilders.edit')}</button>
                  <button class="danger" onclick={() => (pendingDelete = row)}>
                    {t('realmBuilders.remove')}
                  </button>
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Panel>
{/if}

{#if pendingDelete}
  <ConfirmDialog
    title={t('realmBuilders.removeTitle')}
    danger
    rows={[
      { label: t('realmBuilders.colMonth'), value: describeRealmBuilderMonth(pendingDelete.year, pendingDelete.month) },
      { label: t('realmBuilders.colName'), value: pendingDelete.name },
    ]}
    confirmLabel={t('realmBuilders.remove')}
    onConfirm={() => void confirmDelete()}
    onCancel={() => (pendingDelete = null)}
  />
{/if}

<style>
  .rb-current-name {
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--gold);
  }
  .rb-current-month {
    color: var(--text-dim);
  }
  .rb-form {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 0.75rem;
    align-items: center;
    max-width: 40rem;
  }
  .rb-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .rb-problem {
    color: var(--color-danger);
  }
</style>
