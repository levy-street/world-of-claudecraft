<script lang="ts">
  import type { ModerationAccountDetail, ReportDetail } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate } from '../format';
  import { reasonLabel } from '../labels';
  import {
    type Built,
    forceRename,
    type PendingAction,
  } from '../moderation_actions';
  import AccountDetail from './AccountDetail.svelte';
  import AccountModerationActions from '../components/AccountModerationActions.svelte';
  import ChatModeration from '../components/ChatModeration.svelte';
  import IpBlockSection from '../components/IpBlockSection.svelte';
  import ModerationActionPrompt from '../components/ModerationActionPrompt.svelte';

  // Full moderation detail for one account: read-only profile (characters + sessions),
  // account moderation actions, the chat incident log, the known-IP block section, and
  // the open reports. Each action asks for its own reason only after selection, so
  // unrelated account, chat, report, character, and IP actions do not share form state.
  let { accountId, onQueueRefresh }: { accountId: number; onQueueRefresh: () => void } = $props();

  type SelectedReportAction =
    | { kind: 'ignore'; report: ReportDetail }
    | { kind: 'force-rename'; report: ReportDetail };

  let detail = $state<ModerationAccountDetail | null>(null);
  let failed = $state(false);
  let selectedReportAction = $state<SelectedReportAction | null>(null);

  async function refetch(): Promise<void> {
    try {
      detail = await apiGet<ModerationAccountDetail>(`/admin/api/moderation/accounts/${accountId}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  // Re-fetch whenever the selected account changes.
  $effect(() => {
    accountId;
    selectedReportAction = null;
    void refetch();
  });

  function fail(err: unknown): void {
    if (!auth.handleAuthFailure(err)) window.alert(err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'));
  }

  async function submit(built: Built): Promise<boolean> {
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return false;
    }
    return submitPending(built.pending);
  }

  async function submitPending(pending: PendingAction): Promise<boolean> {
    try {
      await apiPost(pending.endpoint, pending.body);
      onQueueRefresh();
      await refetch();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  async function direct(endpoint: string, body: unknown = {}): Promise<boolean> {
    try {
      await apiPost(endpoint, body);
      onQueueRefresh();
      await refetch();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  async function confirmReportAction(values: {
    reason: string;
    expiry: string;
  }): Promise<void> {
    const selected = selectedReportAction;
    if (!selected) return;
    const succeeded =
      selected.kind === 'ignore'
        ? await direct(`/admin/api/moderation/reports/${selected.report.id}/ignore`, {
            note: values.reason,
          })
        : await submit(
            forceRename(
              selected.report.reportedCharacterId!,
              selected.report.reportedCharacterName,
              values.reason,
            ),
          );
    if (succeeded) selectedReportAction = null;
  }
</script>

{#if failed}
  <div class="empty">{t('report.loadFailed')}</div>
{:else if detail}
  <div class="mod-detail">
    <div class="panel-title">
      <span>{detail.account.username}</span>
      <span class="hint">{t('detail.accountNum', { id: detail.account.id })}</span>
    </div>

    <AccountDetail detail={detail.account} onChanged={refetch} />

    <AccountModerationActions target={detail.account} onSubmit={submitPending} />

    <ChatModeration
      account={detail.account}
      chat={detail.chat}
      onSubmit={submitPending}
      onReset={() => direct(`/admin/api/moderation/accounts/${accountId}/reset-strikes`)}
    />

    <IpBlockSection
      detail={detail}
      onBan={submitPending}
      onUnblock={(ip) => void direct('/admin/api/blocked-ips/delete', { ip })}
    />

    <h4>{t('report.openReports')}</h4>
    {#if detail.reports.length === 0}
      <div class="empty">{t('report.noOpenReports')}</div>
    {:else}
      {#each detail.reports as r (r.id)}
        <div class="mod-report panel">
          <div class="panel-title">{t('report.title', { id: r.id })} <span class="hint">{fmtDate(r.createdAt)}</span></div>
          <div class="mod-report-meta">
            <div><b>{t('report.reporter')}</b> {r.reporterUsername ?? t('common.unknown')} / {r.reporterCharacterName || t('common.unknown')}</div>
            <div><b>{t('report.reported')}</b> {r.reportedUsername} / {r.reportedCharacterName || t('common.unknown')}</div>
            <div><b>{t('report.reason')}</b> {reasonLabel(r.reason)}</div>
          </div>
          <div class="mod-details">{r.details || t('report.noDetails')}</div>
          <div class="mod-actions">
            <button onclick={() => (selectedReportAction = { kind: 'ignore', report: r })}>
              {t('report.ignore')}
            </button>
            {#if r.reportedCharacterId}
              <button
                onclick={() =>
                  (selectedReportAction = {
                    kind: 'force-rename',
                    report: r,
                  })}
              >
                {t('report.forceNameChange')}
              </button>
            {/if}
          </div>
          {#if selectedReportAction?.report.id === r.id}
            {@const action = selectedReportAction}
            {#key `${r.id}:${action.kind}`}
              <ModerationActionPrompt
                title={action.kind === 'ignore'
                  ? t('report.confirmIgnore')
                  : t('dialog.confirmForceName')}
                rows={[
                  {
                    label: t('dialog.action'),
                    value:
                      action.kind === 'ignore'
                        ? t('report.ignore')
                        : t('report.forceNameChange'),
                  },
                ]}
                reasonRequired={action.kind !== 'ignore'}
                onConfirm={confirmReportAction}
                onCancel={() => (selectedReportAction = null)}
              />
            {/key}
          {/if}
          <h4>{t('report.recentChat')}</h4>
          {#if r.chatContext.length === 0}
            <div class="empty">{t('report.noChat')}</div>
          {:else}
            <table>
              <thead>
                <tr><th>{t('report.colTime')}</th><th>{t('report.colChannel')}</th><th>{t('report.colMessage')}</th></tr>
              </thead>
              <tbody>
                {#each r.chatContext as c (c.id)}
                  <tr>
                    <td>{fmtDate(c.createdAt)}</td>
                    <td>{c.channel}</td>
                    <td><b>{c.characterName}:</b> {c.message}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
{/if}
