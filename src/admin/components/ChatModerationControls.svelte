<script lang="ts">
  import type { AccountDetail } from '../types';
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import {
    type Built,
    chatMuteCustom,
    chatMuteHours,
    liftChatMute,
    type PendingAction,
  } from '../moderation_actions';
  import Badge from './Badge.svelte';
  import ModerationActionPrompt from './ModerationActionPrompt.svelte';

  type Target = Pick<
    AccountDetail,
    | 'id'
    | 'isAdmin'
    | 'bannedAt'
    | 'chatMutedUntil'
    | 'chatMuteReason'
    | 'chatStrikes'
  >;
  type SelectedAction =
    | { kind: 'mute'; hours: number; label: string }
    | { kind: 'mute-custom'; label: string }
    | { kind: 'lift'; label: string };

  let {
    target,
    onSubmit,
    onReset,
  }: {
    target: Target;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
    onReset: () => void | Promise<void>;
  } = $props();

  let selected = $state<SelectedAction | null>(null);
  let activeMute = $derived(
    target.chatMutedUntil !== null &&
      new Date(target.chatMutedUntil).getTime() > Date.now(),
  );
  let canMute = $derived(!target.isAdmin && target.bannedAt === null);

  $effect(() => {
    target.id;
    selected = null;
  });

  function rowsFor(action: SelectedAction): { label: string; value: string }[] {
    return [
      { label: t('dialog.account'), value: `#${target.id}` },
      { label: t('dialog.action'), value: action.label },
    ];
  }

  async function confirm(values: { reason: string; expiry: string }): Promise<void> {
    const action = selected;
    if (!action) return;
    let built: Built;
    if (action.kind === 'mute-custom') {
      built = chatMuteCustom(target.id, values.expiry, values.reason);
    } else if (action.kind === 'lift') {
      built = liftChatMute(target.id, values.reason);
    } else {
      built = chatMuteHours(target.id, action.hours, values.reason);
    }
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    if (await onSubmit(built.pending)) selected = null;
  }
</script>

<section class="account-admin-controls chat-mod-controls" aria-label={t('chatMod.title')}>
  <div class="account-status">
    <b>{t('chatMod.chatLabel')}</b>
    {#if activeMute}
      <Badge variant="warn" size="medium">
        {t('chatMod.mutedUntil', { value: fmtDate(target.chatMutedUntil) })}
      </Badge>
    {:else}
      <Badge size="medium">{t('chatMod.notMuted')}</Badge>
    {/if}
    · {t('chatMod.strikesInline')} <b>{target.chatStrikes}</b>
  </div>
  {#if activeMute && target.chatMuteReason}
    <div class="moderation-reason">
      {t('chatMod.muteReason', { value: target.chatMuteReason })}
    </div>
  {/if}
  {#if canMute && !activeMute}
    <button
      onclick={() =>
        (selected = {
          kind: 'mute',
          hours: 1,
          label: t('detail.chatMute1h'),
        })}
    >
      {t('detail.chatMute1h')}
    </button>
    <button
      onclick={() =>
        (selected = {
          kind: 'mute-custom',
          label: t('detail.chatMuteCustom'),
        })}
    >
      {t('detail.chatMuteCustom')}
    </button>
  {/if}
  {#if activeMute}
    <button
      onclick={() =>
        (selected = {
          kind: 'lift',
          label: t('chatMod.liftChatMute'),
        })}
    >
      {t('chatMod.liftChatMute')}
    </button>
  {/if}
  {#if target.chatStrikes > 0}
    <button onclick={onReset}>{t('chatMod.resetChatStrikes')}</button>
  {/if}
</section>

{#if selected}
  {@const action = selected}
  {#key `${target.id}:${action.kind}`}
    <ModerationActionPrompt
      title={action.kind === 'mute-custom'
        ? t('dialog.confirmCustomChatMute')
        : action.kind === 'lift'
          ? t('dialog.confirmChatUnmute')
          : t('dialog.confirmChatMute')}
      rows={rowsFor(action)}
      showExpiry={action.kind === 'mute-custom'}
      onConfirm={confirm}
      onCancel={() => (selected = null)}
    />
  {/key}
{/if}
