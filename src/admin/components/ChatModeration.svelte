<script lang="ts">
  import type { AccountDetail, ChatModerationDetail } from '../types';
  import type { PendingAction } from '../moderation_actions';
  import { t } from '../i18n';
  import { fmtDate, fmtDuration } from '../format';
  import Panel from './Panel.svelte';
  import ChatModerationControls from './ChatModerationControls.svelte';

  // Chat-filter state for an account in the moderation detail: shared mute controls,
  // strike state, and the warn/mute incident log. The parent owns apiPost and refresh.
  let {
    account,
    chat,
    onSubmit,
    onReset,
  }: {
    account: AccountDetail;
    chat: ChatModerationDetail;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
    onReset: () => void;
  } = $props();
</script>

<Panel title={t('chatMod.title')}>
  <ChatModerationControls
    target={{
      ...account,
      chatMutedUntil: chat.chatMutedUntil,
      chatStrikes: chat.chatStrikes,
    }}
    {onSubmit}
    {onReset}
  />
  <h4>{t('chatMod.recentIncidents')}</h4>
  {#if chat.violations.length === 0}
    <div class="empty">{t('chatMod.noIncidents')}</div>
  {:else}
    <table>
      <thead>
        <tr><th>{t('report.colTime')}</th><th>{t('report.colChannel')}</th><th>{t('chatMod.colWord')}</th><th>{t('dialog.action')}</th><th>{t('report.colMessage')}</th></tr>
      </thead>
      <tbody>
        {#each chat.violations as v (v.id)}
          <tr>
            <td>{fmtDate(v.createdAt)}</td>
            <td>{v.channel}</td>
            <td>{v.term}</td>
            <td>{v.action}{#if v.muteSeconds > 0} ({fmtDuration(v.muteSeconds)}){/if}</td>
            <td>{v.message}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>
