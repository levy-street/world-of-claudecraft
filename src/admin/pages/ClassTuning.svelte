<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import {
    buildTuningDocument,
    documentChannelCount,
    EMPTY_ABILITY_FILTER,
    EMPTY_WEAPON_FILTER,
    filterAbilities,
    filterWeapons,
    resetAbility,
    tunedAbilityCount,
    tunedWeaponCount,
    tuningDocumentKey,
    tuningFormState,
    weaponHands,
    type AbilityFilter,
    type TuningForm,
    type WeaponFilter,
  } from '../class_tuning';
  import Badge from '../components/Badge.svelte';
  import ClassTuningAbility from '../components/ClassTuningAbility.svelte';
  import ClassTuningWeapon from '../components/ClassTuningWeapon.svelte';
  import CollapsiblePanel from '../components/CollapsiblePanel.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import { fmtDate } from '../format';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type {
    ClassTuningHistory as ClassTuningHistoryData,
    ClassTuningHistoryEntry,
    ClassTuningResponse,
    TunerClassInfo,
  } from '../types';

  // The class power tuner. One window per class, a spec filter inside it, and a
  // slider per tunable aspect of every ability. The whole catalog (classes,
  // specs, abilities, channels, shipped values) is server data derived from the
  // live content tables, so a reworked class arrives here with no change to
  // this page; only the page chrome goes through t().
  //
  // A save PERSISTS and AUDITS; it does not touch the running world. Tuning is
  // installed once per boot, so the page says "pending restart" rather than
  // implying the change is live.
  let data = $state<ClassTuningResponse | null>(null);
  let failed = $state(false);
  let form = $state<TuningForm>({ abilities: {}, weapons: {} });
  let savedKey = $state('');
  // null selects the WEAPONS window, which sits at the end of the class tabs:
  // auto-attack profiles are shared across classes, so they get their own window
  // rather than being duplicated into each class's.
  let activeClassId = $state<string | null>(null);
  let weaponsSelected = $state(false);
  let filters = $state<Record<string, AbilityFilter>>({});
  let weaponFilter = $state<WeaponFilter>({ ...EMPTY_WEAPON_FILTER });
  let changeNote = $state('');
  let saving = $state(false);
  let savedFlash = $state(false);
  let savedFlashTimer: ReturnType<typeof setTimeout> | undefined;
  let historyEntries = $state<ClassTuningHistoryEntry[]>([]);
  let historyFailed = $state(false);
  let historyPageSize = $state(0);
  let historyLoadingMore = $state(false);
  // True while the LAST history fetch returned a full page: older rows may
  // exist, so the "load older" button shows.
  let historyMayHaveMore = $state(false);
  let resetPending = $state(false);

  const SAVED_FLASH_MS = 2500;

  const canWrite = $derived(auth.can('tuning.write'));
  // Sliders lock while a save is in flight. `adopt()` replaces the whole form
  // with the server's response, so an edit made during the POST would be
  // silently thrown away the moment it landed.
  const editable = $derived(canWrite && !saving);
  const activeClass = $derived<TunerClassInfo | null>(
    data?.catalog.classes.find((entry) => entry.id === activeClassId) ?? null,
  );
  const dirty = $derived(tuningDocumentKey(buildTuningDocument(form)) !== savedKey);
  const visibleAbilities = $derived(
    activeClass === null
      ? []
      : filterAbilities(
          activeClass,
          filters[activeClass.id] ?? EMPTY_ABILITY_FILTER,
          form.abilities,
        ),
  );
  const allWeapons = $derived(data?.catalog.weapons ?? []);
  const visibleWeapons = $derived(filterWeapons(allWeapons, weaponFilter, form.weapons));
  const handOptions = $derived(weaponHands(allWeapons));
  const tunedWeapons = $derived(tunedWeaponCount(form.weapons, allWeapons));
  // The LIVE form counts (what a reset would discard), not the saved ones.
  const tunedAbilities = $derived(
    (data?.catalog.classes ?? []).reduce(
      (total, entry) => total + tunedAbilityCount(form.abilities, entry),
      0,
    ),
  );

  function adopt(response: ClassTuningResponse): void {
    data = response;
    form = tuningFormState(response.catalog, response.document);
    savedKey = tuningDocumentKey(buildTuningDocument(form));
    activeClassId ??= response.catalog.classes[0]?.id ?? null;
    for (const entry of response.catalog.classes) {
      filters[entry.id] ??= { ...EMPTY_ABILITY_FILTER };
    }
  }

  async function refresh(): Promise<void> {
    try {
      adopt(await apiGet<ClassTuningResponse>('/admin/api/class-tuning'));
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function refreshHistory(): Promise<void> {
    try {
      const history = await apiGet<ClassTuningHistoryData>('/admin/api/class-tuning/history');
      historyEntries = history.entries;
      historyPageSize = history.pageSize;
      historyMayHaveMore = history.pageSize > 0 && history.entries.length >= history.pageSize;
      historyFailed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) historyFailed = true;
    }
  }

  // Keyset paging on the audit row id: append the page older than the last row
  // in hand. The trail is append-only, so pages never shift under the walk.
  async function loadOlderHistory(): Promise<void> {
    const last = historyEntries[historyEntries.length - 1];
    if (!last || historyLoadingMore) return;
    historyLoadingMore = true;
    try {
      const history = await apiGet<ClassTuningHistoryData>(
        `/admin/api/class-tuning/history?before=${last.id}`,
      );
      historyEntries = [...historyEntries, ...history.entries];
      historyMayHaveMore = historyPageSize > 0 && history.entries.length >= historyPageSize;
      historyFailed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) historyFailed = true;
    } finally {
      historyLoadingMore = false;
    }
  }

  function flashSaved(): void {
    // One timer at a time: rapid saves must not stack timeouts whose earliest
    // firing cuts the newest flash short (or fires after the page is gone).
    clearTimeout(savedFlashTimer);
    savedFlash = true;
    savedFlashTimer = setTimeout(() => {
      savedFlash = false;
    }, SAVED_FLASH_MS);
  }

  async function save(): Promise<void> {
    if (!data || saving) return;
    saving = true;
    // A reset confirmed mid-save would be silently undone when adopt() replaces
    // the form with the server's response; close the pending dialog instead.
    resetPending = false;
    try {
      adopt(
        await apiPost<ClassTuningResponse>('/admin/api/class-tuning', {
          document: buildTuningDocument(form),
          note: changeNote,
        }),
      );
      changeNote = '';
      await refreshHistory();
      flashSaved();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(
          err instanceof Error ? localizeAdminError(err.message) : t('alert.saveTuningFailed'),
        );
      }
    } finally {
      saving = false;
    }
  }

  function onResetAbility(abilityId: string): void {
    resetAbility(form.abilities, abilityId);
  }

  function onResetWeapon(weaponId: string): void {
    resetAbility(form.weapons, weaponId);
  }

  // Resetting everything discards every slider on the realm in one click, so it
  // asks first (ConfirmDialog, the same family the moderation actions use).
  function resetEverything(): void {
    resetPending = false;
    // Guarded against a save in flight (belt to save()'s dialog-closing brace):
    // adopt() would silently revert the reset when the POST landed.
    if (!data || saving) return;
    for (const abilityId of Object.keys(form.abilities)) resetAbility(form.abilities, abilityId);
    for (const weaponId of Object.keys(form.weapons)) resetAbility(form.weapons, weaponId);
  }

  function selectClass(classId: string): void {
    activeClassId = classId;
    weaponsSelected = false;
  }

  function selectWeapons(): void {
    weaponsSelected = true;
  }

  function tunedInClass(entry: TunerClassInfo): number {
    return tunedAbilityCount(form.abilities, entry);
  }

  function countChannels(entry: ClassTuningHistoryEntry): number {
    return documentChannelCount(entry.afterData);
  }

  onMount(() => {
    void refresh();
    void refreshHistory();
  });

  onDestroy(() => {
    clearTimeout(savedFlashTimer);
  });
</script>

<PageHeader title={t('tuning.title')}>
  {#snippet badge()}
    {#if data?.pendingRestart}
      <Badge variant="warn">{t('tuning.pendingRestart')}</Badge>
    {:else if data}
      <Badge variant="success">{t('tuning.inSync')}</Badge>
    {/if}
  {/snippet}
</PageHeader>

{#if failed}
  <p class="notice bad">{t('tuning.loadFailed')}</p>
{:else if data === null}
  <p class="notice">{t('tuning.loading')}</p>
{:else}
  <p class="notice">{t('tuning.intro')}</p>
  {#if !canWrite}
    <p class="notice">{t('tuning.readOnly')}</p>
  {/if}
  <p class="notice">
    {#if data.updatedAt === null}
      {t('tuning.neverSaved')}
    {:else}
      {t('tuning.updatedAt', { value: fmtDate(data.updatedAt) })}
      {t('tuning.summary', {
        abilities: data.tunedAbilities,
        weapons: data.tunedWeapons,
        channels: data.tunedChannels,
      })}
    {/if}
  </p>

  <nav class="class-tabs" aria-label={t('tuning.title')}>
    {#each data.catalog.classes as entry (entry.id)}
      {@const tuned = tunedInClass(entry)}
      <button
        type="button"
        class="class-tab"
        class:active={!weaponsSelected && entry.id === activeClassId}
        aria-pressed={!weaponsSelected && entry.id === activeClassId}
        onclick={() => selectClass(entry.id)}
      >
        {entry.name}
        {#if tuned > 0}<span class="tab-count">{tuned}</span>{/if}
      </button>
    {/each}
    <button
      type="button"
      class="class-tab weapons-tab"
      class:active={weaponsSelected}
      aria-pressed={weaponsSelected}
      onclick={selectWeapons}
    >
      {t('tuning.weaponsTab')}
      {#if tunedWeapons > 0}<span class="tab-count">{tunedWeapons}</span>{/if}
    </button>
  </nav>

  {#if weaponsSelected}
    <section class="panel class-window">
      <p class="notice">{t('tuning.weaponsIntro')}</p>
      <div class="filters">
        <div class="spec-tabs" role="group" aria-label={t('tuning.allHands')}>
          <button
            type="button"
            class="spec-tab"
            class:active={weaponFilter.hand === null}
            aria-pressed={weaponFilter.hand === null}
            onclick={() => {
              weaponFilter.hand = null;
            }}
          >
            {t('tuning.allHands')}
          </button>
          {#each handOptions as hand (hand)}
            <button
              type="button"
              class="spec-tab"
              class:active={weaponFilter.hand === hand}
              aria-pressed={weaponFilter.hand === hand}
              onclick={() => {
                weaponFilter.hand = hand;
              }}
            >
              {t(`tuning.hand.${hand}`)}
            </button>
          {/each}
        </div>
        <div class="filter-controls">
          <label class="search">
            <span>{t('tuning.searchLabel')}</span>
            <input
              type="search"
              placeholder={t('tuning.searchPlaceholder')}
              bind:value={weaponFilter.search}
            />
          </label>
          <label class="only-tuned">
            <input type="checkbox" bind:checked={weaponFilter.onlyTuned} />
            <span>{t('tuning.onlyTuned')}</span>
          </label>
          <span class="count">{t('tuning.weaponCount', { count: visibleWeapons.length })}</span>
        </div>
      </div>

      {#if visibleWeapons.length === 0}
        <p class="notice">{t('tuning.noWeaponMatches')}</p>
      {:else}
        <div class="ability-list">
          {#each visibleWeapons as weapon (weapon.id)}
            <ClassTuningWeapon
              {weapon}
              readOnly={!editable}
              onReset={onResetWeapon}
              bind:factors={form.weapons[weapon.id]}
            />
          {/each}
        </div>
      {/if}
    </section>
  {:else if activeClass}
    {@const filter = filters[activeClass.id] ?? EMPTY_ABILITY_FILTER}
    <section class="panel class-window">
      <div class="filters">
        <div class="spec-tabs" role="group" aria-label={t('tuning.allSpecs')}>
          <button
            type="button"
            class="spec-tab"
            class:active={filter.spec === null}
            aria-pressed={filter.spec === null}
            onclick={() => {
              filters[activeClass.id].spec = null;
            }}
          >
            {t('tuning.allSpecs')}
          </button>
          {#each activeClass.specs as spec (spec.id)}
            <button
              type="button"
              class="spec-tab"
              class:active={filter.spec === spec.id}
              aria-pressed={filter.spec === spec.id}
              onclick={() => {
                filters[activeClass.id].spec = spec.id;
              }}
            >
              {spec.name}
            </button>
          {/each}
        </div>
        <div class="filter-controls">
          <label class="search">
            <span>{t('tuning.searchLabel')}</span>
            <input
              type="search"
              placeholder={t('tuning.searchPlaceholder')}
              bind:value={filters[activeClass.id].search}
            />
          </label>
          <label class="only-tuned">
            <input type="checkbox" bind:checked={filters[activeClass.id].onlyTuned} />
            <span>{t('tuning.onlyTuned')}</span>
          </label>
          <span class="count">{t('tuning.abilityCount', { count: visibleAbilities.length })}</span>
        </div>
      </div>

      {#if visibleAbilities.length === 0}
        <p class="notice">{t('tuning.noMatches')}</p>
      {:else}
        <div class="ability-list">
          {#each visibleAbilities as ability (ability.id)}
            <ClassTuningAbility
              {ability}
              specs={activeClass.specs}
              readOnly={!editable}
              onReset={onResetAbility}
              bind:factors={form.abilities[ability.id]}
            />
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  <section class="panel actions">
    <label class="note">
      <span>{t('tuning.noteLabel')}</span>
      <input
        type="text"
        maxlength={data.noteMaxLength}
        placeholder={t('tuning.notePlaceholder')}
        bind:value={changeNote}
        disabled={!editable}
      />
    </label>
    <div class="buttons">
      {#if dirty}<span class="unsaved">{t('tuning.unsaved')}</span>{/if}
      {#if savedFlash}<span class="saved">{t('tuning.saved')}</span>{/if}
      <button
        type="button"
        onclick={() => {
          resetPending = true;
        }}
        disabled={!editable}
      >
        {t('tuning.resetAll')}
      </button>
      <button type="button" class="primary" onclick={save} disabled={!canWrite || saving}>
        {saving ? t('tuning.saving') : t('tuning.save')}
      </button>
    </div>
    {#if resetPending}
      <ConfirmDialog
        title={t('tuning.resetAllConfirm')}
        rows={[
          {
            label: t('tuning.resetAllRow'),
            value: t('tuning.resetAllRowValue', {
              abilities: tunedAbilities,
              weapons: tunedWeapons,
            }),
          },
        ]}
        danger
        confirmLabel={t('tuning.resetAllConfirmLabel')}
        onConfirm={resetEverything}
        onCancel={() => {
          resetPending = false;
        }}
      />
    {/if}
  </section>

  <CollapsiblePanel title={t('tuning.historyTitle')} count={historyEntries.length}>
    {#if historyFailed}
      <p class="notice bad">{t('tuning.historyFailed')}</p>
    {:else if historyEntries.length === 0}
      <p class="notice">{t('tuning.historyEmpty')}</p>
    {:else}
      <ul class="history">
        {#each historyEntries as entry (entry.id)}
          <li>
            <span class="history-when">{fmtDate(entry.createdAt)}</span>
            <span class="history-who">
              {entry.adminUsername === null
                ? t('tuning.historyByDeleted')
                : t('tuning.historyBy', { name: entry.adminUsername })}
            </span>
            <span class="history-count">
              {t('tuning.historyChannels', { count: countChannels(entry) })}
            </span>
            {#if entry.note}<span class="history-note">{entry.note}</span>{/if}
          </li>
        {/each}
      </ul>
      {#if historyMayHaveMore}
        <button
          type="button"
          class="history-more"
          onclick={loadOlderHistory}
          disabled={historyLoadingMore}
        >
          {t('tuning.historyMore')}
        </button>
      {/if}
    {/if}
  </CollapsiblePanel>
{/if}

<style>
  .notice {
    color: var(--text-soft);
    font-size: var(--font-size-small);
    margin-bottom: 10px;
  }

  .notice.bad {
    color: var(--color-danger);
  }

  .class-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }

  .class-tab,
  .spec-tab {
    background: var(--btn-flat-bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    cursor: pointer;
    font-size: var(--font-size-base);
    padding: 6px 12px;
  }

  .class-tab.active,
  .spec-tab.active {
    background: var(--surface-active);
    border-color: var(--gold);
    color: var(--gold);
  }

  .tab-count {
    background: var(--surface-active);
    border-radius: 8px;
    color: var(--gold);
    font-size: var(--font-size-small);
    margin-left: 6px;
    padding: 0 6px;
  }

  .class-window {
    margin-bottom: 14px;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .spec-tabs,
  .filter-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }

  .search,
  .only-tuned,
  .note {
    align-items: center;
    color: var(--text-soft);
    display: flex;
    font-size: var(--font-size-small);
    gap: 6px;
  }

  .count {
    color: var(--text-soft);
    font-size: var(--font-size-small);
  }

  .ability-list {
    display: grid;
    gap: 10px;
  }

  .actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  .note {
    flex: 1 1 320px;
  }

  .note input {
    flex: 1;
    min-width: 0;
  }

  .buttons {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .unsaved {
    color: var(--badge-warn-text);
    font-size: var(--font-size-small);
  }

  .saved {
    color: var(--badge-success-text);
    font-size: var(--font-size-small);
  }

  .history {
    display: grid;
    gap: 6px;
    list-style: none;
  }

  .history li {
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: var(--font-size-small);
    padding-bottom: 6px;
  }

  .history-when {
    color: var(--text-bright);
  }

  .history-who,
  .history-count {
    color: var(--text-soft);
  }

  .history-note {
    color: var(--text);
    flex-basis: 100%;
  }

  .history-more {
    margin-top: 8px;
  }

  @media (max-width: 600px) {
    .filters {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
