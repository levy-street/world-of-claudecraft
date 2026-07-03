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
    patchOrNull,
  } from '../housekeeping';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkCalendar, HkCalendarCatalog, HkNumericValues, HkSaveResponse } from '../types';

  // Guild event calendar caps: events per guild, title/note lengths, the
  // booking horizon, and how long past days stay visible. Saved values apply
  // on the next restart.
  let data = $state<HkCalendarCatalog | null>(null);
  let failed = $state(false);
  let values = $state<Record<string, FieldInput>>({});
  let invalid = $state<string[]>([]);
  let saving = $state(false);

  // HkCalendar is a concrete interface; the field-rows component takes a keyed record.
  const toValues = (calendar: HkCalendar): HkNumericValues => ({ ...calendar });

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkCalendarCatalog>('/admin/api/housekeeping/calendar');
      values = numericFormState(data.fields, data.saved);
      invalid = [];
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

  async function saveCalendar(): Promise<void> {
    if (!data) return;
    const parsed = parseNumericPatch(data.fields, values);
    invalid = parsed.invalid;
    if (parsed.invalid.length > 0) return;
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides', {
        domain: 'calendar',
        patch: patchOrNull(parsed.patch),
      });
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      saving = false;
    }
  }

  async function clearCalendar(): Promise<void> {
    saving = true;
    try {
      await apiPost<HkSaveResponse>('/admin/api/housekeeping/overrides/clear', {
        domain: 'calendar',
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
  <Panel title={t('nav.hkCalendar')}>
    <div class="empty">{t('housekeeping.loadFailed')}</div>
  </Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  <Panel title={t('hkCalendar.title')} hint={t('hkCalendar.hint')}>
    <HkFieldRows
      fields={data.fields}
      defaults={toValues(data.defaults)}
      live={toValues(data.applied)}
      bind:values
      {invalid}
    />
    {#if invalid.length > 0}<p class="hk-error">{t('housekeeping.invalidFields')}</p>{/if}
    <div class="controls">
      <button onclick={saveCalendar} disabled={saving}>{t('housekeeping.save')}</button>
      <button class="btn-sm" onclick={clearCalendar} disabled={saving}>
        {t('housekeeping.clearOverrides')}
      </button>
    </div>
  </Panel>
{/if}

<style>
  .hk-error {
    color: var(--color-danger);
    font-size: var(--font-size-small);
  }
</style>
