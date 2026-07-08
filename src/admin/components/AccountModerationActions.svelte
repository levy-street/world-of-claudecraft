<script lang="ts">
  import type { AccountDetail } from '../types';
  import { accountStatusFor } from '../account_status';
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import {
    type Built,
    banAccount,
    resetPassword,
    suspendCustom,
    suspendHours,
    unbanAccount,
    unsuspendAccount,
    type PendingAction,
  } from '../moderation_actions';
  import { auth } from '../state/auth.svelte';
  import ModerationActionPrompt from './ModerationActionPrompt.svelte';

  type Target = Pick<
    AccountDetail,
    'id' | 'isAdmin' | 'bannedAt' | 'suspendedUntil' | 'moderationReason'
  >;
  type SelectedAction =
    | { kind: 'suspend'; hours: number; label: string }
    | { kind: 'suspend-custom'; label: string }
    | { kind: 'unsuspend'; label: string }
    | { kind: 'ban'; label: string }
    | { kind: 'unban'; label: string }
    | { kind: 'reset-password'; label: string };

  let {
    target,
    onSubmit,
  }: {
    target: Target;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
  } = $props();

  let selected = $state<SelectedAction | null>(null);
  let status = $derived(accountStatusFor(target));

  $effect(() => {
    target.id;
    selected = null;
  });

  const suspensionOptions = [
    { hours: 1, label: () => t('detail.suspend1h') },
    { hours: 24, label: () => t('detail.suspend24h') },
    { hours: 72, label: () => t('detail.suspend3d') },
    { hours: 168, label: () => t('detail.suspend7d') },
    { hours: 720, label: () => t('detail.suspend30d') },
  ];

  function rowsFor(action: SelectedAction): { label: string; value: string }[] {
    return [
      { label: t('dialog.account'), value: `#${target.id}` },
      { label: t('dialog.action'), value: action.label },
    ];
  }

  function titleFor(action: SelectedAction): string {
    if (action.kind === 'ban') return t('dialog.confirmBan');
    if (action.kind === 'unban') return t('dialog.confirmUnban');
    if (action.kind === 'unsuspend') return t('dialog.confirmUnsuspension');
    if (action.kind === 'suspend-custom') return t('dialog.confirmCustomSuspension');
    if (action.kind === 'reset-password') return t('dialog.confirmResetPassword');
    return t('dialog.confirmSuspension');
  }

  async function confirm(values: {
    reason: string;
    expiry: string;
    password: string;
  }): Promise<void> {
    const action = selected;
    if (!action) return;
    let built: Built;
    if (action.kind === 'ban') built = banAccount(target.id, values.reason);
    else if (action.kind === 'unban') built = unbanAccount(target.id, values.reason);
    else if (action.kind === 'unsuspend') {
      built = unsuspendAccount(target.id, values.reason);
    }
    else if (action.kind === 'reset-password') {
      built = resetPassword(target.id, values.password, values.reason);
    }
    else if (action.kind === 'suspend-custom') {
      built = suspendCustom(target.id, values.expiry, values.reason);
    } else {
      built = suspendHours(target.id, action.hours, values.reason);
    }
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    if (await onSubmit(built.pending)) selected = null;
  }
</script>

{#if !target.isAdmin}
  <section class="account-admin-controls mod-account-actions" aria-label={t('detail.accountActions')}>
    {#if status === 'banned' && target.moderationReason}
      <div class="moderation-reason">
        {t('detail.banReason', { value: target.moderationReason })}
      </div>
    {:else if status === 'suspended' && target.moderationReason}
      <div class="moderation-reason">
        {t('detail.suspensionReason', { value: target.moderationReason })}
      </div>
    {/if}

    {#if status === 'banned'}
      <button onclick={() => (selected = { kind: 'unban', label: t('detail.unban') })}>
        {t('detail.unban')}
      </button>
    {:else if status === 'suspended'}
      <button
        onclick={() =>
          (selected = {
            kind: 'unsuspend',
            label: t('detail.unsuspend'),
          })}
      >
        {t('detail.unsuspend')}
      </button>
      <button
        class="danger"
        onclick={() => (selected = { kind: 'ban', label: t('detail.ban') })}
      >
        {t('detail.ban')}
      </button>
    {:else}
      {#each suspensionOptions as option}
        <button
          onclick={() =>
            (selected = {
              kind: 'suspend',
              hours: option.hours,
              label: option.label(),
            })}
        >
          {option.label()}
        </button>
      {/each}
      <button
        onclick={() =>
          (selected = {
            kind: 'suspend-custom',
            label: t('detail.suspendCustom'),
          })}
      >
        {t('detail.suspendCustom')}
      </button>
      <button
        class="danger"
        onclick={() => (selected = { kind: 'ban', label: t('detail.ban') })}
      >
        {t('detail.ban')}
      </button>
    {/if}
    {#if auth.can('accounts.password')}
      <button
        class="danger"
        onclick={() =>
          (selected = {
            kind: 'reset-password',
            label: t('detail.resetPassword'),
          })}
      >
        {t('detail.resetPassword')}
      </button>
    {/if}
  </section>

  {#if selected}
    {@const action = selected}
    {#key `${target.id}:${action.kind}:${action.kind === 'suspend' ? action.hours : ''}`}
      <ModerationActionPrompt
        title={titleFor(action)}
        rows={rowsFor(action)}
        showExpiry={action.kind === 'suspend-custom'}
        showPassword={action.kind === 'reset-password'}
        danger={action.kind === 'ban' || action.kind === 'reset-password'}
        onConfirm={confirm}
        onCancel={() => (selected = null)}
      />
    {/key}
  {/if}
{/if}
