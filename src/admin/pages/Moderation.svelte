<script lang="ts">
  import { onMount } from 'svelte';
  import type { ModerationQueueRow } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { t } from '../i18n';
  import { fmtRelative } from '../format';
  import { reasonLabel } from '../labels';
  import Panel from '../components/Panel.svelte';
  import AccountIndicators from '../components/AccountIndicators.svelte';
  import ModerationDetail from './ModerationDetail.svelte';

  // Moderation tab: the report queue (highest open-report counts first) and the detail
  // for the selected account. Ported from renderModerationQueue + openModerationAccount.
  let rows = $state<ModerationQueueRow[]>([]);
  let failed = $state(false);
  let selectedId = $state<number | null>(null);

  async function refreshQueue(): Promise<void> {
    try {
      const data = await apiGet<{ rows: ModerationQueueRow[] }>('/admin/api/moderation/queue');
      rows = data.rows;
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => { void refreshQueue(); });
</script>

<Panel title={t('moderation.queueTitle')} hint={t('moderation.queueHint')}>
  {#if failed}
    <div class="empty">{t('moderation.loadFailed')}</div>
  {:else if rows.length === 0}
    <div class="empty">{t('moderation.empty')}</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>{t('moderation.colAccount')}</th>
          <th>{t('moderation.colCharacters')}</th>
          <th class="num">{t('moderation.colOpenReports')}</th>
          <th>{t('moderation.colLatestReason')}</th>
          <th>{t('moderation.colLatest')}</th>
          <th>{t('moderation.colStatus')}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.accountId)}
          <tr class="clickable" onclick={() => (selectedId = r.accountId)}>
            <td>{r.username} <AccountIndicators isAdmin={r.isAdmin} online={r.online} /></td>
            <td>{r.characterNames.join(', ') || t('common.emptyValue')}</td>
            <td class="num">{r.openReports}</td>
            <td>{reasonLabel(r.latestReason)}</td>
            <td>{fmtRelative(r.latestReportAt)}</td>
            <td>
              <AccountIndicators status={r.status} suspendedUntil={r.suspendedUntil} />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if selectedId !== null}
    <div id="moderation-detail">
      <ModerationDetail accountId={selectedId} onQueueRefresh={refreshQueue} />
    </div>
  {/if}
</Panel>
