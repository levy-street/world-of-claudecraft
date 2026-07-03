<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import Badge from '../components/Badge.svelte';
  import HkStatusBanner from '../components/HkStatusBanner.svelte';
  import Panel from '../components/Panel.svelte';
  import StatCard from '../components/StatCard.svelte';
  import { fmtDate, fmtNumber } from '../format';
  import { localizeHkDiagnostic } from '../housekeeping_errors';
  import { t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkOverview } from '../types';

  // Housekeeping overview: what this world is running (realm, seed, dev
  // commands), how much content is configurable, and which overrides are saved.
  let data = $state<HkOverview | null>(null);
  let failed = $state(false);

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkOverview>('/admin/api/housekeeping/overview');
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => {
    void refresh();
  });

  const overrideRows = $derived(
    data
      ? [
          { key: 'rates', count: data.overrideCounts.rates + (data.overrideCounts.xpTable ? 1 : 0) },
          { key: 'calendar', count: data.overrideCounts.calendar },
          { key: 'mobs', count: data.overrideCounts.mobs },
          { key: 'quests', count: data.overrideCounts.quests },
          { key: 'items', count: data.overrideCounts.items },
          { key: 'npcs', count: data.overrideCounts.npcs },
          { key: 'camps', count: data.overrideCounts.camps },
        ]
      : [],
  );
</script>

{#if failed}
  <Panel title={t('nav.housekeeping')}><div class="empty">{t('housekeeping.loadFailed')}</div></Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  <Panel title={t('housekeeping.worldTitle')} hint={t('housekeeping.worldHint')}>
    <div class="detail-grid">
      <div><strong>{t('housekeeping.realm')}</strong> {data.realm}</div>
      <div><strong>{t('housekeeping.worldSeed')}</strong> {data.worldSeed}</div>
      <div>
        <strong>{t('housekeeping.devCommands')}</strong>
        {#if data.devCommands}<Badge variant="warn">{t('housekeeping.devCommandsOn')}</Badge>
        {:else}<Badge>{t('housekeeping.devCommandsOff')}</Badge>{/if}
      </div>
      <div>
        <strong>{t('housekeeping.appliedAt')}</strong>
        {data.appliedAt ? fmtDate(data.appliedAt) : t('common.never')}
      </div>
      <div>
        <strong>{t('housekeeping.savedAt')}</strong>
        {data.status.savedUpdatedAt ? fmtDate(data.status.savedUpdatedAt) : t('common.never')}
      </div>
    </div>
    {#if data.bootWarnings.length > 0}
      <p class="hint">{t('housekeeping.bootWarnings')}</p>
      <ul class="hk-warnings">
        {#each data.bootWarnings as warning (warning)}
          <li>{localizeHkDiagnostic(warning)}</li>
        {/each}
      </ul>
    {/if}
  </Panel>

  <section id="stats">
    <StatCard value={fmtNumber(data.counts.mobs)} label={t('housekeeping.countMobs')} />
    <StatCard value={fmtNumber(data.counts.camps)} label={t('housekeeping.countCamps')} />
    <StatCard value={fmtNumber(data.counts.quests)} label={t('housekeeping.countQuests')} />
    <StatCard value={fmtNumber(data.counts.items)} label={t('housekeeping.countItems')} />
    <StatCard value={fmtNumber(data.counts.npcs)} label={t('housekeeping.countNpcs')} />
    <StatCard value={fmtNumber(data.counts.zones)} label={t('housekeeping.countZones')} />
    <StatCard value={fmtNumber(data.counts.dungeons)} label={t('housekeeping.countDungeons')} />
    <StatCard value={fmtNumber(data.counts.delves)} label={t('housekeeping.countDelves')} />
  </section>

  <Panel title={t('housekeeping.overridesTitle')} hint={t('housekeeping.overridesHint')}>
    <table>
      <thead>
        <tr><th>{t('housekeeping.colSection')}</th><th class="num">{t('housekeeping.colOverrides')}</th></tr>
      </thead>
      <tbody>
        {#each overrideRows as row (row.key)}
          <tr>
            <td>{t(`housekeeping.domain.${row.key}`)}</td>
            <td class="num">
              {#if row.count > 0}<Badge variant="warn">{fmtNumber(row.count)}</Badge>
              {:else}{t('common.emptyValue')}{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </Panel>
{/if}

<style>
  .hk-warnings {
    margin: 4px 0 0;
    padding-left: 18px;
    color: var(--text-soft);
    font-size: var(--font-size-small);
  }
</style>
