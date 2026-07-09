<script lang="ts">
  import type { ModerationHistoryEntry } from '../types';
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import Badge from './Badge.svelte';
  import Panel from './Panel.svelte';

  type BadgeVariant = 'default' | 'neutral' | 'warn' | 'bad' | 'success';

  let { entries }: { entries: ModerationHistoryEntry[] } = $props();

  function actionLabel(action: string): string {
    if (action === 'suspend') return t('moderationHistory.actionSuspend');
    if (action === 'unsuspend') return t('moderationHistory.actionUnsuspend');
    if (action === 'ban') return t('moderationHistory.actionBan');
    if (action === 'unban') return t('moderationHistory.actionUnban');
    if (action === 'chat_mute') return t('moderationHistory.actionChatMute');
    if (action === 'chat_unmute') return t('moderationHistory.actionChatUnmute');
    if (action === 'force_rename') return t('moderationHistory.actionForceRename');
    if (action === 'note') return t('moderationHistory.actionNote');
    if (action === 'reset_password') return t('moderationHistory.actionResetPassword');
    return t('moderationHistory.actionUnknown');
  }

  function actionVariant(action: string): BadgeVariant {
    if (action === 'ban') return 'bad';
    if (action === 'suspend' || action === 'chat_mute' || action === 'reset_password') {
      return 'warn';
    }
    if (action === 'unban' || action === 'unsuspend' || action === 'chat_unmute') {
      return 'success';
    }
    return 'neutral';
  }
</script>

<div class="history-panel">
  <Panel
    title={t('moderationHistory.title')}
    hint={t('moderationHistory.latestHint')}
  >
    {#if entries.length === 0}
      <div class="empty">{t('moderationHistory.empty')}</div>
    {:else}
      <ol class="moderation-history">
        {#each entries as entry (entry.id)}
          <li>
            <div class="history-meta">
              <Badge variant={actionVariant(entry.action)} size="medium">
                {actionLabel(entry.action)}
              </Badge>
              <span>
                {t('moderationHistory.by', {
                  name: entry.adminUsername ?? t('common.unknown'),
                })}
              </span>
              <time datetime={entry.createdAt}>{fmtDate(entry.createdAt)}</time>
            </div>
            <div class="history-reason">
              {entry.reason || t('moderationHistory.noReason')}
            </div>
            {#if entry.expiresAt}
              <div class="history-expiry">
                {t('moderationHistory.expires', {
                  value: fmtDate(entry.expiresAt),
                })}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </Panel>
</div>

<style>
  .history-panel {
    margin-top: 18px;
  }

  .moderation-history {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    padding: 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    background: var(--surface-sunken);
  }

  .history-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  time {
    margin-left: auto;
  }

  .history-reason {
    margin-top: 7px;
    color: var(--text);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .history-expiry {
    margin-top: 5px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  @media (max-width: 600px) {
    time {
      flex-basis: 100%;
      margin-left: 0;
    }
  }
</style>
