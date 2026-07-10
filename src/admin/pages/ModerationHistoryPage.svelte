<script lang="ts">
  import { onMount } from 'svelte';
  import type { ModerationActionHistoryRow, Paginated } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import AccountLink from '../components/AccountLink.svelte';
  import Badge from '../components/Badge.svelte';
  import IpLink from '../components/IpLink.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';

  type ModerationHistoryTab = 'all' | 'mine' | 'notes';
  type BadgeVariant = 'default' | 'neutral' | 'warn' | 'bad' | 'success';

  const LIMIT = 100;

  let data = $state<Paginated<ModerationActionHistoryRow> | null>(null);
  let failed = $state(false);
  let page = $state(1);
  let tab = $state<ModerationHistoryTab>('all');

  const tabs: { id: ModerationHistoryTab; labelKey: string }[] = [
    { id: 'all', labelKey: 'moderationHistoryPage.tabAll' },
    { id: 'mine', labelKey: 'moderationHistoryPage.tabMine' },
    { id: 'notes', labelKey: 'moderationHistoryPage.tabNotes' },
  ];

  async function refresh(): Promise<void> {
    try {
      const params = new URLSearchParams({
        tab,
        page: String(page),
        limit: String(LIMIT),
      });
      data = await apiGet<Paginated<ModerationActionHistoryRow>>(
        `/admin/api/moderation/history?${params}`,
      );
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function selectTab(nextTab: ModerationHistoryTab): void {
    if (tab === nextTab) return;
    tab = nextTab;
    page = 1;
    void refresh();
  }

  function actionLabel(action: string): string {
    if (action === 'suspend') return t('moderationHistory.actionSuspend');
    if (action === 'unsuspend') return t('moderationHistory.actionUnsuspend');
    if (action === 'ban') return t('moderationHistory.actionBan');
    if (action === 'unban') return t('moderationHistory.actionUnban');
    if (action === 'chat_mute') return t('moderationHistory.actionChatMute');
    if (action === 'chat_unmute') return t('moderationHistory.actionChatUnmute');
    if (action === 'force_rename') return t('moderationHistory.actionForceRename');
    if (action === 'kick') return t('moderationHistory.actionKick');
    if (action === 'kill') return t('moderationHistory.actionKill');
    if (action === 'jail') return t('moderationHistory.actionJail');
    if (action === 'unjail') return t('moderationHistory.actionUnjail');
    if (action === 'note') return t('moderationHistory.actionNote');
    if (action === 'reset_password') return t('moderationHistory.actionResetPassword');
    if (action === 'block') return t('moderationHistory.actionIpBlock');
    if (action === 'unblock') return t('moderationHistory.actionIpUnblock');
    return t('moderationHistory.actionUnknown');
  }

  function actionVariant(action: string): BadgeVariant {
    if (action === 'ban' || action === 'block') return 'bad';
    if (
      action === 'suspend' ||
      action === 'chat_mute' ||
      action === 'reset_password' ||
      action === 'kick' ||
      action === 'kill' ||
      action === 'jail'
    ) {
      return 'warn';
    }
    if (
      action === 'unban' ||
      action === 'unsuspend' ||
      action === 'chat_unmute' ||
      action === 'unjail' ||
      action === 'unblock'
    ) {
      return 'success';
    }
    return 'neutral';
  }

  onMount(() => {
    void refresh();
  });
</script>

<Panel title={t('moderationHistoryPage.title')} hint={t('moderationHistoryPage.hint')}>
  <div class="history-toolbar" aria-label={t('moderationHistoryPage.tabsLabel')}>
    {#each tabs as item (item.id)}
      <button
        type="button"
        class:active={tab === item.id}
        aria-pressed={tab === item.id}
        onclick={() => selectTab(item.id)}
      >
        {t(item.labelKey)}
      </button>
    {/each}
  </div>

  {#if failed}
    <div class="empty">{t('moderationHistoryPage.loadFailed')}</div>
  {:else if data && data.rows.length === 0}
    <div class="empty">{t('moderationHistoryPage.empty')}</div>
  {:else if data}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('moderationHistoryPage.colWhen')}</th>
            <th>{t('moderationHistoryPage.colAction')}</th>
            <th>{t('moderationHistoryPage.colTarget')}</th>
            <th>{t('moderationHistoryPage.colModerator')}</th>
            <th>{t('moderationHistoryPage.colReason')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as entry (`${entry.source}:${entry.id}`)}
            <tr>
              <td><time datetime={entry.createdAt}>{fmtDate(entry.createdAt)}</time></td>
              <td>
                <Badge variant={actionVariant(entry.action)} size="medium">
                  {actionLabel(entry.action)}
                </Badge>
              </td>
              <td>
                {#if entry.source === 'account' && entry.accountId !== null && entry.username}
                  <AccountLink
                    accountId={entry.accountId}
                    label={entry.username}
                    onChanged={() => void refresh()}
                  />
                {:else if entry.source === 'ip' && entry.ip}
                  <IpLink ip={entry.ip} />
                {:else}
                  {t('common.unknown')}
                {/if}
              </td>
              <td>
                {#if entry.adminAccountId !== null && entry.adminUsername}
                  <AccountLink
                    accountId={entry.adminAccountId}
                    label={entry.adminUsername}
                    onChanged={() => void refresh()}
                  />
                {:else}
                  {t('common.unknown')}
                {/if}
              </td>
              <td class="history-note">{entry.reason || t('moderationHistory.noReason')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager
      total={data.total}
      page={data.page}
      limit={data.limit}
      layout="footer"
      onPage={(nextPage) => {
        page = nextPage;
        void refresh();
      }}
    />
  {/if}
</Panel>

<style>
  .history-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }

  .history-toolbar button {
    min-width: 92px;
  }

  .history-toolbar button.active {
    border-color: var(--gold);
    color: var(--gold);
    background: rgba(207, 160, 77, 0.12);
  }

  .history-note {
    min-width: 260px;
    max-width: 520px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
</style>
